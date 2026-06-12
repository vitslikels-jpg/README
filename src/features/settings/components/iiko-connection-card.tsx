"use client";

import { useEffect, useState } from "react";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";

type TestConnectionResponse = {
  ok: boolean;
  message: string;
  details?: string;
  serverUrl?: string;
};

type CatalogSummaryResponse = {
  ok: boolean;
  message?: string;
  details?: string;
  storesCount?: number;
  productsCount?: number;
  goodsCount?: number;
  lastSyncedAt?: string | null;
};

type SyncCatalogResponse = {
  ok: boolean;
  message?: string;
  details?: string;
  storesReceived?: number;
  storesCreated?: number;
  storesUpdated?: number;
  productsReceived?: number;
  productsCreated?: number;
  productsUpdated?: number;
  goodsCount?: number;
  errors?: string[];
};

function formatDateTime(value?: string | null) {
  if (!value) {
    return "Нет данных";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function IikoConnectionCard({ serverUrl }: { serverUrl: string }) {
  const { activeEnterpriseId } = useEnterprise();
  const [isTesting, setIsTesting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [result, setResult] = useState<TestConnectionResponse | null>(null);
  const [summary, setSummary] = useState<CatalogSummaryResponse | null>(null);
  const [syncResult, setSyncResult] = useState<SyncCatalogResponse | null>(null);

  async function loadSummary(enterpriseId: string) {
    const response = await fetch(
      `/api/integrations/iiko/catalog-summary?enterpriseId=${encodeURIComponent(enterpriseId)}`,
      {
        method: "GET",
        cache: "no-store",
      },
    );
    const data = (await response.json().catch(() => null)) as CatalogSummaryResponse | null;

    setSummary(data ?? { ok: false, message: "Сервер вернул пустой ответ." });
  }

  useEffect(() => {
    if (!activeEnterpriseId) {
      setSummary(null);
      return;
    }

    void loadSummary(activeEnterpriseId);
  }, [activeEnterpriseId]);

  async function handleTestConnection() {
    setIsTesting(true);

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
      setIsTesting(false);
    }
  }

  async function handleSyncCatalog() {
    if (!activeEnterpriseId) {
      setSyncResult({
        ok: false,
        message: "Сначала выберите предприятие.",
      });
      return;
    }

    setIsSyncing(true);
    setSyncResult(null);

    try {
      const response = await fetch("/api/integrations/iiko/sync-catalog", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enterpriseId: activeEnterpriseId }),
      });
      const data = (await response.json().catch(() => null)) as SyncCatalogResponse | null;

      if (!data) {
        setSyncResult({
          ok: false,
          message: "Сервер вернул пустой ответ.",
        });
        return;
      }

      setSyncResult(data);

      if (data.ok) {
        await loadSummary(activeEnterpriseId);
      }
    } catch {
      setSyncResult({
        ok: false,
        message: "Не удалось запустить синхронизацию каталога iiko.",
      });
    } finally {
      setIsSyncing(false);
    }
  }

  const statusText = isTesting
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
        <button className="primaryButton" type="button" onClick={() => void handleTestConnection()} disabled={isTesting}>
          {isTesting ? "Проверяю..." : "Проверить подключение"}
        </button>
        <button
          className="secondaryButton"
          type="button"
          onClick={() => void handleSyncCatalog()}
          disabled={isSyncing || !activeEnterpriseId}
        >
          {isSyncing ? "Синхронизирую..." : "Синхронизировать каталог iiko"}
        </button>
      </div>

      {result ? (
        result.ok ? (
          <p className="panelText">{result.message}</p>
        ) : (
          <p className="errorText">{result.details || result.message}</p>
        )
      ) : null}

      <div className="placeholderBox">
        <p className="placeholderTitle">Каталог iiko</p>
        <p className="placeholderText">Складов: {summary?.storesCount ?? 0}</p>
        <p className="placeholderText">Товаров всего: {summary?.productsCount ?? 0}</p>
        <p className="placeholderText">Товаров GOODS: {summary?.goodsCount ?? 0}</p>
        <p className="placeholderText">Последнее обновление: {formatDateTime(summary?.lastSyncedAt)}</p>
        <p className="placeholderText">Остатки пока не подключены: endpoint не подтверждён.</p>
      </div>

      {summary && !summary.ok ? (
        <p className="errorText">{summary.details || summary.message || "Не удалось получить сводку каталога iiko."}</p>
      ) : null}

      {syncResult ? (
        syncResult.ok ? (
          <div className="placeholderBox">
            <p className="placeholderTitle">Результат синхронизации</p>
            <p className="placeholderText">Складов получено: {syncResult.storesReceived ?? 0}</p>
            <p className="placeholderText">Складов новых: {syncResult.storesCreated ?? 0}</p>
            <p className="placeholderText">Складов обновлено: {syncResult.storesUpdated ?? 0}</p>
            <p className="placeholderText">Товаров получено: {syncResult.productsReceived ?? 0}</p>
            <p className="placeholderText">Товаров новых: {syncResult.productsCreated ?? 0}</p>
            <p className="placeholderText">Товаров обновлено: {syncResult.productsUpdated ?? 0}</p>
            <p className="placeholderText">GOODS: {syncResult.goodsCount ?? 0}</p>
            {syncResult.errors?.length ? <p className="errorText">{syncResult.errors.join(" ")}</p> : null}
          </div>
        ) : (
          <p className="errorText">{syncResult.details || syncResult.message || "Ошибка синхронизации."}</p>
        )
      ) : null}
    </section>
  );
}
