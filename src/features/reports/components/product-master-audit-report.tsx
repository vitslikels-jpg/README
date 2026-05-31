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
  if (key === "масло сливочное") {
    return "масло сливочное";
  }

  return key;
}

export function ProductMasterAuditReport() {
  const { activeEnterpriseId, activeEnterprise } = useEnterprise();
  const [data, setData] = useState<ProductMasterAuditResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!activeEnterpriseId) {
      setData(null);
      setErrorMessage(null);
      return;
    }

    const enterpriseId = activeEnterpriseId;
    let isCancelled = false;

    async function loadAudit() {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetch(`/api/product-master-audit?enterpriseId=${encodeURIComponent(enterpriseId)}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as ProductMasterAuditResponse | { message?: string };

        if (!response.ok) {
          throw new Error(isApiErrorResponse(payload) && payload.message ? payload.message : "Не удалось загрузить Product Master Audit.");
        }

        if (!isCancelled) {
          setData(payload as ProductMasterAuditResponse);
        }
      } catch (error) {
        if (!isCancelled) {
          setData(null);
          setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить Product Master Audit.");
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadAudit();

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
            </div>

            <div className="productsTableWrap">
              <table className="productsTable">
                <thead>
                  <tr>
                    <th>normalizedName</th>
                    <th>Products</th>
                    <th>Suppliers</th>
                    <th>Masters</th>
                    <th>Поставщики</th>
                    <th>Примеры</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topDuplicateGroups.map((group) => (
                    <tr key={`${group.normalizedName}:${group.masterIds.join(",")}`}>
                      <td><strong>{group.normalizedName}</strong></td>
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
                  ))}
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
              {likelyDuplicateGroups.map((group) => (
                <article key={group.normalizedName} style={{ padding: 14, border: "1px solid var(--border)", borderRadius: 14 }}>
                  <strong style={{ display: "block", marginBottom: 8 }}>{group.normalizedName}</strong>
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
              ))}
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
                      {groups.map((group) => (
                        <div key={`${key}:${group.normalizedName}`}>
                          <strong>{group.normalizedName}</strong>
                          <span style={{ display: "block", color: "var(--text-muted)", fontSize: "0.82rem" }}>
                            Products: {group.productsCount} · Suppliers: {group.suppliersCount} · Masters: {group.productMastersCount}
                          </span>
                        </div>
                      ))}
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
