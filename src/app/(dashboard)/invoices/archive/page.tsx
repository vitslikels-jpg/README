"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";

type InvoiceStatus = "uploaded" | "processing" | "needs_review" | "parsed" | "approved" | "failed";
type InvoiceSource = "manual" | "telegram";

type InvoiceListItem = {
  id: string;
  source: InvoiceSource;
  supplierId: string | null;
  supplierName: string | null;
  detectedSupplierName: string | null;
  status: InvoiceStatus;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  totalAmount: string | null;
  vatAmount: string | null;
  filesCount: number;
  createdAt: string;
  itemsCount: number;
  priceChangesCount: number;
  pendingPriceChangesCount: number;
  reviewItemsCount: number;
};

const statusLabels: Record<InvoiceStatus, string> = {
  uploaded: "Загружена",
  processing: "Обрабатывается",
  needs_review: "Требует проверки",
  parsed: "Разобрана",
  approved: "Подтверждена",
  failed: "Ошибка",
};

const statusClassNames: Record<InvoiceStatus, string> = {
  uploaded: "invoiceStatus-neutral",
  processing: "invoiceStatus-processing",
  needs_review: "invoiceStatus-review",
  parsed: "invoiceStatus-neutral",
  approved: "invoiceStatus-approved",
  failed: "invoiceStatus-failed",
};

const sourceLabels: Record<InvoiceSource, string> = {
  manual: "Вручную",
  telegram: "Telegram",
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
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount)} ₽`;
}

function formatInvoiceDate(value: string | null) {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function getSupplierGroupName(invoice: InvoiceListItem) {
  return invoice.supplierName || invoice.detectedSupplierName || "Без поставщика";
}

export default function InvoicesArchivePage() {
  const { activeEnterpriseId } = useEnterprise();
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null);

  const loadInvoices = useCallback(async (enterpriseId: string, signal?: AbortSignal) => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const params = new URLSearchParams({ enterpriseId, status: "approved" });
      const response = await fetch(`/api/invoices?${params.toString()}`, {
        cache: "no-store",
        signal,
      });
      const payload = (await response.json().catch(() => null)) as
        | { invoices?: InvoiceListItem[]; message?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? "Не удалось загрузить накладные.");
      }

      setInvoices(payload?.invoices ?? []);
    } catch (error) {
      if (signal?.aborted) {
        return;
      }

      setInvoices([]);
      setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить накладные.");
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!activeEnterpriseId) {
      setInvoices([]);
      setErrorMessage("");
      return;
    }

    const controller = new AbortController();
    void loadInvoices(activeEnterpriseId, controller.signal);
    return () => controller.abort();
  }, [activeEnterpriseId, loadInvoices]);

  async function handleDeleteInvoice(invoiceId: string) {
    if (!activeEnterpriseId) {
      return;
    }

    if (!window.confirm("Удалить накладную? Это действие нельзя отменить.")) {
      return;
    }

    setDeletingInvoiceId(invoiceId);
    setErrorMessage("");

    try {
      const query = new URLSearchParams({ enterpriseId: activeEnterpriseId });
      const response = await fetch(`/api/invoices/${invoiceId}?${query.toString()}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? "Не удалось удалить накладную.");
      }

      await loadInvoices(activeEnterpriseId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось удалить накладную.");
    } finally {
      setDeletingInvoiceId(null);
    }
  }

  const groupedInvoices = useMemo(() => {
    const groups = new Map<string, InvoiceListItem[]>();

    for (const invoice of invoices) {
      const groupName = getSupplierGroupName(invoice);
      const group = groups.get(groupName) ?? [];
      group.push(invoice);
      groups.set(groupName, group);
    }

    return Array.from(groups.entries())
      .map(([supplierName, supplierInvoices]) => ({
        supplierName,
        invoices: supplierInvoices,
      }))
      .sort((left, right) => left.supplierName.localeCompare(right.supplierName, "ru"));
  }, [invoices]);

  return (
    <div className="pageStack">
      <section className="card invoicesHero">
        <div className="invoicesHeroHeader">
          <div className="invoicesHeroCopy">
            <p className="panelEyebrow">Накладные</p>
            <h2 className="pageTitle">Подтверждённые накладные</h2>
            <p className="pageDescription">Здесь лежит архив завершённых накладных. Документы сгруппированы по поставщикам.</p>
          </div>
        </div>
      </section>

      {!activeEnterpriseId ? (
        <section className="card pagePlaceholder">
          <p className="panelEyebrow">Накладные</p>
          <h2 className="pageTitle">Сначала выберите предприятие</h2>
          <p className="pageDescription">Чтобы открыть архив накладных, выберите активное предприятие в верхней панели.</p>
        </section>
      ) : (
        <section className="card">
          <div className="cardHeader">
            <div>
              <p className="panelEyebrow">Архив</p>
              <h2 className="sectionTitle">Подтверждённые накладные</h2>
            </div>
          </div>

          {errorMessage ? <p className="errorText">{errorMessage}</p> : null}

          {isLoading ? (
            <div className="emptyState invoicesEmptyState">
              <span className="invoicesEmptyIcon" aria-hidden="true">
                <FileText size={28} strokeWidth={2} />
              </span>
              <p className="emptyStateTitle">Загрузка архива</p>
              <p className="emptyStateText">Список накладных загружается.</p>
            </div>
          ) : groupedInvoices.length === 0 ? (
            <div className="emptyState invoicesEmptyState">
              <span className="invoicesEmptyIcon" aria-hidden="true">
                <FileText size={28} strokeWidth={2} />
              </span>
              <p className="emptyStateTitle">Подтверждённых накладных пока нет</p>
              <p className="emptyStateText">После завершения накладные будут попадать сюда автоматически.</p>
            </div>
          ) : (
            <div className="pageStack">
              {groupedInvoices.map((group) => (
                <section key={group.supplierName} className="pageStack" style={{ gap: 12 }}>
                  <div>
                    <p className="panelEyebrow">Поставщик</p>
                    <h3 className="sectionTitle" style={{ fontSize: "1.2rem" }}>
                      {group.supplierName}
                    </h3>
                  </div>

                  <div className="invoicesCompactList">
                    {group.invoices.map((invoice) => (
                      <Link key={invoice.id} href={`/invoices/${invoice.id}`} className="invoiceRowLink">
                        <article className="invoiceRow">
                          <div className="invoiceRowMain">
                            <span className="invoiceRowField invoiceRowPrimary">{invoice.invoiceNumber ? `№${invoice.invoiceNumber}` : "Без номера"}</span>
                            <span className="invoiceRowField">{formatInvoiceDate(invoice.invoiceDate)}</span>
                            <span className="invoiceRowField">{group.supplierName}</span>
                            <span className="invoiceRowField">{sourceLabels[invoice.source]}</span>
                            <span className="invoiceRowField">{formatMoney(invoice.totalAmount)}</span>
                            <span className="invoiceRowField">НДС {formatMoney(invoice.vatAmount)}</span>
                            <span className="invoiceRowField">{invoice.itemsCount} строк</span>
                          </div>

                          <div className="invoiceRowActions">
                            <span className={`statusPill ${statusClassNames[invoice.status]}`}>{statusLabels[invoice.status]}</span>
                            <button
                              type="button"
                              className="secondaryButton compactButton"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void handleDeleteInvoice(invoice.id);
                              }}
                              disabled={deletingInvoiceId === invoice.id}
                            >
                              {deletingInvoiceId === invoice.id ? "Удаляем..." : "Удалить"}
                            </button>
                          </div>
                        </article>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
