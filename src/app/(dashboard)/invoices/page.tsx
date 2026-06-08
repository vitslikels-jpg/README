"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";

type InvoiceStatus = "uploaded" | "processing" | "needs_review" | "parsed" | "approved" | "failed";

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
  filesCount: number;
  createdAt: string;
  itemsCount: number;
  priceChangesCount: number;
  pendingPriceChangesCount: number;
  reviewItemsCount: number;
};

type UploadResultSummary = {
  summary: string;
  details: string[];
  note: string | null;
};

type BatchInvoiceProcessResult = {
  invoiceId: string;
  invoiceNumber: string | null;
  itemsCount?: number;
  reviewItemsCount?: number;
  error?: string;
};

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 10;
const acceptedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

const statusLabels: Record<InvoiceStatus, string> = {
  uploaded: "Загружена",
  processing: "Обрабатывается",
  needs_review: "Проверка",
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

function getSupplierName(invoice: InvoiceListItem) {
  return invoice.supplierName || invoice.detectedSupplierName || "Без поставщика";
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

export default function InvoicesPage() {
  const { activeEnterpriseId } = useEnterprise();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [uploadResult, setUploadResult] = useState<UploadResultSummary | null>(null);
  const [isProcessingNewInvoices, setIsProcessingNewInvoices] = useState(false);
  const [processingNewInvoicesProgress, setProcessingNewInvoicesProgress] = useState("");
  const [processingNewInvoicesResults, setProcessingNewInvoicesResults] = useState<BatchInvoiceProcessResult[]>([]);

  const loadInvoices = useCallback(async (enterpriseId: string, signal?: AbortSignal) => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const params = new URLSearchParams({
        enterpriseId,
        status: "active",
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

  const refreshInvoicesAfterMutation = useCallback(
    async (enterpriseId: string) => {
      await loadInvoices(enterpriseId);
      await new Promise((resolve) => setTimeout(resolve, 250));
      await loadInvoices(enterpriseId);
    },
    [loadInvoices],
  );

  useEffect(() => {
    if (!activeEnterpriseId) {
      setInvoices([]);
      setErrorMessage("");
      setSuccessMessage("");
      setUploadResult(null);
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

  const unprocessedInvoices = useMemo(
    () => invoices.filter((invoice) => invoice.status === "uploaded" || invoice.itemsCount === 0),
    [invoices],
  );
  const recentInvoices = useMemo(() => invoices.slice(0, 5), [invoices]);
  const isBusy = isLoading || isUploading || isProcessingNewInvoices;

  async function handleProcessNewInvoices() {
    if (!activeEnterpriseId || unprocessedInvoices.length === 0) {
      return;
    }

    setIsProcessingNewInvoices(true);
    setProcessingNewInvoicesResults([]);
    setProcessingNewInvoicesProgress("");
    setErrorMessage("");
    setSuccessMessage("");
    setUploadResult(null);

    const results: BatchInvoiceProcessResult[] = [];

    for (const [index, invoice] of unprocessedInvoices.entries()) {
      const invoiceLabel = invoice.invoiceNumber ? `№${invoice.invoiceNumber}` : "без номера";
      setProcessingNewInvoicesProgress(`Обрабатывается ${index + 1} из ${unprocessedInvoices.length}: ${invoiceLabel}`);

      try {
        const query = new URLSearchParams({ enterpriseId: activeEnterpriseId });

        const processResponse = await fetch(`/api/invoices/${invoice.id}/process?${query.toString()}`, {
          method: "POST",
        });
        const processPayload = (await processResponse.json().catch(() => null)) as { message?: string } | null;
        if (!processResponse.ok) {
          throw new Error(processPayload?.message ?? "Не удалось распознать текст.");
        }

        const aiResponse = await fetch(`/api/invoices/${invoice.id}/ai-parse?${query.toString()}`, {
          method: "POST",
        });
        const aiPayload = (await aiResponse.json().catch(() => null)) as { message?: string } | null;
        if (!aiResponse.ok) {
          throw new Error(aiPayload?.message ?? "AI не нашёл товары.");
        }

        const detectResponse = await fetch(`/api/invoices/${invoice.id}/detect-price-changes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enterpriseId: activeEnterpriseId }),
        });
        const detectPayload = (await detectResponse.json().catch(() => null)) as { message?: string } | null;
        if (!detectResponse.ok) {
          throw new Error(detectPayload?.message ?? "Не удалось проверить изменения цен.");
        }

        const detailsResponse = await fetch(`/api/invoices/${invoice.id}?${query.toString()}`, {
          cache: "no-store",
        });
        const detailsPayload = (await detailsResponse.json().catch(() => null)) as
          | {
              invoice?: {
                invoiceNumber?: string | null;
                items?: Array<{ needsReview?: boolean }>;
              };
              message?: string;
            }
          | null;

        if (!detailsResponse.ok || !detailsPayload?.invoice) {
          throw new Error(detailsPayload?.message ?? "Не удалось обновить данные накладной.");
        }

        const itemsCount = detailsPayload.invoice.items?.length ?? 0;
        const reviewItemsCount = detailsPayload.invoice.items?.filter((item) => item.needsReview).length ?? 0;

        results.push({
          invoiceId: invoice.id,
          invoiceNumber: detailsPayload.invoice.invoiceNumber ?? invoice.invoiceNumber,
          itemsCount,
          reviewItemsCount,
        });
      } catch (error) {
        results.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          error: error instanceof Error ? error.message : "Не удалось обработать накладную.",
        });
      }
    }

    await refreshInvoicesAfterMutation(activeEnterpriseId);
    setProcessingNewInvoicesResults(results);
    setProcessingNewInvoicesProgress("");
    setSuccessMessage("Обработка завершена.");
    setIsProcessingNewInvoices(false);
  }

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);

    if (files.length === 0 || !activeEnterpriseId) {
      return;
    }

    if (files.length > MAX_FILES_PER_UPLOAD) {
      setSuccessMessage("");
      setUploadResult(null);
      setErrorMessage("За одну загрузку можно выбрать максимум 10 файлов.");
      event.target.value = "";
      return;
    }

    const invalidFile = files.find((file) => getClientFileError(file));
    if (invalidFile) {
      setSuccessMessage("");
      setUploadResult(null);
      setErrorMessage(`${invalidFile.name}: ${getClientFileError(invalidFile)}`);
      event.target.value = "";
      return;
    }

    setIsUploading(true);
    setErrorMessage("");
    setSuccessMessage("");
    setUploadResult(null);

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
        | {
            invoices?: Array<{
              id: string;
              invoiceNumber?: string | null;
              itemsCount?: number;
              reviewItemsCount?: number;
              priceChangesCount?: number;
              processingError?: string | null;
            }>;
            createdCount?: number;
            processedCount?: number;
            failedCount?: number;
            splitApplied?: boolean;
            message?: string;
          }
        | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? "Не удалось загрузить накладные.");
      }

      await refreshInvoicesAfterMutation(activeEnterpriseId);

      const createdCount = payload?.createdCount ?? payload?.invoices?.length ?? 1;
      const processedCount = payload?.processedCount ?? 0;
      const failedCount = payload?.failedCount ?? 0;
      const summaryText = `Создано: ${createdCount}. Обработано: ${processedCount}. Ошибки: ${failedCount}.`;
      const details = (payload?.invoices ?? []).map((invoice) => {
        const invoiceLabel = invoice.invoiceNumber ? `№${invoice.invoiceNumber}` : "Номер не распознан";
        if (invoice.processingError) {
          return `${invoiceLabel} — ошибка: ${invoice.processingError}`;
        }

        return `${invoiceLabel} — товаров ${invoice.itemsCount ?? 0}, требует проверки ${invoice.reviewItemsCount ?? 0}, изменений цен ${invoice.priceChangesCount ?? 0}`;
      });

      setSuccessMessage(summaryText);
      setUploadResult({
        summary: summaryText,
        details,
        note: payload?.splitApplied ? "Файлы автоматически разделены по номерам накладных." : null,
      });
    } catch (error) {
      setSuccessMessage("");
      setUploadResult(null);
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
    setUploadResult(null);

    try {
      const query = new URLSearchParams({ enterpriseId: activeEnterpriseId });
      const response = await fetch(`/api/invoices/${invoiceId}?${query.toString()}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? "Не удалось удалить накладную.");
      }

      await refreshInvoicesAfterMutation(activeEnterpriseId);
      setSuccessMessage("Накладная удалена.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось удалить накладную.");
    } finally {
      setDeletingInvoiceId(null);
    }
  }

  return (
    <div className="pageStack">
      <section className="card invoicesHero invoicesHeroCompact">
        <div className="invoicesHeroHeader invoicesHeroHeaderCompact">
          <div className="invoicesHeroCopy">
            <p className="panelEyebrow">Накладные</p>
            <h2 className="pageTitle">Загрузка накладных</h2>
            <p className="pageDescription">Загрузите фото или PDF. Накладные будут автоматически разделены и обработаны.</p>
          </div>

          <div className="invoicesHeroActions invoicesHeroActionsCompact">
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

        <div className="invoicesStatsBar" aria-label="Сводка по накладным">
          <span>В работе: {summary.totalInvoices}</span>
          <span>Изменения цен: {summary.pendingPriceChanges}</span>
          <span>Требуют проверки: {summary.needsReview}</span>
        </div>

        {unprocessedInvoices.length > 0 ? (
          <div className="invoiceItemEditActions">
            <span className="invoiceHint">Найдено {unprocessedInvoices.length} накладных без разобранных товаров</span>
            <button
              type="button"
              className="secondaryButton compactButton"
              onClick={() => void handleProcessNewInvoices()}
              disabled={!activeEnterpriseId || isUploading || isLoading || isProcessingNewInvoices}
            >
              {isProcessingNewInvoices ? "Обрабатываем..." : "Распознать новые накладные"}
            </button>
          </div>
        ) : null}
      </section>

      {!activeEnterpriseId ? (
        <section className="card pagePlaceholder">
          <p className="panelEyebrow">Накладные</p>
          <h2 className="pageTitle">Сначала выберите предприятие</h2>
          <p className="pageDescription">Чтобы открыть накладные, выберите активное предприятие в верхней панели.</p>
        </section>
      ) : (
        <section className="card">
          <div className="cardHeader">
            <div>
              <p className="panelEyebrow">Список</p>
              <h2 className="sectionTitle">В работе</h2>
            </div>
            <Link href="/invoices/archive" className="secondaryButton compactButton">
              Подтверждённые
            </Link>
          </div>

          {errorMessage ? <p className="errorText">{errorMessage}</p> : null}
          {successMessage ? (
            <div className="successText">
              <p>{successMessage}</p>
              {uploadResult?.note ? <p>{uploadResult.note}</p> : null}
              {uploadResult?.details.length ? (
                <ul>
                  {uploadResult.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {processingNewInvoicesProgress ? <p className="invoiceHint">{processingNewInvoicesProgress}</p> : null}
          {processingNewInvoicesResults.length > 0 ? (
            <div className="successText">
              <ul>
                {processingNewInvoicesResults.map((result) => (
                  <li key={result.invoiceId}>
                    {result.invoiceNumber ? `№${result.invoiceNumber}` : "Номер не распознан"}{" "}
                    {result.error ? `— ошибка: ${result.error}` : `— товаров ${result.itemsCount ?? 0}, требует проверки ${result.reviewItemsCount ?? 0}`}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {isBusy ? (
            <div className="emptyState invoicesEmptyState">
              <span className="invoicesEmptyIcon" aria-hidden="true">
                <FileText size={28} strokeWidth={2} />
              </span>
              <p className="emptyStateTitle">Обрабатываем накладные...</p>
              <p className="emptyStateText">Ждём завершения загрузки и разбора документов.</p>
            </div>
          ) : recentInvoices.length === 0 ? (
            <div className="emptyState invoicesEmptyState">
              <span className="invoicesEmptyIcon" aria-hidden="true">
                <FileText size={28} strokeWidth={2} />
              </span>
              <p className="emptyStateTitle">Накладных в работе нет</p>
              <p className="emptyStateText">Здесь появятся загруженные накладные, найденные товары и изменения цен.</p>
            </div>
          ) : (
            <div className="invoicesCompactList">
              {recentInvoices.map((invoice) => (
                <Link key={invoice.id} href={`/invoices/${invoice.id}`} className="invoiceRowLink">
                  <article className="invoiceRow">
                    <div className="invoiceRowMain">
                      <span className="invoiceRowField invoiceRowPrimary">{invoice.invoiceNumber ? `№${invoice.invoiceNumber}` : "Без номера"}</span>
                      <span className="invoiceRowField">{formatInvoiceDate(invoice.invoiceDate)}</span>
                      <span className="invoiceRowField">{getSupplierName(invoice)}</span>
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
          )}
        </section>
      )}
    </div>
  );
}
