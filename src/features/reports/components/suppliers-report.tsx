"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";
import type {
  SupplierReportSupplierStat,
  SupplierWithoutChangesItem,
  SuppliersReportResponse,
} from "@/lib/reports/suppliers";

type SuppliersReportPeriod = "today" | "7d" | "month" | "custom";

const PERIOD_OPTIONS: Array<{ id: SuppliersReportPeriod; label: string }> = [
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

function formatSignedPercent(value: number | null) {
  if (value === null) {
    return "—";
  }

  const prefix = value > 0 ? "+" : "";

  return `${prefix}${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: Math.abs(value) % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value)}%`;
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

function getDirectionColor(value: number | null) {
  if (value === null || value === 0) {
    return "var(--text)";
  }

  return value > 0 ? "#dc2626" : "#15803d";
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

function SupplierStatsTable({
  items,
  mode,
  emptyTitle,
  emptyDescription,
}: {
  items: SupplierReportSupplierStat[];
  mode: "changes" | "increase" | "decrease" | "unstable";
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
            <th>Изменений</th>
            <th>Ростов</th>
            <th>Снижений</th>
            <th>
              {mode === "increase"
                ? "Средний рост %"
                : mode === "decrease"
                  ? "Среднее снижение %"
                  : "Среднее изменение %"}
            </th>
            <th>Последнее изменение</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const targetValue =
              mode === "increase"
                ? item.averageIncreasePercent
                : mode === "decrease"
                  ? item.averageDecreasePercent
                  : item.averageChangePercent;

            return (
              <tr key={item.supplierId}>
                <td style={{ whiteSpace: "normal", minWidth: 220 }}>{item.supplierName}</td>
                <td>{item.totalChanges}</td>
                <td style={{ color: "#dc2626", fontWeight: 700 }}>{item.increasedCount}</td>
                <td style={{ color: "#15803d", fontWeight: 700 }}>{item.decreasedCount}</td>
                <td style={{ color: getDirectionColor(targetValue), fontWeight: 700 }}>
                  {formatSignedPercent(targetValue)}
                </td>
                <td>{formatDateTime(item.lastChangedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SuppliersWithoutChangesTable({
  items,
  emptyTitle,
  emptyDescription,
}: {
  items: SupplierWithoutChangesItem[];
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
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.supplierId}>
              <td style={{ whiteSpace: "normal", minWidth: 260 }}>{item.supplierName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SuppliersReport() {
  const { activeEnterpriseId, activeEnterprise } = useEnterprise();
  const [period, setPeriod] = useState<SuppliersReportPeriod>("7d");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [report, setReport] = useState<SuppliersReportResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

    return params.toString();
  }, [activeEnterpriseId, dateFrom, dateTo, isCustomPeriodIncomplete, period]);

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

    fetch(`/api/reports/suppliers?${reportQueryString}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as SuppliersReportResponse | { message?: string };

        if (!response.ok) {
          throw new Error(
            isApiErrorResponse(payload) && payload.message
              ? payload.message
              : "Не удалось загрузить отчёт по поставщикам.",
          );
        }

        setReport(payload as SuppliersReportResponse);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setReport(null);
        setErrorMessage(
          error instanceof Error ? error.message : "Не удалось загрузить отчёт по поставщикам.",
        );
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
        label: "Всего поставщиков",
        value: String(report.summary.totalSuppliersCount),
        color: "var(--text)",
      },
      {
        label: "Активных поставщиков",
        value: String(report.summary.activeSuppliersCount),
        color: "var(--text)",
      },
      {
        label: "С изменениями цен",
        value: String(report.summary.suppliersWithChangesCount),
        color: "var(--text)",
      },
      {
        label: "Среднее изменение цены",
        value: formatSignedPercent(report.summary.averageSupplierChangePercent),
        color: getDirectionColor(report.summary.averageSupplierChangePercent),
      },
      {
        label: "Самый нестабильный поставщик",
        value: report.summary.mostUnstableSupplier?.supplierName ?? "—",
        color: "var(--text)",
        meta: report.summary.mostUnstableSupplier
          ? `${report.summary.mostUnstableSupplier.totalChanges} изменений, ${formatSignedPercent(
              report.summary.mostUnstableSupplier.averageChangePercent,
            )}`
          : "Нет данных",
      },
    ];
  }, [report]);

  const changesChartMaxValue = useMemo(() => {
    if (!report?.charts.changesBySuppliers.length) {
      return 0;
    }

    return report.charts.changesBySuppliers.reduce(
      (maxValue, item) => Math.max(maxValue, item.totalChanges),
      0,
    );
  }, [report]);

  const directionChartMaxValue = useMemo(() => {
    if (!report?.charts.directionBySuppliers.length) {
      return 0;
    }

    return report.charts.directionBySuppliers.reduce(
      (maxValue, item) => Math.max(maxValue, item.increasedCount, item.decreasedCount),
      0,
    );
  }, [report]);

  const customPeriodHint =
    period === "custom" && isCustomPeriodIncomplete
      ? "Выберите дату начала и дату окончания. После этого отчёт обновится автоматически."
      : null;

  if (!activeEnterpriseId) {
    return (
      <section className="card pagePlaceholder">
        <h2 className="pageTitle">Сначала выберите предприятие</h2>
        <p className="pageDescription">
          Отчёт по поставщикам строится только для активного предприятия.
        </p>
      </section>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section className="card">
        <h2 className="pageTitle">Отчёт по поставщикам</h2>
        <p className="pageDescription">
          Отчёт строится по данным накладных и изменениям цен за выбранный период
          {activeEnterprise ? ` для ${activeEnterprise.name}` : ""}.
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

          {period === "custom" ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
                alignItems: "end",
              }}
            >
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: "0.84rem", color: "var(--text-muted)" }}>Дата от</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  style={fieldControlStyle}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: "0.84rem", color: "var(--text-muted)" }}>Дата до</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  style={fieldControlStyle}
                />
              </label>
            </div>
          ) : null}
        </div>
      </section>

      {errorMessage ? (
        <section className="card">
          <p className="panelEyebrow">Ошибка</p>
          <p className="pageDescription">{errorMessage}</p>
        </section>
      ) : null}

      {isLoading ? (
        <section className="card">
          <p className="panelEyebrow">Загрузка</p>
          <p className="pageDescription">Собираю отчёт по поставщикам...</p>
        </section>
      ) : null}

      {report ? (
        <>
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
                  <div style={{ marginTop: 8, fontSize: "1.1rem", fontWeight: 700, color: card.color }}>
                    {card.value}
                  </div>
                  {"meta" in card && card.meta ? (
                    <div style={{ marginTop: 6, fontSize: "0.84rem", color: "var(--text-muted)" }}>
                      {card.meta}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="cardHeader">
              <div>
                <p className="panelEyebrow">График</p>
                <h3 className="pageTitle">Изменения цен по поставщикам</h3>
                <p className="pageDescription">Показаны поставщики с наибольшим числом изменений за период.</p>
              </div>
            </div>

            {report.charts.changesBySuppliers.length > 0 ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${report.charts.changesBySuppliers.length}, minmax(88px, 1fr))`,
                  gap: 12,
                  alignItems: "end",
                  overflowX: "auto",
                  paddingBottom: 4,
                }}
              >
                {report.charts.changesBySuppliers.map((item) => (
                  <div key={item.supplierId} style={{ display: "grid", gap: 8, minWidth: 88 }}>
                    <div style={{ height: 180, display: "flex", alignItems: "end", justifyContent: "center" }}>
                      <div
                        title={`${item.supplierName}: ${item.totalChanges}`}
                        style={{
                          width: 28,
                          minHeight: item.totalChanges > 0 ? 12 : 4,
                          height: changesChartMaxValue > 0 ? `${(item.totalChanges / changesChartMaxValue) * 100}%` : 4,
                          borderRadius: "10px 10px 0 0",
                          background: "rgba(15, 23, 42, 0.72)",
                        }}
                      />
                    </div>

                    <div style={{ textAlign: "center" }}>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: "0.82rem",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={item.supplierName}
                      >
                        {item.supplierName}
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{item.totalChanges}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <SectionEmptyState
                title="За выбранный период нет данных по изменениям"
                description="Когда в накладных появятся изменения цен, здесь будет график по поставщикам."
                testId="suppliers-report-changes-chart-empty-state"
              />
            )}
          </section>

          <section className="card">
            <div className="cardHeader">
              <div>
                <p className="panelEyebrow">График</p>
                <h3 className="pageTitle">Рост / снижение цен по поставщикам</h3>
                <p className="pageDescription">Красный - рост цен, зелёный - снижение цен.</p>
              </div>
            </div>

            {report.charts.directionBySuppliers.length > 0 ? (
              <div style={{ display: "grid", gap: 16 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 16, color: "var(--text-muted)", fontSize: "0.9rem" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 999, background: "#dc2626" }} />
                    Рост цен
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 999, background: "#15803d" }} />
                    Снижение цен
                  </span>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${report.charts.directionBySuppliers.length}, minmax(88px, 1fr))`,
                    gap: 12,
                    alignItems: "end",
                    overflowX: "auto",
                    paddingBottom: 4,
                  }}
                >
                  {report.charts.directionBySuppliers.map((item) => (
                    <div key={item.supplierId} style={{ display: "grid", gap: 8, minWidth: 88 }}>
                      <div style={{ height: 180, display: "flex", alignItems: "end", justifyContent: "center", gap: 8 }}>
                        <div
                          title={`Рост: ${item.increasedCount}`}
                          style={{
                            width: 18,
                            minHeight: item.increasedCount > 0 ? 12 : 4,
                            height:
                              directionChartMaxValue > 0
                                ? `${(item.increasedCount / directionChartMaxValue) * 100}%`
                                : 4,
                            borderRadius: "10px 10px 0 0",
                            background: "#dc2626",
                          }}
                        />
                        <div
                          title={`Снижение: ${item.decreasedCount}`}
                          style={{
                            width: 18,
                            minHeight: item.decreasedCount > 0 ? 12 : 4,
                            height:
                              directionChartMaxValue > 0
                                ? `${(item.decreasedCount / directionChartMaxValue) * 100}%`
                                : 4,
                            borderRadius: "10px 10px 0 0",
                            background: "#15803d",
                          }}
                        />
                      </div>

                      <div style={{ textAlign: "center" }}>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: "0.82rem",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={item.supplierName}
                        >
                          {item.supplierName}
                        </div>
                        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                          ↑ {item.increasedCount} • ↓ {item.decreasedCount}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <SectionEmptyState
                title="За выбранный период нет данных по росту и снижению цен"
                description="Когда в накладных появятся изменения цен, здесь будет разрез по поставщикам."
                testId="suppliers-report-direction-chart-empty-state"
              />
            )}
          </section>

          <section className="card">
            <div className="cardHeader">
              <div>
                <p className="panelEyebrow">ТОП</p>
                <h3 className="pageTitle">ТОП поставщиков по количеству изменений цен</h3>
              </div>
            </div>

            <SupplierStatsTable
              items={report.tables.topByChanges}
              mode="changes"
              emptyTitle="Нет поставщиков с изменениями цен"
              emptyDescription="За выбранный период изменения цен в накладных не найдены."
            />
          </section>

          <section className="card">
            <div className="cardHeader">
              <div>
                <p className="panelEyebrow">ТОП</p>
                <h3 className="pageTitle">ТОП поставщиков по среднему росту цен</h3>
              </div>
            </div>

            <SupplierStatsTable
              items={report.tables.topByAverageIncrease}
              mode="increase"
              emptyTitle="Нет поставщиков со средним ростом цен"
              emptyDescription="За выбранный период рост цен по поставщикам не найден."
            />
          </section>

          <section className="card">
            <div className="cardHeader">
              <div>
                <p className="panelEyebrow">ТОП</p>
                <h3 className="pageTitle">ТОП поставщиков по среднему снижению цен</h3>
              </div>
            </div>

            <SupplierStatsTable
              items={report.tables.topByAverageDecrease}
              mode="decrease"
              emptyTitle="Нет поставщиков со средним снижением цен"
              emptyDescription="За выбранный период снижения цен по поставщикам не найдены."
            />
          </section>

          <section className="card">
            <div className="cardHeader">
              <div>
                <p className="panelEyebrow">Контроль</p>
                <h3 className="pageTitle">Поставщики без изменений цен</h3>
                <p className="pageDescription">Список активных поставщиков, у которых за период не найдено изменений цен в накладных.</p>
              </div>
            </div>

            <SuppliersWithoutChangesTable
              items={report.tables.withoutChanges}
              emptyTitle="Все активные поставщики попали в изменения цен"
              emptyDescription="За выбранный период у каждого активного поставщика были изменения цен."
            />
          </section>

          <section className="card">
            <div className="cardHeader">
              <div>
                <p className="panelEyebrow">Риск</p>
                <h3 className="pageTitle">Нестабильные поставщики</h3>
                <p className="pageDescription">MVP-логика: сортировка по числу изменений, затем по модулю среднего изменения цены.</p>
              </div>
            </div>

            <SupplierStatsTable
              items={report.tables.unstable}
              mode="unstable"
              emptyTitle="Нестабильные поставщики не найдены"
              emptyDescription="За выбранный период нет данных для оценки нестабильности поставщиков."
            />
          </section>
        </>
      ) : null}
    </div>
  );
}
