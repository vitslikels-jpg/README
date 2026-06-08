"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";

type InvoiceStatus = "uploaded" | "processing" | "needs_review" | "parsed" | "approved" | "failed";

type InvoiceFile = {
  id: string;
  fileUrl: string;
  originalFileName: string | null;
  mimeType: string | null;
  pageIndex: number;
};

type InvoiceListItem = {
  id: string;
  supplierId: string | null;
  supplierName: string | null;
  detectedSupplierName: string | null;
  status: InvoiceStatus;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  totalAmount: string | null;
  vatAmount: string | null;
  originalFileName: string | null;
  fileUrl: string | null;
  files: InvoiceFile[];
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

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getSupplierGroupName(invoice: InvoiceListItem) {
  return invoice.supplierName || invoice.detectedSupplierName || "Без поставщика";
}

function isImageFile(file: InvoiceFile | null) {
  return Boolean(file?.mimeType?.startsWith("image/") || /\.(jpg|jpeg|png|webp)\b/i.test(file?.fileUrl || ""));
}

export default function InvoicesArchivePage() {
  const { activeEnterpriseId } = useEnterprise();
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

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
            <p className="pageDescription">
              Здесь собраны все загруженные документы. Накладные сгруппированы по поставщикам, чтобы быстрее открывать нужный архив.
            </p>
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
              <p className="emptyStateText">После загрузки документы появятся здесь и будут сгруппированы по поставщикам.</p>
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

                  <div className="invoicesList">
                    {group.invoices.map((invoice) => {
                      const previewFile = invoice.files[0] ?? null;
                      const extraFilesCount = Math.max(0, invoice.filesCount - 1);

                      return (
                        <Link key={invoice.id} href={`/invoices/${invoice.id}`} className="invoiceCardLink">
                          <article className="invoiceCard">
                            <div className="invoiceCardPreview">
                              {isImageFile(previewFile) ? (
                                <img
                                  src={previewFile?.fileUrl}
                                  alt={previewFile?.originalFileName || invoice.originalFileName || "Накладная"}
                                  className="invoicePreviewImage"
                                />
                              ) : (
                                <span className="invoicesEmptyIcon" aria-hidden="true">
                                  <FileText size={28} strokeWidth={2} />
                                </span>
                              )}
                              {extraFilesCount > 0 ? <span className="statusPill invoiceStatus-neutral">+{extraFilesCount} файла</span> : null}
                            </div>

                            <div className="invoiceCardHeader">
                              <div className="invoiceCardTitleBlock">
                                <h3 className="invoiceCardTitle">{invoice.invoiceNumber ? `№${invoice.invoiceNumber}` : "Номер не распознан"}</h3>
                                <p className="invoiceCardFileName">{invoice.originalFileName || "Без имени файла"}</p>
                              </div>

                              <span className={`statusPill ${statusClassNames[invoice.status]}`}>{statusLabels[invoice.status]}</span>
                            </div>

                            <div className="invoiceMetaGrid">
                              <div className="supplierMetaItem">
                                <span>Дата накладной</span>
                                <strong>{formatInvoiceDate(invoice.invoiceDate)}</strong>
                              </div>
                              <div className="supplierMetaItem">
                                <span>Сумма</span>
                                <strong>{formatMoney(invoice.totalAmount)}</strong>
                              </div>
                              <div className="supplierMetaItem">
                                <span>НДС</span>
                                <strong>{formatMoney(invoice.vatAmount)}</strong>
                              </div>
                              <div className="supplierMetaItem">
                                <span>Строк</span>
                                <strong>{invoice.itemsCount}</strong>
                              </div>
                              <div className="supplierMetaItem">
                                <span>Требует проверки</span>
                                <strong>{invoice.reviewItemsCount}</strong>
                              </div>
                              <div className="supplierMetaItem">
                                <span>Изменений цен</span>
                                <strong>{invoice.priceChangesCount}</strong>
                              </div>
                            </div>

                            <div className="invoiceCardFooter">
                              <span>Загружена: {formatDateTime(invoice.createdAt)}</span>
                              <span>Файлов: {invoice.filesCount}</span>
                            </div>
                          </article>
                        </Link>
                      );
                    })}
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
