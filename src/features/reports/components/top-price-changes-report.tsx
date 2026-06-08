"use client";

import type { CSSProperties } from "react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";
import type {
  TopPriceChangeItem,
  TopPriceChangeSupplierStat,
  TopPriceChangesReportResponse,
} from "@/lib/reports/top-price-changes";

type TopPriceChangesPeriod = "today" | "7d" | "month" | "custom";

const PERIOD_OPTIONS: Array<{ id: TopPriceChangesPeriod; label: string }> = [
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

  return `${amount > 0 ? "+" : ""}${new Intl.NumberFormat("ru-RU", {
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

  return `${amount > 0 ? "+" : ""}${new Intl.NumberFormat("ru-RU", {
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

function getDirectionColor(value: string | number | null) {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount === 0) {
    return "var(--text)";
  }

  return amount > 0 ? "#dc2626" : "#15803d";
}

function isApiErrorResponse(value: unknown): value is { message?: string } {
  return Boolean(value && typeof value === "object" && "message" in value);
}

function SectionEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="emptyState">
      <p className="emptyStateTitle">{title}</p>
      <p className="emptyStateText">{description}</p>
    </div>
  );
}

function PriceChangesTopTable({
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
              <td style={{ minWidth: 320, maxWidth: 440, whiteSpace: "normal", wordBreak: "break-word" }}>
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
  items: TopPriceChangeSupplierStat[];
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

export function TopPriceChangesReport() {
  const { activeEnterpriseId, activeEnterprise } = useEnterprise();
  const [period, setPeriod] = useState<TopPriceChangesPeriod>("7d");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [query, setQuery] = useState("");
  const [report, setReport] = useState<TopPriceChangesReportResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const deferredQuery = useDeferredValue(query.trim());
  const isCustomPeriodIncomplete = period === "custom" && (!dateFrom || !dateTo);
  const reportQueryString = useMemo(() => {
    if (!activeEnterpriseId || isCustomPeriodIncomplete) {
      return "";
    }

    const params = new URLSearchParams({
      enterpriseId: activeEnterpriseId,
      period,
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
  }, [activeEnterpriseId, dateFrom, dateTo, deferredQuery, isCustomPeriodIncomplete, period, supplierId]);

  useEffect(() => {
    setSupplierId("");
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

    fetch(`/api/reports/top-price-changes?${reportQueryString}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as TopPriceChangesReportResponse | { message?: string };

        if (!response.ok) {
          throw new Error(
            isApiErrorResponse(payload) && payload.message ? payload.message : "Не удалось загрузить отчет ТОП изменений цен.",
          );
        }

        setReport(payload as TopPriceChangesReportResponse);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setReport(null);
        setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить отчет ТОП изменений цен.");
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

  const customPeriodHint =
    period === "custom" && isCustomPeriodIncomplete
      ? "Выберите дату начала и дату окончания. После этого отчет обновится автоматически."
      : null;

  const summaryCards = useMemo(() => {
    if (!report) {
      return [];
    }

    return [
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
        label: "Всего изменений за период",
        value: String(report.summary.totalChanges),
        color: "var(--text)",
      },
      {
        label: "Уникальных товаров",
        value: String(report.summary.uniqueProductsCount),
        color: "var(--text)",
      },
    ];
  }, [report]);

  if (!activeEnterpriseId) {
    return (
      <section className="card pagePlaceholder">
        <p className="panelEyebrow">Отчеты</p>
        <h2 className="pageTitle">Сначала выберите предприятие</h2>
        <p className="pageDescription">Отчет строится только для активного предприятия.</p>
      </section>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section className="card">
        <p className="panelEyebrow">Отчеты</p>
        <h1 className="pageTitle">ТОП изменений цен</h1>
        <p className="pageDescription">
          Read-only аналитика по самым сильным изменениям закупочных цен для{" "}
          <strong>{activeEnterprise?.name ?? "активного предприятия"}</strong> на базе <code>InvoicePriceChange</code>.
        </p>

        <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {PERIOD_OPTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="button buttonGhost"
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
                <div style={{ marginTop: 8, fontSize: "1.2rem", fontWeight: 700, color: card.color }}>{card.value}</div>
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
            <p className="panelEyebrow">ТОП подорожаний</p>
            <h3 className="pageTitle">Самые сильные роста цены</h3>
            <p className="pageDescription">Показаны 20 самых сильных подорожаний по изменению в процентах.</p>
          </div>
        </div>

        {isLoading ? (
          <p className="pageDescription">Собираю ТОП подорожаний...</p>
        ) : (
          <PriceChangesTopTable
            items={report?.topIncreases ?? []}
            emptyTitle="За выбранный период сильных подорожаний не найдено"
            emptyDescription="Попробуйте изменить период, поставщика или поисковый запрос."
          />
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <div>
            <p className="panelEyebrow">ТОП снижений</p>
            <h3 className="pageTitle">Самые сильные снижения цены</h3>
            <p className="pageDescription">Показаны 20 самых сильных снижений по изменению в процентах.</p>
          </div>
        </div>

        {isLoading ? (
          <p className="pageDescription">Собираю ТОП снижений...</p>
        ) : (
          <PriceChangesTopTable
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
    </div>
  );
}
