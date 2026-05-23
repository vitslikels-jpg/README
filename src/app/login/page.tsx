import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { isAuthenticatedRequest } from "@/lib/auth";

export default async function LoginPage() {
  const cookieStore = await cookies();
  const authenticated = await isAuthenticatedRequest(cookieStore);

  if (authenticated) {
    redirect("/");
  }

  return (
    <main className="loginPage">
      <section className="loginCard">
        <p className="panelEyebrow">Авторизация</p>
        <h1 className="pageTitle">Вход в систему</h1>
        <p className="pageDescription">Введите логин и пароль. Пароль хранится только на сервере и проверяется через bcrypt.</p>
        <LoginForm />
      </section>
    </main>
  );
}
