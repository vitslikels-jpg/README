"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  async function handleLogout() {
    setError("");

    const response = await fetch("/api/auth/logout", {
      method: "POST",
    });

    if (!response.ok) {
      setError("Не удалось выйти");
      return;
    }

    startTransition(() => {
      router.replace("/login");
      router.refresh();
    });
  }

  return (
    <div className="topbarActions">
      <button className="secondaryButton compactButton" type="button" onClick={handleLogout} disabled={isPending}>
        {isPending ? "Выходим..." : "Выйти"}
      </button>

      {error ? <p className="errorText">{error}</p> : null}
    </div>
  );
}
