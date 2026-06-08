"use client";

import type { CSSProperties } from "react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";

type PriceChangeDirection = "all" | "up" | "down";
type PriceChangePeriod = "today" | "7d" | "month" | "custom";
type PriceChangeStatus = "confirmed" | "requires_review";
type PriceChangeSource = "invoice";

type PriceChangeSupplierOption = {
  id: string;
  name: string;
};

type PriceChangeReportItem = {
  id: string;
  changedAt: string;
  supplierId: string;
  supplierName: string;
  productId: string;
  productName: string;
  productNameRaw: string;
  oldPrice: string | null;
  newPrice: string;
  differenceAmount: string | null;
  differencePercent: string | null;
  potentialImpactAmount: string | null;
  quantity: string | null;
  source: PriceChangeSource;
  status: PriceChangeStatus;
};

type PriceChangesReportResponse = {
  summary: {
    totalChanges: number;
    increasedCount: number;
    decreasedCount: number;
    averageChangePercent: number | null;
    potentialImpactAmount: string | null;
    hasPotentialImpactData: boolean;
  };
  suppliers: PriceChangeSupplierOption[];
  items: PriceChangeReportItem[];
};

function formatDateForInput(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMonthStartInputValue() {
  const date = new Date();
  return formatDateForInput(new Date(date.getFullYear(), date.getMonth(), 1));
}

function getTodayInputValue() {
  return formatDateForInput(new Date());
}

const fieldControlStyle: CSSProperties = {
  width: "100%",
  minHeight: 42,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  font: "inherit",
};

function formatMoney(value: string | null) {
  if (!value) {
    return "—";
  }

  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return value;
  }

  return `${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)} ₽`;
}

function formatSignedMoney(value: string | null) {
  if (!value) {
    return "—";
  }

  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return value;
  }

  const prefix = amount > 0 ? "+" : "";
  return `${prefix}${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)} ₽`;
}

function formatSignedPercent(value: string | number | null) {
  if (value === null) {
    return "—";
  }

  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return String(value);
  }

  const prefix = amount > 0 ? "+" : "";
  return `${prefix}${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: Math.abs(amount) % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount)}%`;
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getDirectionColor(value: string | null) {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount === 0) {
    return "var(--text)";
  }

  return amount > 0 ? "#dc2626" : "#15803d";
}

function getStatusStyles(status: PriceChangeStatus) {
  if (status === "confirmed") {
    return {
      color: "#166534",
      background: "rgba(74, 222, 128, 0.14)",
      border: "1px solid rgba(74, 222, 128, 0.35)",
    };
  }

  return {
    color: "#92400e",
    background: "rgba(250, 204, 21, 0.16)",
    border: "1px solid rgba(250, 204, 21, 0.35)",
  };
}

function getStatusLabel(status: PriceChangeStatus) {
  return status === "confirmed" ? "Подтверждено" : "Требует проверки";
}

function getSourceLabel(source: PriceChangeSource) {
  return source === "invoice" ? "Накладная" : source;
}

function isApiErrorResponse(value: unknown): value is { message?: string } {
  return Boolean(value && typeof value === "object" && "message" in value);
}

export function PriceChangesReport() {
  const { activeEnterpriseId, activeEnterprise } = useEnterprise();
  const [period, setPeriod] = useState<PriceChangePeriod>("7d");
  const [dateFrom, setDateFrom] = useState(getMonthStartInputValue);
  const [dateTo, setDateTo] = useState(getTodayInputValue);
  const [supplierId, setSupplierId] = useState("");
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<PriceChangeDirection>("all");
  const [report, setReport] = useState<PriceChangesReportResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const deferredQuery = useDeferredValue(query.trim());
  const customRangeIncomplete = period === "custom" && (!dateFrom || !dateTo);

  useEffect(() => {
    setSupplierId("");
  }, [activeEnterpriseId]);

  useEffect(() => {
    if (!activeEnterpriseId) {
      setReport(null);
      setErrorMessage(null);
      return;
    }

    if (customRangeIncomplete) {
      setReport(null);
      setErrorMessage("Для произвольного периода заполните обе даты.");
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      enterpriseId: activeEnterpriseId,
      period,
      direction,
    });

    if (period === "custom") {
      params.set("dateFrom", dateFrom);
      params.set("dateTo", dateTo);
    }

    if (supplierId) {
      params.set("supplierId", supplierId);
    }

    if (deferredQuery) {
      params.set("q", deferredQuery);
    }

    setIsLoading(true);
    setErrorMessage(null);

    fetch(`/api/reports/price-changes?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as PriceChangesReportResponse | { message?: string };

        if (!response.ok) {
          throw new Error(
            isApiErrorResponse(payload) && payload.message ? payload.message : "Не удалось загрузить отчет по изменениям цен.",
          );
        }

        setReport(payload as PriceChangesReportResponse);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setReport(null);
        setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить отчет по изменениям цен.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [activeEnterpriseId, customRangeIncomplete, dateFrom, dateTo, deferredQuery, direction, period, supplierId]);

  const summaryCards = useMemo(() => {
    if (!report) {
      return [];
    }

    return [
      { label: "Всего изменений", value: String(report.summary.totalChanges), color: "var(--text)" },
      { label: "Подорожало", value: String(report.summary.increasedCount), color: "#dc2626" },
      { label: "Подешевело", value: String(report.summary.decreasedCount), color: "#15803d" },
      {
        label: "Среднее изменение %",
        value: formatSignedPercent(report.summary.averageChangePercent),
        color:
          report.summary.averageChangePercent === null
            ? "var(--text)"
            : report.summary.averageChangePercent > 0
              ? "#dc2626"
              : report.summary.averageChangePercent < 0
                ? "#15803d"
                : "var(--text)",
      },
      {
        label: "Потенциальное влияние",
        value: report.summary.hasPotentialImpactData ? formatSignedMoney(report.summary.potentialImpactAmount) : "—",
        color: getDirectionColor(report.summary.potentialImpactAmount),
      },
    ];
  }, [report]);

  if (!activeEnterpriseId) {
    return (
      <section className="card pagePlaceholder">
        <p className="panelEyebrow">Отчеты</p>
        <h2 className="pageTitle">Сначала выберите предприятие</h2>
        <p className="pageDescription">Отчет по изменению цен строится только для активного предприятия.</p>
      </section>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section className="card">
        <p className="panelEyebrow">Отчеты</p>
        <h2 className="pageTitle">Изменение закупочных цен</h2>
        <p className="pageDescription">
          Read-only отчет по изменениям цен для <strong>{activeEnterprise?.name ?? "активного предприятия"}</strong> на базе
          найденных `InvoicePriceChange`.
        </p>

        <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {[
              { id: "today", label: "Сегодня" },
              { id: "7d", label: "7 дней" },
              { id: "month", label: "Месяц" },
              { id: "custom", label: "Период" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                className="button buttonGhost"
                onClick={() => setPeriod(item.id as PriceChangePeriod)}
                style={{
                  minWidth: 0,
                  background: period === item.id ? "rgba(15, 23, 42, 0.08)" : undefined,
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
              alignItems: "end",
            }}
          >
            {period === "custom" ? (
              <>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: "0.84rem", color: "var(--text-muted)" }}>Дата от</span>
                  <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} style={fieldControlStyle} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: "0.84rem", color: "var(--text-muted)" }}>Дата до</span>
                  <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} style={fieldControlStyle} />
                </label>
              </>
            ) : null}

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: "0.84rem", color: "var(--text-muted)" }}>Поставщик</span>
              <select style={fieldControlStyle} value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
                <option value="">Все поставщики</option>
                {(report?.suppliers ?? []).map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: "0.84rem", color: "var(--text-muted)" }}>Товар</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск по названию товара"
                style={fieldControlStyle}
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: "0.84rem", color: "var(--text-muted)" }}>Направление</span>
              <select style={fieldControlStyle} value={direction} onChange={(event) => setDirection(event.target.value as PriceChangeDirection)}>
                <option value="all">Все изменения</option>
                <option value="up">Только подорожание</option>
                <option value="down">Только снижение</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      {errorMessage ? (
        <section className="card">
          <p className="panelEyebrow">Ошибка</p>
          <p className="pageDescription">{errorMessage}</p>
        </section>
      ) : null}

      {report ? (
        <section className="card">
          <div className="cardHeader">
            <div>
              <p className="panelEyebrow">Сводка</p>
              <h3 className="pageTitle">Кратко по изменениям</h3>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            {summaryCards.map((card) => (
              <div key={card.label} style={{ padding: 14, border: "1px solid var(--border)", borderRadius: 14 }}>
                <p className="panelEyebrow">{card.label}</p>
                <div style={{ marginTop: 8, fontSize: "1.2rem", fontWeight: 700, color: card.color }}>{card.value}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card">
        <div className="cardHeader">
          <div>
            <p className="panelEyebrow">Таблица</p>
            <h3 className="pageTitle">Изменения цен</h3>
            <p className="pageDescription">Источник на текущем этапе: накладные. Старые структуры не затрагиваются.</p>
          </div>
        </div>

        {isLoading ? (
          <p className="pageDescription">Собираю отчет...</p>
        ) : report && report.items.length > 0 ? (
          <div className="productsTableWrap">
            <table className="productsTable">
              <thead>
                <tr>
                  <th>Дата изменения</th>
                  <th>Поставщик</th>
                  <th>Товар</th>
                  <th>Старая цена</th>
                  <th>Новая цена</th>
                  <th>Разница ₽</th>
                  <th>Разница %</th>
                  <th>Источник</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {report.items.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDateTime(item.changedAt)}</td>
                    <td style={{ whiteSpace: "normal", minWidth: 180 }}>{item.supplierName}</td>
                    <td style={{ minWidth: 280, maxWidth: 420, whiteSpace: "normal", wordBreak: "break-word" }}>
                      <strong style={{ display: "block" }}>{item.productName}</strong>
                      {item.productNameRaw !== item.productName ? (
                        <span style={{ display: "block", color: "var(--text-muted)", fontSize: "0.82rem", marginTop: 4 }}>
                          В накладной: {item.productNameRaw}
                        </span>
                      ) : null}
                      {item.quantity ? (
                        <span style={{ display: "block", color: "var(--text-muted)", fontSize: "0.82rem", marginTop: 4 }}>
                          Кол-во: {item.quantity}
                        </span>
                      ) : null}
                    </td>
                    <td>{formatMoney(item.oldPrice)}</td>
                    <td>{formatMoney(item.newPrice)}</td>
                    <td style={{ color: getDirectionColor(item.differenceAmount), fontWeight: 700 }}>{formatSignedMoney(item.differenceAmount)}</td>
                    <td style={{ color: getDirectionColor(item.differencePercent), fontWeight: 700 }}>{formatSignedPercent(item.differencePercent)}</td>
                    <td>
                      <span
                        style={{
                          display: "inline-flex",
                          padding: "6px 10px",
                          borderRadius: 999,
                          background: "rgba(59, 130, 246, 0.12)",
                          border: "1px solid rgba(59, 130, 246, 0.22)",
                          fontSize: "0.8rem",
                          fontWeight: 700,
                        }}
                      >
                        {getSourceLabel(item.source)}
                      </span>
                    </td>
                    <td>
                      <span
                        style={{
                          ...getStatusStyles(item.status),
                          display: "inline-flex",
                          padding: "6px 10px",
                          borderRadius: 999,
                          fontSize: "0.8rem",
                          fontWeight: 700,
                        }}
                      >
                        {getStatusLabel(item.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="emptyState">
            <p className="emptyStateTitle">Изменений не найдено</p>
            <p className="emptyStateText">Попробуйте другой период, поставщика или направление изменений.</p>
          </div>
        )}
      </section>
    </div>
  );
}
