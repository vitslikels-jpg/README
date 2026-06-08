"use client";

import type { CSSProperties, KeyboardEvent } from "react";
import { Fragment, useDeferredValue, useEffect, useMemo, useState } from "react";
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
  invoiceNumber: string | null;
  invoiceDate: string | null;
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

const PERIOD_OPTIONS: Array<{ id: PriceChangePeriod; label: string }> = [
  { id: "today", label: "Сегодня" },
  { id: "7d", label: "7 дней" },
  { id: "month", label: "Месяц" },
  { id: "custom", label: "Произвольный" },
];

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

function formatDateTime(value: string | null) {
  if (!value) {
    return "—";
  }

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

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
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
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<PriceChangeDirection>("all");
  const [report, setReport] = useState<PriceChangesReportResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  const deferredQuery = useDeferredValue(query.trim());
  const isCustomPeriodIncomplete = period === "custom" && (!dateFrom || !dateTo);
  const reportQueryString = useMemo(() => {
    if (!activeEnterpriseId || isCustomPeriodIncomplete) {
      return "";
    }

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

    return params.toString();
  }, [activeEnterpriseId, dateFrom, dateTo, deferredQuery, direction, isCustomPeriodIncomplete, period, supplierId]);

  useEffect(() => {
    setSupplierId("");
    setExpandedItemId(null);
  }, [activeEnterpriseId]);

  useEffect(() => {
    if (!activeEnterpriseId) {
      setReport(null);
      setErrorMessage(null);
      setIsLoading(false);
      return;
    }

    if (isCustomPeriodIncomplete) {
      setErrorMessage(null);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();

    setIsLoading(true);
    setErrorMessage(null);

    fetch(`/api/reports/price-changes?${reportQueryString}`, {
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
  }, [activeEnterpriseId, isCustomPeriodIncomplete, reportQueryString]);

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

  const customPeriodHint =
    period === "custom" && isCustomPeriodIncomplete
      ? "Выберите дату начала и дату окончания. После этого отчет обновится автоматически."
      : null;

  const emptyStateTitle = deferredQuery ? "По вашему поиску ничего не найдено" : "За выбранный период изменений цен не найдено";

  const chartData = useMemo(() => {
    if (!report?.items.length) {
      return [];
    }

    const formatter = new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
    });
    const grouped = new Map<string, { key: string; label: string; increased: number; decreased: number }>();

    for (const item of report.items) {
      const date = new Date(item.changedAt);

      if (Number.isNaN(date.getTime())) {
        continue;
      }

      const key = date.toISOString().slice(0, 10);
      const current = grouped.get(key) ?? {
        key,
        label: formatter.format(date),
        increased: 0,
        decreased: 0,
      };
      const difference = Number(item.differenceAmount ?? "0");

      if (difference > 0) {
        current.increased += 1;
      } else if (difference < 0) {
        current.decreased += 1;
      }

      grouped.set(key, current);
    }

    return Array.from(grouped.values()).sort((left, right) => left.key.localeCompare(right.key));
  }, [report]);

  const chartMaxValue = useMemo(() => {
    if (!chartData.length) {
      return 0;
    }

    return chartData.reduce((maxValue, item) => Math.max(maxValue, item.increased, item.decreased), 0);
  }, [chartData]);

  const emptyStateDescription = deferredQuery
    ? "Попробуйте изменить запрос или сбросить фильтры."
    : "Попробуйте изменить период, поставщика или направление изменения.";

  function toggleExpandedItem(itemId: string) {
    setExpandedItemId((current) => (current === itemId ? null : itemId));
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, itemId: string) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    toggleExpandedItem(itemId);
  }

  async function handleExport() {
    if (!reportQueryString || isExporting) {
      return;
    }

    setIsExporting(true);

    try {
      const response = await fetch(`/api/reports/price-changes/export?${reportQueryString}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message || "Не удалось скачать Excel.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "price-changes-report.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось скачать Excel.");
    } finally {
      setIsExporting(false);
    }
  }

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
          Read-only отчет по изменениям цен для <strong>{activeEnterprise?.name ?? "активного предприятия"}</strong> на базе найденных{" "}
          <code>InvoicePriceChange</code>.
        </p>

        <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {PERIOD_OPTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="button buttonGhost"
                data-period-button={item.id}
                aria-pressed={period === item.id}
                onClick={() => setPeriod(item.id)}
                style={{
                  minWidth: 0,
                  background: period === item.id ? "rgba(15, 23, 42, 0.08)" : undefined,
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          {customPeriodHint ? (
            <div
              style={{
                padding: 12,
                borderRadius: 12,
                border: "1px solid rgba(59, 130, 246, 0.18)",
                background: "rgba(59, 130, 246, 0.06)",
                color: "var(--text-muted)",
                fontSize: "0.92rem",
              }}
            >
              {customPeriodHint}
            </div>
          ) : null}

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
                  <input
                    data-testid="price-changes-date-from"
                    type="date"
                    value={dateFrom}
                    onChange={(event) => setDateFrom(event.target.value)}
                    style={fieldControlStyle}
                  />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: "0.84rem", color: "var(--text-muted)" }}>Дата до</span>
                  <input
                    data-testid="price-changes-date-to"
                    type="date"
                    value={dateTo}
                    onChange={(event) => setDateTo(event.target.value)}
                    style={fieldControlStyle}
                  />
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
            <p className="panelEyebrow">График</p>
            <h3 className="pageTitle">Динамика изменений по дням</h3>
            <p className="pageDescription">Красный — рост цены, зеленый — снижение цены.</p>
          </div>
        </div>

        {isLoading ? (
          <p className="pageDescription">Собираю график...</p>
        ) : report && chartData.length > 0 ? (
          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, color: "var(--text-muted)", fontSize: "0.9rem" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 12, height: 12, borderRadius: 999, background: "#dc2626" }} />
                Рост цены
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 12, height: 12, borderRadius: 999, background: "#15803d" }} />
                Снижение цены
              </span>
            </div>

            <div
              data-testid="price-changes-chart"
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${chartData.length}, minmax(72px, 1fr))`,
                gap: 12,
                alignItems: "end",
                overflowX: "auto",
                paddingBottom: 4,
              }}
            >
              {chartData.map((item) => (
                <div key={item.key} style={{ display: "grid", gap: 8, minWidth: 72 }}>
                  <div style={{ height: 180, display: "flex", alignItems: "end", justifyContent: "center", gap: 8 }}>
                    <div
                      title={`Рост: ${item.increased}`}
                      style={{
                        width: 18,
                        minHeight: item.increased > 0 ? 12 : 4,
                        height: chartMaxValue > 0 ? `${(item.increased / chartMaxValue) * 100}%` : 4,
                        borderRadius: "10px 10px 0 0",
                        background: "#dc2626",
                      }}
                    />
                    <div
                      title={`Снижение: ${item.decreased}`}
                      style={{
                        width: 18,
                        minHeight: item.decreased > 0 ? 12 : 4,
                        height: chartMaxValue > 0 ? `${(item.decreased / chartMaxValue) * 100}%` : 4,
                        borderRadius: "10px 10px 0 0",
                        background: "#15803d",
                      }}
                    />
                  </div>

                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontWeight: 700 }}>{item.label}</div>
                    <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                      ↑ {item.increased} • ↓ {item.decreased}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="emptyState" data-testid="price-changes-chart-empty-state">
            <p className="emptyStateTitle">За выбранный период нет данных для графика</p>
            <p className="emptyStateText">Измените фильтры или период, чтобы увидеть динамику по дням.</p>
          </div>
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <div>
            <p className="panelEyebrow">Таблица</p>
            <h3 className="pageTitle">Изменения цен</h3>
            <p className="pageDescription">Источник на текущем этапе: накладные. Старые структуры не затрагиваются.</p>
          </div>
          <button
            type="button"
            className="button buttonGhost"
            onClick={handleExport}
            disabled={!reportQueryString || isExporting}
          >
            {isExporting ? "Экспорт..." : "Экспорт в Excel"}
          </button>
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
                  <th>Накладная</th>
                  <th>Источник</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {report.items.map((item) => {
                  const isExpanded = expandedItemId === item.id;

                  return (
                    <Fragment key={item.id}>
                      <tr
                        data-price-change-row={item.id}
                        onClick={() => toggleExpandedItem(item.id)}
                        onKeyDown={(event) => handleRowKeyDown(event, item.id)}
                        tabIndex={0}
                        style={{ cursor: "pointer" }}
                      >
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
                        <td>{item.invoiceNumber?.trim() || "—"}</td>
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
                          <div style={{ display: "grid", gap: 8 }}>
                            <span
                              style={{
                                ...getStatusStyles(item.status),
                                display: "inline-flex",
                                width: "fit-content",
                                padding: "6px 10px",
                                borderRadius: 999,
                                fontSize: "0.8rem",
                                fontWeight: 700,
                              }}
                            >
                              {getStatusLabel(item.status)}
                            </span>
                            <button
                              type="button"
                              className="button buttonGhost"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleExpandedItem(item.id);
                              }}
                              style={{ minWidth: 0 }}
                            >
                              {isExpanded ? "Скрыть" : "Подробнее"}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {isExpanded ? (
                        <tr data-price-change-details={item.id}>
                          <td colSpan={10} style={{ padding: 0 }}>
                            <div
                              style={{
                                display: "grid",
                                gap: 12,
                                padding: 16,
                                borderTop: "1px solid var(--border)",
                                background: "rgba(248, 250, 252, 0.8)",
                              }}
                            >
                              <strong style={{ fontSize: "0.96rem" }}>Детали изменения</strong>

                              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                                <div>
                                  <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Поставщик</div>
                                  <div>{item.supplierName}</div>
                                </div>
                                <div>
                                  <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Товар</div>
                                  <div>{item.productName}</div>
                                </div>
                                <div>
                                  <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Старая цена</div>
                                  <div>{formatMoney(item.oldPrice)}</div>
                                </div>
                                <div>
                                  <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Новая цена</div>
                                  <div>{formatMoney(item.newPrice)}</div>
                                </div>
                                <div>
                                  <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Изменение ₽</div>
                                  <div style={{ color: getDirectionColor(item.differenceAmount), fontWeight: 700 }}>
                                    {formatSignedMoney(item.differenceAmount)}
                                  </div>
                                </div>
                                <div>
                                  <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Изменение %</div>
                                  <div style={{ color: getDirectionColor(item.differencePercent), fontWeight: 700 }}>
                                    {formatSignedPercent(item.differencePercent)}
                                  </div>
                                </div>
                                <div>
                                  <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Номер накладной</div>
                                  <div>{item.invoiceNumber?.trim() || "—"}</div>
                                </div>
                                <div>
                                  <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Дата накладной</div>
                                  <div>{formatDate(item.invoiceDate)}</div>
                                </div>
                                <div>
                                  <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Статус изменения</div>
                                  <div>{getStatusLabel(item.status)}</div>
                                </div>
                                <div>
                                  <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Источник</div>
                                  <div>{getSourceLabel(item.source)}</div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="emptyState" data-testid="price-changes-empty-state">
            <p className="emptyStateTitle">{emptyStateTitle}</p>
            <p className="emptyStateText">{emptyStateDescription}</p>
          </div>
        )}
      </section>
    </div>
  );
}
