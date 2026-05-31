"use client";

import { useEffect, useMemo, useState } from "react";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";

type ProductMasterAuditExample = {
  productId: string;
  productName: string;
  supplierName: string;
  brand: string | null;
  productMasterId: string | null;
  productMasterName: string | null;
};

type ProductMasterAuditGroup = {
  normalizedName: string;
  productsCount: number;
  suppliersCount: number;
  productMastersCount: number;
  supplierNames: string[];
  masterIds: string[];
  examples: ProductMasterAuditExample[];
};

type ProductMasterAuditMaster = {
  productMasterId: string;
  productMasterName: string;
  brand: string | null;
  groupNormalizedName: string;
  productsCount: number;
  suppliersCount: number;
  supplierNames: string[];
};

type ProductMasterAuditResponse = {
  summary: {
    totalProductMasters: number;
    suspectedDuplicateMasters: number;
    duplicatePercent: number;
    totalProducts: number;
    groupsCount: number;
    duplicateGroupsCount: number;
  };
  topDuplicateGroups: ProductMasterAuditGroup[];
  likelyDuplicateMasters: ProductMasterAuditMaster[];
  exampleGroups: Record<string, ProductMasterAuditGroup[]>;
};

type ProductMasterDuplicateReviewStatus = "needs_review" | "duplicate" | "not_duplicate";
type ReviewFilter = "all" | ProductMasterDuplicateReviewStatus;

type ProductMasterDuplicateReviewRecord = {
  id: string;
  enterpriseId: string;
  normalizedName: string;
  masterIds: string[];
  status: ProductMasterDuplicateReviewStatus;
  comment: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

function formatPercent(value: number) {
  return `${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value)}%`;
}

function isApiErrorResponse(value: unknown): value is { message?: string } {
  return Boolean(value && typeof value === "object" && "message" in value);
}

function formatLabel(key: string) {
  return key;
}

function getReviewStatusBadgeStyle(status: ProductMasterDuplicateReviewStatus) {
  if (status === "duplicate") {
    return {
      background: "rgba(248, 113, 113, 0.14)",
      border: "1px solid rgba(248, 113, 113, 0.35)",
    };
  }

  if (status === "not_duplicate") {
    return {
      background: "rgba(74, 222, 128, 0.14)",
      border: "1px solid rgba(74, 222, 128, 0.35)",
    };
  }

  return {
    background: "rgba(250, 204, 21, 0.16)",
    border: "1px solid rgba(250, 204, 21, 0.35)",
  };
}

function getReviewStatusLabel(status: ProductMasterDuplicateReviewStatus) {
  if (status === "duplicate") {
    return "Дубликат";
  }

  if (status === "not_duplicate") {
    return "Не дубликат";
  }

  return "Нужно проверить";
}

export function ProductMasterAuditReport() {
  const { activeEnterpriseId, activeEnterprise } = useEnterprise();
  const [data, setData] = useState<ProductMasterAuditResponse | null>(null);
  const [reviews, setReviews] = useState<Record<string, ProductMasterDuplicateReviewRecord>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReviewFilter>("all");

  useEffect(() => {
    if (!activeEnterpriseId) {
      setData(null);
      setReviews({});
      setErrorMessage(null);
      return;
    }

    const enterpriseId = activeEnterpriseId;
    let isCancelled = false;

    async function loadAuditAndReviews() {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const [auditResponse, reviewsResponse] = await Promise.all([
          fetch(`/api/product-master-audit?enterpriseId=${encodeURIComponent(enterpriseId)}`, {
            cache: "no-store",
          }),
          fetch(`/api/product-master-duplicate-reviews?enterpriseId=${encodeURIComponent(enterpriseId)}`, {
            cache: "no-store",
          }),
        ]);

        const auditPayload = (await auditResponse.json()) as ProductMasterAuditResponse | { message?: string };
        const reviewsPayload = (await reviewsResponse.json()) as ProductMasterDuplicateReviewRecord[] | { message?: string };

        if (!auditResponse.ok) {
          throw new Error(isApiErrorResponse(auditPayload) && auditPayload.message ? auditPayload.message : "Не удалось загрузить Product Master Audit.");
        }

        if (!reviewsResponse.ok) {
          throw new Error(isApiErrorResponse(reviewsPayload) && reviewsPayload.message ? reviewsPayload.message : "Не удалось загрузить review-статусы.");
        }

        if (!isCancelled) {
          setData(auditPayload as ProductMasterAuditResponse);
          setReviews(
            Object.fromEntries(
              (Array.isArray(reviewsPayload) ? reviewsPayload : []).map((review) => [review.normalizedName, review]),
            ),
          );
        }
      } catch (error) {
        if (!isCancelled) {
          setData(null);
          setReviews({});
          setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить Product Master Audit.");
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadAuditAndReviews();

    return () => {
      isCancelled = true;
    };
  }, [activeEnterpriseId]);

  const likelyDuplicateGroups = useMemo(() => {
    if (!data) {
      return [];
    }

    const groupsByName = new Map(data.topDuplicateGroups.map((group) => [group.normalizedName, group]));
    const grouped = new Map<
      string,
      {
        normalizedName: string;
        masterIds: string[];
        supplierNames: string[];
        examples: ProductMasterAuditExample[];
      }
    >();

    for (const item of data.likelyDuplicateMasters) {
      const group = groupsByName.get(item.groupNormalizedName);
      const current = grouped.get(item.groupNormalizedName) ?? {
        normalizedName: item.groupNormalizedName,
        masterIds: group?.masterIds ?? [item.productMasterId],
        supplierNames: group?.supplierNames ?? item.supplierNames,
        examples: group?.examples ?? [],
      };

      grouped.set(item.groupNormalizedName, current);
    }

    return Array.from(grouped.values()).slice(0, 20);
  }, [data]);

  const reviewStatusByName = useMemo(() => {
    return (normalizedName: string): ProductMasterDuplicateReviewStatus => reviews[normalizedName]?.status ?? "needs_review";
  }, [reviews]);

  const filteredTopDuplicateGroups = useMemo(() => {
    if (!data) {
      return [];
    }

    return data.topDuplicateGroups.filter((group) => {
      if (filter === "all") {
        return true;
      }

      return reviewStatusByName(group.normalizedName) === filter;
    });
  }, [data, filter, reviewStatusByName]);

  const filteredLikelyDuplicateGroups = useMemo(() => {
    return likelyDuplicateGroups.filter((group) => {
      if (filter === "all") {
        return true;
      }

      return reviewStatusByName(group.normalizedName) === filter;
    });
  }, [filter, likelyDuplicateGroups, reviewStatusByName]);

  async function handleReviewUpdate(group: ProductMasterAuditGroup, status: ProductMasterDuplicateReviewStatus) {
    if (!activeEnterpriseId) {
      return;
    }

    const currentComment = reviews[group.normalizedName]?.comment ?? "";
    const nextComment = window.prompt("Комментарий, если нужен:", currentComment);

    if (nextComment === null && currentComment === "" && status !== "needs_review") {
      return;
    }

    setIsSaving(group.normalizedName);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/product-master-duplicate-reviews", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enterpriseId: activeEnterpriseId,
          normalizedName: group.normalizedName,
          masterIds: group.masterIds,
          status,
          comment: (nextComment ?? currentComment).trim() || null,
        }),
      });

      const payload = (await response.json()) as ProductMasterDuplicateReviewRecord | { message?: string };

      if (!response.ok) {
        throw new Error(isApiErrorResponse(payload) && payload.message ? payload.message : "Не удалось сохранить review.");
      }

      setReviews((current) => ({
        ...current,
        [(payload as ProductMasterDuplicateReviewRecord).normalizedName]: payload as ProductMasterDuplicateReviewRecord,
      }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось сохранить review.");
    } finally {
      setIsSaving(null);
    }
  }

  if (!activeEnterpriseId) {
    return (
      <section className="card pagePlaceholder">
        <p className="panelEyebrow">Reports</p>
        <h2 className="pageTitle">Сначала выберите предприятие</h2>
        <p className="pageDescription">Product Master Audit строится только для активного предприятия.</p>
      </section>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section className="card">
        <p className="panelEyebrow">Reports</p>
        <h2 className="pageTitle">Product Master Audit</h2>
        <p className="pageDescription">
          Read-only аудит ProductMaster для <strong>{activeEnterprise?.name ?? "активного предприятия"}</strong>.
        </p>

        <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
          <div style={{ padding: 12, borderRadius: 12, background: "rgba(250, 204, 21, 0.16)", border: "1px solid rgba(250, 204, 21, 0.35)" }}>
            Это только аудит, merge не выполняется.
          </div>
          <div style={{ padding: 12, borderRadius: 12, background: "rgba(248, 113, 113, 0.12)", border: "1px solid rgba(248, 113, 113, 0.28)" }}>
            Часть совпадений может быть спорной.
          </div>
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
          <p className="pageDescription">Собираю Product Master Audit...</p>
        </section>
      ) : null}

      {data ? (
        <>
          <section className="card">
            <div className="cardHeader">
              <div>
                <p className="panelEyebrow">Summary</p>
                <h3 className="pageTitle">Итоговые цифры</h3>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              {[
                ["Всего ProductMaster", String(data.summary.totalProductMasters)],
                ["Подозрительных дублей", String(data.summary.suspectedDuplicateMasters)],
                ["Доля дублей", formatPercent(data.summary.duplicatePercent)],
                ["Всего Products", String(data.summary.totalProducts)],
                ["Нормализованных групп", String(data.summary.groupsCount)],
                ["Групп с дублями", String(data.summary.duplicateGroupsCount)],
              ].map(([label, value]) => (
                <div key={label} style={{ padding: 14, border: "1px solid var(--border)", borderRadius: 14 }}>
                  <p className="panelEyebrow">{label}</p>
                  <div style={{ marginTop: 8, fontSize: "1.25rem", fontWeight: 700 }}>{value}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="cardHeader">
              <div>
                <p className="panelEyebrow">Top Duplicate Groups</p>
                <h3 className="pageTitle">ТОП групп с раздробленным ProductMaster</h3>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[
                  ["all", "Все"],
                  ["needs_review", "Нужно проверить"],
                  ["duplicate", "Дубликаты"],
                  ["not_duplicate", "Не дубликаты"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className="button buttonGhost"
                    onClick={() => setFilter(value as ReviewFilter)}
                    style={{
                      minWidth: 0,
                      background: filter === value ? "rgba(15, 23, 42, 0.08)" : undefined,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="productsTableWrap">
              <table className="productsTable">
                <thead>
                  <tr>
                    <th>normalizedName</th>
                    <th>Review</th>
                    <th>Products</th>
                    <th>Suppliers</th>
                    <th>Masters</th>
                    <th>Поставщики</th>
                    <th>Примеры</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTopDuplicateGroups.map((group) => {
                    const status = reviewStatusByName(group.normalizedName);
                    const review = reviews[group.normalizedName] ?? null;

                    return (
                      <tr key={`${group.normalizedName}:${group.masterIds.join(",")}`}>
                        <td>
                          <strong>{group.normalizedName}</strong>
                          <span>{review?.comment ?? "Без комментария"}</span>
                        </td>
                        <td>
                          <div
                            style={{
                              ...getReviewStatusBadgeStyle(status),
                              borderRadius: 999,
                              padding: "6px 10px",
                              fontSize: "0.8rem",
                              fontWeight: 700,
                              display: "inline-flex",
                              marginBottom: 8,
                            }}
                          >
                            {getReviewStatusLabel(status)}
                          </div>

                          <div style={{ display: "grid", gap: 6 }}>
                            <button
                              type="button"
                              className="button buttonGhost"
                              disabled={isSaving === group.normalizedName}
                              onClick={() => void handleReviewUpdate(group, "duplicate")}
                            >
                              Дубликат
                            </button>
                            <button
                              type="button"
                              className="button buttonGhost"
                              disabled={isSaving === group.normalizedName}
                              onClick={() => void handleReviewUpdate(group, "not_duplicate")}
                            >
                              Не дубликат
                            </button>
                            <button
                              type="button"
                              className="button buttonGhost"
                              disabled={isSaving === group.normalizedName}
                              onClick={() => void handleReviewUpdate(group, "needs_review")}
                            >
                              Проверить позже
                            </button>
                          </div>
                        </td>
                        <td>{group.productsCount}</td>
                        <td>{group.suppliersCount}</td>
                        <td>{group.productMastersCount}</td>
                        <td>{group.supplierNames.join(", ")}</td>
                        <td>
                          {group.examples.slice(0, 3).map((example) => (
                            <div key={example.productId} style={{ marginBottom: 8 }}>
                              <strong>{example.productName}</strong>
                              <span>{example.supplierName}{example.brand ? ` · ${example.brand}` : ""}</span>
                            </div>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="cardHeader">
              <div>
                <p className="panelEyebrow">Likely Duplicate Masters</p>
                <h3 className="pageTitle">Самые вероятные дубли</h3>
              </div>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              {filteredLikelyDuplicateGroups.map((group) => {
                const status = reviewStatusByName(group.normalizedName);

                return (
                  <article key={group.normalizedName} style={{ padding: 14, border: "1px solid var(--border)", borderRadius: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 8 }}>
                      <strong>{group.normalizedName}</strong>
                      <div
                        style={{
                          ...getReviewStatusBadgeStyle(status),
                          borderRadius: 999,
                          padding: "6px 10px",
                          fontSize: "0.8rem",
                          fontWeight: 700,
                          display: "inline-flex",
                        }}
                      >
                        {getReviewStatusLabel(status)}
                      </div>
                    </div>
                    <div style={{ color: "var(--text-muted)", fontSize: "0.92rem", marginBottom: 8 }}>
                      Master IDs: {group.masterIds.join(", ")}
                    </div>
                    <div style={{ color: "var(--text-muted)", fontSize: "0.92rem", marginBottom: 8 }}>
                      Поставщики: {group.supplierNames.join(", ")}
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {group.examples.slice(0, 3).map((example) => (
                        <div key={example.productId}>
                          <strong>{example.productName}</strong>
                          <span style={{ display: "block", color: "var(--text-muted)", fontSize: "0.82rem" }}>
                            {example.supplierName}{example.productMasterName ? ` · ${example.productMasterName}` : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="card">
            <div className="cardHeader">
              <div>
                <p className="panelEyebrow">Examples</p>
                <h3 className="pageTitle">Примеры по товарам</h3>
              </div>
            </div>

            <div style={{ display: "grid", gap: 16 }}>
              {Object.entries(data.exampleGroups).map(([key, groups]) => (
                <div key={key} style={{ padding: 14, border: "1px solid var(--border)", borderRadius: 14 }}>
                  <strong style={{ display: "block", marginBottom: 10 }}>{formatLabel(key)}</strong>

                  {groups.length === 0 ? (
                    <span style={{ color: "var(--text-muted)", fontSize: "0.92rem" }}>Ничего не найдено.</span>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      {groups.map((group) => {
                        const status = reviewStatusByName(group.normalizedName);

                        return (
                          <div key={`${key}:${group.normalizedName}`}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                              <strong>{group.normalizedName}</strong>
                              <div
                                style={{
                                  ...getReviewStatusBadgeStyle(status),
                                  borderRadius: 999,
                                  padding: "4px 8px",
                                  fontSize: "0.76rem",
                                  fontWeight: 700,
                                  display: "inline-flex",
                                }}
                              >
                                {getReviewStatusLabel(status)}
                              </div>
                            </div>
                            <span style={{ display: "block", color: "var(--text-muted)", fontSize: "0.82rem" }}>
                              Products: {group.productsCount} · Suppliers: {group.suppliersCount} · Masters: {group.productMastersCount}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
