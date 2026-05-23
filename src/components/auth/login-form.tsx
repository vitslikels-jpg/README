"use client";

import { useState } from "react";

export function LoginForm() {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ login, password }),
    });

    if (!response.ok) {
      setError("Неверный логин или пароль");
      setPassword("");
      setIsSubmitting(false);
      return;
    }

    window.location.assign("/");
  }

  return (
    <form className="loginForm" onSubmit={handleSubmit}>
      <div className="field">
        <span>Логин</span>
        <input
          value={login}
          onChange={(event) => setLogin(event.target.value)}
          autoComplete="username"
          name="login"
          type="text"
          required
        />
      </div>

      <div className="field">
        <span>Пароль</span>
        <input
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          name="password"
          type="password"
          required
        />
      </div>

      {error ? <p className="errorText">{error}</p> : null}

      <button className="primaryButton" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Входим..." : "Войти"}
      </button>
    </form>
  );
}
