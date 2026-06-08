"use client";

import type { CSSProperties, KeyboardEvent } from "react";
import { Fragment, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";
import type {
  PriceChangeReportItem,
  PriceChangeSource,
  PriceChangeStatus,
  PriceChangeSupplierStat,
  PriceChangesReportResponse,
  TopPriceChangeItem,
} from "@/lib/reports/price-changes";

type PriceChangeDirection = "all" | "up" | "down";
type PriceChangePeriod = "today" | "7d" | "month" | "custom";

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

function getDirectionColor(value: string | number | null) {
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

function SectionEmptyState({
  title,
  description,
  testId,
}: {
  title: string;
  description: string;
  testId?: string;
}) {
  return (
    <div className="emptyState" data-testid={testId}>
      <p className="emptyStateTitle">{title}</p>
      <p className="emptyStateText">{description}</p>
    </div>
  );
}

function TopChangesTable({
  items,
  emptyTitle,
  emptyDescription,
}: {
  items: TopPriceChangeItem[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (!items.length) {
    return <SectionEmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="productsTableWrap">
      <table className="productsTable">
        <thead>
          <tr>
            <th>Товар</th>
            <th>Поставщик</th>
            <th>Старая цена</th>
            <th>Новая цена</th>
            <th>Изменение %</th>
            <th>Изменение ₽</th>
            <th>Дата</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td style={{ minWidth: 320, maxWidth: 420, whiteSpace: "normal", wordBreak: "break-word" }}>
                <strong>{item.productName}</strong>
              </td>
              <td style={{ whiteSpace: "normal", minWidth: 180 }}>{item.supplierName}</td>
              <td>{formatMoney(item.oldPrice)}</td>
              <td>{formatMoney(item.newPrice)}</td>
              <td style={{ color: getDirectionColor(item.differencePercent), fontWeight: 700 }}>
                {formatSignedPercent(item.differencePercent)}
              </td>
              <td style={{ color: getDirectionColor(item.differenceAmount), fontWeight: 700 }}>
                {formatSignedMoney(item.differenceAmount)}
              </td>
              <td>{formatDateTime(item.changedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SupplierStatsTable({
  items,
  emptyTitle,
  emptyDescription,
}: {
  items: PriceChangeSupplierStat[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (!items.length) {
    return <SectionEmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="productsTableWrap">
      <table className="productsTable">
        <thead>
          <tr>
            <th>Поставщик</th>
            <th>Количество изменений</th>
            <th>Подорожаний</th>
            <th>Снижений</th>
            <th>Среднее изменение %</th>
            <th>Последнее изменение</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.supplierId}>
              <td style={{ whiteSpace: "normal", minWidth: 240 }}>{item.supplierName}</td>
              <td>{item.totalChanges}</td>
              <td style={{ color: "#dc2626", fontWeight: 700 }}>{item.increasedCount}</td>
              <td style={{ color: "#15803d", fontWeight: 700 }}>{item.decreasedCount}</td>
              <td style={{ color: getDirectionColor(item.averageChangePercent), fontWeight: 700 }}>
                {formatSignedPercent(item.averageChangePercent)}
              </td>
              <td>{formatDateTime(item.lastChangedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
      {
        label: "Всего изменений",
        value: String(report.summary.totalChanges),
        color: "var(--text)",
      },
      {
        label: "Уникальных товаров",
        value: String(report.summary.uniqueProductsCount),
        color: "var(--text)",
      },
      {
        label: "Максимальный рост цены",
        value: formatSignedPercent(report.summary.maxIncreasePercent),
        color: getDirectionColor(report.summary.maxIncreasePercent),
      },
      {
        label: "Максимальное снижение цены",
        value: formatSignedPercent(report.summary.maxDecreasePercent),
        color: getDirectionColor(report.summary.maxDecreasePercent),
      },
      {
        label: "Самый нестабильный поставщик",
        value: report.summary.mostUnstableSupplier?.supplierName ?? "—",
        color: "var(--text)",
        meta: report.summary.mostUnstableSupplier ? `${report.summary.mostUnstableSupplier.totalChanges} изменений` : "Нет данных",
      },
      {
        label: "Среднее изменение %",
        value: formatSignedPercent(report.summary.averageChangePercent),
        color: getDirectionColor(report.summary.averageChangePercent),
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

  const emptyStateDescription = deferredQuery
    ? "Попробуйте изменить запрос или сбросить фильтры."
    : "Попробуйте изменить период, поставщика или направление изменения.";

  const chartMaxValue = useMemo(() => {
    if (!report?.chart.length) {
      return 0;
    }

    return report.chart.reduce((maxValue, item) => Math.max(maxValue, item.increased, item.decreased), 0);
  }, [report]);

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
          Read-only отчет по изменениям цен для <strong>{activeEnterprise?.name ?? "активного предприятия"}</strong> на базе{" "}
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
              <p className="panelEyebrow">KPI</p>
              <h3 className="pageTitle">Ключевые показатели</h3>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            {summaryCards.map((card) => (
              <div key={card.label} style={{ padding: 14, border: "1px solid var(--border)", borderRadius: 14 }}>
                <p className="panelEyebrow">{card.label}</p>
                <div style={{ marginTop: 8, fontSize: "1.1rem", fontWeight: 700, color: card.color }}>{card.value}</div>
                {"meta" in card && card.meta ? (
                  <div style={{ marginTop: 6, fontSize: "0.84rem", color: "var(--text-muted)" }}>{card.meta}</div>
                ) : null}
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
        ) : report && report.chart.length > 0 ? (
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
                gridTemplateColumns: `repeat(${report.chart.length}, minmax(72px, 1fr))`,
                gap: 12,
                alignItems: "end",
                overflowX: "auto",
                paddingBottom: 4,
              }}
            >
              {report.chart.map((item) => (
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
          <SectionEmptyState
            title="За выбранный период нет данных для графика"
            description="Измените фильтры или период, чтобы увидеть динамику по дням."
            testId="price-changes-chart-empty-state"
          />
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <div>
            <p className="panelEyebrow">ТОП подорожаний</p>
            <h3 className="pageTitle">Самые сильные роста цены</h3>
            <p className="pageDescription">Компактный список 20 самых сильных подорожаний по изменению в процентах.</p>
          </div>
        </div>

        {isLoading ? (
          <p className="pageDescription">Собираю ТОП подорожаний...</p>
        ) : (
          <TopChangesTable
            items={report?.topIncreases ?? []}
            emptyTitle="За выбранный период сильных подорожаний не найдено"
            emptyDescription="Попробуйте изменить период, поставщика, запрос или направление изменения."
          />
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <div>
            <p className="panelEyebrow">ТОП снижений</p>
            <h3 className="pageTitle">Самые сильные снижения цены</h3>
            <p className="pageDescription">Компактный список 20 самых сильных снижений по изменению в процентах.</p>
          </div>
        </div>

        {isLoading ? (
          <p className="pageDescription">Собираю ТОП снижений...</p>
        ) : (
          <TopChangesTable
            items={report?.topDecreases ?? []}
            emptyTitle="За выбранный период снижений цены не найдено"
            emptyDescription="Измените фильтры или период, если хотите расширить выборку."
          />
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <div>
            <p className="panelEyebrow">Поставщики</p>
            <h3 className="pageTitle">Статистика по поставщикам</h3>
            <p className="pageDescription">Сортировка по количеству изменений за выбранный период.</p>
          </div>
        </div>

        {isLoading ? (
          <p className="pageDescription">Собираю статистику поставщиков...</p>
        ) : (
          <SupplierStatsTable
            items={report?.supplierStats ?? []}
            emptyTitle="По поставщикам пока нет данных"
            emptyDescription="За выбранный период не найдено изменений цен по поставщикам."
          />
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <div>
            <p className="panelEyebrow">Таблица</p>
            <h3 className="pageTitle">Все изменения цен</h3>
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
                {report.items.map((item: PriceChangeReportItem) => {
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
                                  <div style={{ color: getDirectionColor(item.differenceAmount), fontWeight: 700 }}>{formatSignedMoney(item.differenceAmount)}</div>
                                </div>
                                <div>
                                  <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Изменение %</div>
                                  <div style={{ color: getDirectionColor(item.differencePercent), fontWeight: 700 }}>{formatSignedPercent(item.differencePercent)}</div>
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
          <SectionEmptyState
            title={emptyStateTitle}
            description={emptyStateDescription}
            testId="price-changes-empty-state"
          />
        )}
      </section>
    </div>
  );
}
