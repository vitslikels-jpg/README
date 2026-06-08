"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PriceChangesReport } from "@/features/reports/components/price-changes-report";
import { ProductMasterAuditReport } from "@/features/reports/components/product-master-audit-report";

type ReportsTab = "overview" | "price-changes";

const REPORT_TABS: Array<{ id: ReportsTab; label: string }> = [
  { id: "overview", label: "Обзор" },
  { id: "price-changes", label: "Изменение цен" },
];

export function ReportsPageContent() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeTab = useMemo<ReportsTab>(() => {
    const tab = searchParams.get("tab");
    return tab === "price-changes" ? "price-changes" : "overview";
  }, [searchParams]);

  function handleTabChange(tab: ReportsTab) {
    const nextParams = new URLSearchParams(searchParams.toString());

    if (tab === "overview") {
      nextParams.delete("tab");
    } else {
      nextParams.set("tab", tab);
    }

    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section className="card">
        <p className="panelEyebrow">Отчеты</p>
        <h1 className="pageTitle">Отчеты</h1>
        <p className="pageDescription">Текущий аудит сохранен в «Обзор». Новый отчет по изменениям закупочных цен вынесен в отдельную подвкладку.</p>

        <div
          className="ordersStatusTabs"
          role="tablist"
          aria-label="Подвкладки отчетов"
          style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", marginTop: 20, marginBottom: 0 }}
        >
          {REPORT_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`ordersStatusTab ${activeTab === tab.id ? "ordersStatusTabActive" : ""}`}
              onClick={() => handleTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {activeTab === "overview" ? <ProductMasterAuditReport /> : <PriceChangesReport />}
    </div>
  );
}
