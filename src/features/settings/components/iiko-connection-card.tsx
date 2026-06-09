"use client";

import { useState } from "react";

type TestConnectionResponse = {
  ok: boolean;
  message: string;
  details?: string;
  serverUrl?: string;
};

export function IikoConnectionCard({ serverUrl }: { serverUrl: string }) {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<TestConnectionResponse | null>(null);

  async function handleTestConnection() {
    setIsLoading(true);

    try {
      const response = await fetch("/api/integrations/iiko/test-connection", {
        method: "GET",
        cache: "no-store",
      });

      const data = (await response.json().catch(() => null)) as TestConnectionResponse | null;

      if (!data) {
        setResult({
          ok: false,
          message: "Ошибка подключения к iiko",
          details: "Сервер вернул пустой ответ.",
        });
        return;
      }

      setResult(data);
    } catch {
      setResult({
        ok: false,
        message: "Ошибка подключения к iiko",
        details: "Не удалось достучаться до серверного API.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  const statusText = isLoading
    ? "Проверяю..."
    : result
      ? result.ok
        ? "Подключено"
        : "Ошибка"
      : "Не проверено";

  return (
    <section className="card settingsComparisonCard">
      <div className="cardHeader">
        <div>
          <p className="panelEyebrow">Интеграции</p>
          <h2 className="sectionTitle">Интеграция iiko</h2>
          <p className="panelText">Проверка идёт только на сервере. Пароль в UI не показывается.</p>
        </div>
        <span className="statusPill">{statusText}</span>
      </div>

      <div className="formGrid">
        <label className="field">
          <span>Сервер</span>
          <input value={result?.serverUrl || serverUrl || "Не настроен"} readOnly />
        </label>
      </div>

      <div className="settingsComparisonActions">
        <button className="primaryButton" type="button" onClick={() => void handleTestConnection()} disabled={isLoading}>
          {isLoading ? "Проверяю..." : "Проверить подключение"}
        </button>
      </div>

      {result ? (
        result.ok ? (
          <p className="panelText">{result.message}</p>
        ) : (
          <p className="errorText">{result.details || result.message}</p>
        )
      ) : null}
    </section>
  );
}
