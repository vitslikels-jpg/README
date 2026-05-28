import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { EnterpriseProvider } from "@/features/enterprises/components/enterprise-context";
import { isAuthenticatedRequest } from "@/lib/auth";
import { getDatabaseSetupMessage, isDatabaseConfigured } from "@/lib/env";
import { prisma } from "@/lib/prisma";

async function getEnterprises() {
  const enterprises = await prisma.enterprise.findMany({
    orderBy: {
      createdAt: "desc",
    },
  });

  return enterprises.map((enterprise) => ({
    ...enterprise,
    createdAt: enterprise.createdAt.toISOString(),
    updatedAt: enterprise.updatedAt.toISOString(),
  }));
}

function DashboardShell({
  children,
  enterprises,
  databaseWarning,
}: {
  children: ReactNode;
  enterprises: Awaited<ReturnType<typeof getEnterprises>>;
  databaseWarning?: string;
}) {
  return (
    <EnterpriseProvider initialEnterprises={enterprises}>
      <div className="appShell">
        <Sidebar />

        <div className="appContent">
          <Topbar />
          <main className="mainContent">
            {databaseWarning ? (
              <section className="card pagePlaceholder">
                <p className="panelEyebrow">Preview mode</p>
                <h2 className="pageTitle">База сейчас недоступна</h2>
                <p className="pageDescription">{databaseWarning}</p>
                <div className="placeholderBox">
                  <p className="placeholderTitle">Что это значит</p>
                  <p className="placeholderText">
                    Интерфейс открыт в режиме предпросмотра. Как только PostgreSQL снова поднимется, главная сама
                    начнёт показывать живые данные.
                  </p>
                </div>
              </section>
            ) : null}
            {children}
          </main>
        </div>
      </div>
    </EnterpriseProvider>
  );
}

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  await connection();

  const cookieStore = await cookies();
  const authenticated = await isAuthenticatedRequest(cookieStore);

  if (!authenticated) {
    redirect("/login");
  }

  if (!isDatabaseConfigured()) {
    return (
      <DashboardShell enterprises={[]}>
        <section className="card pagePlaceholder">
          <p className="panelEyebrow">Setup required</p>
          <h2 className="pageTitle">Database is not configured</h2>
          <p className="pageDescription">{getDatabaseSetupMessage()}</p>
          <div className="placeholderBox">
            <p className="placeholderTitle">What to do</p>
            <p className="placeholderText">
              Create a local <code>.env</code> file from <code>.env.example</code>, set a valid <code>DATABASE_URL</code>,
              then run Prisma migrations.
            </p>
          </div>
        </section>
      </DashboardShell>
    );
  }

  try {
    const enterprises = await getEnterprises();

    return <DashboardShell enterprises={enterprises}>{children}</DashboardShell>;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Не удалось подключиться к базе. Проверьте PostgreSQL на 127.0.0.1:5432.";

    return (
      <DashboardShell enterprises={[]} databaseWarning={message}>
        {children}
      </DashboardShell>
    );
  }
}
