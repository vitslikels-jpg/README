"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FileText, Receipt, SearchCheck, TrendingUp } from "lucide-react";
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

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 10;
const acceptedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

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

function getSupplierName(invoice: InvoiceListItem) {
  return invoice.supplierName || invoice.detectedSupplierName || "Поставщик не определён";
}

function getClientFileError(file: File) {
  if (file.size === 0) {
    return "Нельзя загрузить пустой файл.";
  }

  if (file.size > MAX_FILE_SIZE) {
    return "Файл слишком большой. Максимум 15 MB.";
  }

  if (!acceptedMimeTypes.has(file.type)) {
    return "Поддерживаются только JPG, PNG, WEBP и PDF.";
  }

  return "";
}

function isImageFile(file: InvoiceFile | null) {
  return Boolean(file?.mimeType?.startsWith("image/") || /\.(jpg|jpeg|png|webp)\b/i.test(file?.fileUrl || ""));
}

export default function InvoicesPage() {
  const { activeEnterpriseId } = useEnterprise();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const loadInvoices = useCallback(async (enterpriseId: string, signal?: AbortSignal) => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const params = new URLSearchParams({
        enterpriseId,
      });

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
      setSuccessMessage("");
      return;
    }

    const controller = new AbortController();
    void loadInvoices(activeEnterpriseId, controller.signal);

    return () => controller.abort();
  }, [activeEnterpriseId, loadInvoices]);

  const summary = useMemo(() => {
    const totalInvoices = invoices.length;
    const pendingPriceChanges = invoices.reduce((sum, invoice) => sum + invoice.pendingPriceChangesCount, 0);
    const needsReview = invoices.reduce((sum, invoice) => {
      const hasReviewStatus = invoice.status === "needs_review" || invoice.status === "failed" ? 1 : 0;
      return sum + hasReviewStatus + invoice.reviewItemsCount;
    }, 0);

    return {
      totalInvoices,
      pendingPriceChanges,
      needsReview,
    };
  }, [invoices]);

  const stats = [
    {
      title: "Последние накладные",
      value: String(summary.totalInvoices),
      icon: Receipt,
    },
    {
      title: "Изменения цен",
      value: String(summary.pendingPriceChanges),
      icon: TrendingUp,
    },
    {
      title: "Требуют проверки",
      value: String(summary.needsReview),
      icon: SearchCheck,
    },
  ];

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);

    if (files.length === 0 || !activeEnterpriseId) {
      return;
    }

    if (files.length > MAX_FILES_PER_UPLOAD) {
      setSuccessMessage("");
      setErrorMessage("За одну загрузку можно выбрать максимум 10 файлов.");
      event.target.value = "";
      return;
    }

    const invalidFile = files.find((file) => getClientFileError(file));

    if (invalidFile) {
      setSuccessMessage("");
      setErrorMessage(`${invalidFile.name}: ${getClientFileError(invalidFile)}`);
      event.target.value = "";
      return;
    }

    setIsUploading(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const formData = new FormData();
      formData.append("enterpriseId", activeEnterpriseId);

      for (const file of files) {
        formData.append("file", file);
      }

      const response = await fetch("/api/invoices/upload", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json().catch(() => null)) as
        | { invoice?: { id: string; filesCount?: number }; message?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? "Не удалось загрузить накладную.");
      }

      await loadInvoices(activeEnterpriseId);

      const uploadedCount = payload?.invoice?.filesCount ?? files.length;
      setSuccessMessage(uploadedCount === 1 ? "Накладная загружена." : `Накладная загружена. Файлов: ${uploadedCount}.`);
    } catch (error) {
      setSuccessMessage("");
      setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить накладную.");
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  }

  function openFilePicker() {
    if (!activeEnterpriseId || isUploading) {
      return;
    }

    fileInputRef.current?.click();
  }

  async function handleDeleteInvoice(invoiceId: string) {
    if (!activeEnterpriseId) {
      return;
    }

    if (!window.confirm("Удалить накладную? Это действие нельзя отменить.")) {
      return;
    }

    setDeletingInvoiceId(invoiceId);
    setErrorMessage("");
    setSuccessMessage("");

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
      setSuccessMessage("Накладная удалена.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось удалить накладную.");
    } finally {
      setDeletingInvoiceId(null);
    }
  }

  return (
    <div className="pageStack">
      <section className="card invoicesHero">
        <div className="invoicesHeroHeader">
          <div className="invoicesHeroCopy">
            <p className="panelEyebrow">Накладные</p>
            <h2 className="pageTitle">Накладные</h2>
            <p className="pageDescription">
              Загружайте фото или PDF накладных, чтобы находить изменения цен и обновлять внутренний накопитель после
              проверки.
            </p>
            <p className="invoiceHint">Можно выбрать несколько фото одной накладной.</p>
          </div>

          <div className="invoicesHeroActions">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="invoicesHiddenInput"
              onChange={(event) => void handleFileSelected(event)}
              disabled={!activeEnterpriseId || isUploading}
            />
            <button
              type="button"
              className="primaryButton compactButton"
              onClick={openFilePicker}
              disabled={!activeEnterpriseId || isUploading}
            >
              {isUploading ? "Загружаем..." : "Загрузить накладную"}
            </button>
          </div>
        </div>

        <div className="invoicesStatsGrid" aria-label="Сводка по накладным">
          {stats.map((item) => {
            const Icon = item.icon;

            return (
              <article key={item.title} className="invoicesStatCard">
                <div className="invoicesStatHeader">
                  <span className="invoicesStatIcon" aria-hidden="true">
                    <Icon size={18} strokeWidth={2} />
                  </span>
                  <span className="invoicesStatTitle">{item.title}</span>
                </div>
                <strong className="invoicesStatValue">{item.value}</strong>
              </article>
            );
          })}
        </div>
      </section>

      {!activeEnterpriseId ? (
        <section className="card pagePlaceholder">
          <p className="panelEyebrow">Накладные</p>
          <h2 className="pageTitle">Сначала выберите предприятие</h2>
          <p className="pageDescription">
            Чтобы открыть накладные, выберите активное предприятие в верхней панели.
          </p>
        </section>
      ) : (
        <section className="card">
          <div className="cardHeader">
            <div>
              <p className="panelEyebrow">Список</p>
              <h2 className="sectionTitle">Последние накладные</h2>
            </div>
          </div>

          {errorMessage ? <p className="errorText">{errorMessage}</p> : null}
          {successMessage ? <p className="successText">{successMessage}</p> : null}

          {isLoading ? (
            <div className="emptyState invoicesEmptyState">
              <span className="invoicesEmptyIcon" aria-hidden="true">
                <FileText size={28} strokeWidth={2} />
              </span>
              <p className="emptyStateTitle">Загрузка накладных</p>
              <p className="emptyStateText">Список накладных загружается.</p>
            </div>
          ) : invoices.length === 0 ? (
            <div className="emptyState invoicesEmptyState">
              <span className="invoicesEmptyIcon" aria-hidden="true">
                <FileText size={28} strokeWidth={2} />
              </span>
              <p className="emptyStateTitle">Накладных пока нет</p>
              <p className="emptyStateText">
                Здесь появятся загруженные накладные, найденные товары и изменения цен.
              </p>
            </div>
          ) : (
            <div className="invoicesList">
              {invoices.map((invoice) => (
                <Link key={invoice.id} href={`/invoices/${invoice.id}`} className="invoiceCardLink">
                  <article className="invoiceCard">
                  {(() => {
                    const previewFile = invoice.files[0] ?? null;
                    const extraFilesCount = Math.max(0, invoice.filesCount - 1);

                    return (
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
                    );
                  })()}
                  <div className="invoiceCardHeader">
                    <div className="invoiceCardTitleBlock">
                      <h3 className="invoiceCardTitle">{getSupplierName(invoice)}</h3>
                      <p className="invoiceCardFileName">{invoice.originalFileName || "???? ??? ?????"}</p>
                    </div>

                    <div className="invoiceHeaderActions">
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
                        {deletingInvoiceId === invoice.id ? "???????..." : "???????"}
                      </button>
                      <span className={`statusPill ${statusClassNames[invoice.status]}`}>{statusLabels[invoice.status]}</span>
                    </div>
                  </div>

                  <div className="invoiceMetaGrid">
                    <div className="supplierMetaItem">
                      <span>Номер</span>
                      <strong>{invoice.invoiceNumber || "—"}</strong>
                    </div>
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
                      <span>Изменений цен</span>
                      <strong>{invoice.priceChangesCount}</strong>
                    </div>
                    <div className="supplierMetaItem">
                      <span>Ожидают проверки цен</span>
                      <strong>{invoice.pendingPriceChangesCount}</strong>
                    </div>
                    <div className="supplierMetaItem">
                      <span>Строки на проверку</span>
                      <strong>{invoice.reviewItemsCount}</strong>
                    </div>
                  </div>

                  <div className="invoiceCardFooter">
                    <span>Загружена: {formatDateTime(invoice.createdAt)}</span>
                    <span>Файлов: {invoice.filesCount}</span>
                    {invoice.detectedSupplierName && !invoice.supplierName ? (
                      <span>Распознанный поставщик: {invoice.detectedSupplierName}</span>
                    ) : null}
                  </div>
                  </article>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
