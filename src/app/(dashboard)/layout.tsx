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
      <EnterpriseProvider initialEnterprises={[]}>
        <div className="appShell">
          <Sidebar />

          <div className="appContent">
            <Topbar />
            <main className="mainContent">
              <section className="card pagePlaceholder">
                <p className="panelEyebrow">Setup required</p>
                <h2 className="pageTitle">Database is not configured</h2>
                <p className="pageDescription">{getDatabaseSetupMessage()}</p>
                <div className="placeholderBox">
                  <p className="placeholderTitle">What to do</p>
                  <p className="placeholderText">
                    Create a local <code>.env</code> file from <code>.env.example</code>, set a valid{" "}
                    <code>DATABASE_URL</code>, then run Prisma migrations.
                  </p>
                </div>
              </section>
            </main>
          </div>
        </div>
      </EnterpriseProvider>
    );
  }

  const enterprises = await getEnterprises();

  return (
    <EnterpriseProvider initialEnterprises={enterprises}>
      <div className="appShell">
        <Sidebar />

        <div className="appContent">
          <Topbar />
          <main className="mainContent">{children}</main>
        </div>
      </div>
    </EnterpriseProvider>
  );
}
