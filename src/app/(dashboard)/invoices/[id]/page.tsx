"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ExternalLink, FileText } from "lucide-react";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";

type InvoiceStatus = "uploaded" | "processing" | "needs_review" | "parsed" | "approved" | "failed";
type PriceChangeStatus = "pending" | "approved" | "rejected";

type InvoiceItem = {
  id: string;
  productNameRaw: string;
  matchedProductId: string | null;
  matchedProductStatus: "matched" | "ambiguous" | "not_found";
  matchedProductName: string | null;
  matchedProductArticle: string | null;
  matchedProductBrand: string | null;
  quantity: string | null;
  unit: string | null;
  priceWithoutVat: string | null;
  priceWithVat: string | null;
  vatRate: string | null;
  lineTotal: string | null;
  confidence: number | null;
  needsReview: boolean;
};

type InvoicePriceChange = {
  id: string;
  invoiceItemId: string;
  productId: string;
  productName: string;
  oldPrice: string | null;
  newPrice: string;
  differenceAmount: string | null;
  differencePercent: string | null;
  status: PriceChangeStatus;
};

type ProductSearchResult = {
  id: string;
  name: string;
  supplierId: string;
  supplierName: string | null;
};

type InvoiceDetails = {
  id: string;
  status: InvoiceStatus;
  supplierId: string | null;
  supplierName: string | null;
  detectedSupplierName: string | null;
  confidence: number | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  totalAmount: string | null;
  vatAmount: string | null;
  originalFileName: string | null;
  fileUrl: string | null;
  rawText: string | null;
  createdAt: string;
  updatedAt: string;
  items: InvoiceItem[];
  priceChanges: InvoicePriceChange[];
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

const priceChangeStatusLabels: Record<PriceChangeStatus, string> = {
  pending: "На проверке",
  approved: "Подтверждено",
  rejected: "Отклонено",
};

const priceChangeStatusClassNames: Record<PriceChangeStatus, string> = {
  pending: "invoiceStatus-review",
  approved: "invoiceStatus-approved",
  rejected: "invoiceStatus-failed",
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

function formatNumber(value: string | null, digits = 3) {
  if (!value) {
    return "—";
  }

  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return value;
  }

  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : Math.min(2, digits),
    maximumFractionDigits: digits,
  }).format(amount);
}

function formatPercent(value: string | null) {
  if (!value) {
    return "—";
  }

  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return value;
  }

  return `${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount)}%`;
}

function formatDate(value: string | null) {
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

function getSupplierName(invoice: InvoiceDetails) {
  return invoice.supplierName || invoice.detectedSupplierName || "Поставщик не определён";
}

function detectFileKind(fileUrl: string | null, fileName: string | null) {
  const candidate = `${fileUrl || ""} ${fileName || ""}`.toLowerCase();

  if (candidate.includes(".jpg") || candidate.includes(".jpeg") || candidate.includes(".png") || candidate.includes(".webp")) {
    return "image";
  }

  if (candidate.includes(".pdf")) {
    return "pdf";
  }

  return "file";
}

function getMatchedProductLabel(item: InvoiceItem) {
  if (!item.matchedProductName) {
    return item.matchedProductStatus === "ambiguous" ? "Требует выбора" : "Не найден";
  }

  return [item.matchedProductName, item.matchedProductArticle, item.matchedProductBrand].filter(Boolean).join(" • ");
}

export default function InvoiceDetailsPage() {
  const params = useParams<{ id: string }>();
  const { activeEnterpriseId } = useEnterprise();
  const [invoice, setInvoice] = useState<InvoiceDetails | null>(null);
  const [draftRawText, setDraftRawText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingRawText, setIsSavingRawText] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isParsingItems, setIsParsingItems] = useState(false);
  const [isDetectingPriceChanges, setIsDetectingPriceChanges] = useState(false);
  const [isApprovingInvoice, setIsApprovingInvoice] = useState(false);
  const [updatingPriceChangeId, setUpdatingPriceChangeId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isNotFound, setIsNotFound] = useState(false);
  const [productSearchItemId, setProductSearchItemId] = useState<string | null>(null);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [productSearchResults, setProductSearchResults] = useState<ProductSearchResult[]>([]);
  const [productSearchError, setProductSearchError] = useState("");
  const [isSearchingProducts, setIsSearchingProducts] = useState(false);
  const [isSavingProduct, setIsSavingProduct] = useState(false);

  const loadInvoice = useCallback(
    async (enterpriseId: string, id: string, signal?: AbortSignal) => {
      setIsLoading(true);
      setErrorMessage("");
      setIsNotFound(false);

      try {
        const query = new URLSearchParams({ enterpriseId });
        const response = await fetch(`/api/invoices/${id}?${query.toString()}`, {
          cache: "no-store",
          signal,
        });

        const payload = (await response.json().catch(() => null)) as (InvoiceDetails & { message?: string }) | null;

        if (response.status === 404) {
          setInvoice(null);
          setDraftRawText("");
          setIsNotFound(true);
          return;
        }

        if (!response.ok) {
          throw new Error(payload?.message ?? "Не удалось загрузить накладную.");
        }

        setInvoice(payload);
        setDraftRawText(payload?.rawText ?? "");
      } catch (error) {
        if (signal?.aborted) {
          return;
        }

        setInvoice(null);
        setDraftRawText("");
        setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить накладную.");
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!activeEnterpriseId || !params?.id) {
      setInvoice(null);
      setDraftRawText("");
      setErrorMessage("");
      setSuccessMessage("");
      setIsNotFound(false);
      return;
    }

    const controller = new AbortController();
    void loadInvoice(activeEnterpriseId, params.id, controller.signal);

    return () => controller.abort();
  }, [activeEnterpriseId, loadInvoice, params?.id]);

  useEffect(() => {
    if (!activeEnterpriseId || !productSearchItemId) {
      setProductSearchResults([]);
      setProductSearchError("");
      setIsSearchingProducts(false);
      return;
    }

    const query = productSearchQuery.trim();

    if (!query) {
      setProductSearchResults([]);
      setProductSearchError("");
      setIsSearchingProducts(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsSearchingProducts(true);
      setProductSearchError("");

      try {
        const searchParams = new URLSearchParams({
          enterpriseId: activeEnterpriseId,
          q: query,
          limit: "20",
        });

        if (invoice?.supplierId) {
          searchParams.set("supplierId", invoice.supplierId);
        }

        const response = await fetch(`/api/products?${searchParams.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });

        const payload = (await response.json().catch(() => null)) as
          | { products?: ProductSearchResult[]; message?: string }
          | null;

        if (!response.ok) {
          throw new Error(payload?.message ?? "Не удалось найти товары.");
        }

        setProductSearchResults(payload?.products ?? []);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setProductSearchResults([]);
        setProductSearchError(error instanceof Error ? error.message : "Не удалось найти товары.");
      } finally {
        if (!controller.signal.aborted) {
          setIsSearchingProducts(false);
        }
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [activeEnterpriseId, invoice?.supplierId, productSearchItemId, productSearchQuery]);

  async function handleSaveRawText() {
    if (!activeEnterpriseId || !params?.id) {
      return;
    }

    setIsSavingRawText(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const query = new URLSearchParams({ enterpriseId: activeEnterpriseId });
      const response = await fetch(`/api/invoices/${params.id}/raw-text?${query.toString()}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rawText: draftRawText,
        }),
      });

      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? "Не удалось сохранить текст.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      setSuccessMessage(draftRawText.trim() ? "Текст накладной сохранён." : "Текст очищен, статус обновлён.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось сохранить текст.");
    } finally {
      setIsSavingRawText(false);
    }
  }

  async function handleProcessInvoice() {
    if (!activeEnterpriseId || !params?.id) {
      return;
    }

    setIsProcessing(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const query = new URLSearchParams({ enterpriseId: activeEnterpriseId });
      const response = await fetch(`/api/invoices/${params.id}/process?${query.toString()}`, {
        method: "POST",
      });

      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? "Не удалось обработать накладную.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      setSuccessMessage("OCR пока не подключён. Можно вставить текст накладной вручную.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось обработать накладную.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleParseItems() {
    if (!activeEnterpriseId || !params?.id) {
      return;
    }

    setIsParsingItems(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const query = new URLSearchParams({ enterpriseId: activeEnterpriseId });
      const response = await fetch(`/api/invoices/${params.id}/parse-items?${query.toString()}`, {
        method: "POST",
      });

      const payload = (await response.json().catch(() => null)) as
        | { createdItemsCount?: number; reviewItemsCount?: number; message?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? "Не удалось разобрать товары.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      setSuccessMessage(`Создано строк: ${payload?.createdItemsCount ?? 0}. Требуют проверки: ${payload?.reviewItemsCount ?? 0}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось разобрать товары.");
    } finally {
      setIsParsingItems(false);
    }
  }

  async function handleDetectPriceChanges() {
    if (!activeEnterpriseId || !params?.id) {
      return;
    }

    setIsDetectingPriceChanges(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await fetch(`/api/invoices/${params.id}/detect-price-changes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enterpriseId: activeEnterpriseId,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { createdPriceChangesCount?: number; skippedItemsCount?: number; message?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? "Не удалось найти изменения цен.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      setSuccessMessage(
        `Найдено изменений цен: ${payload?.createdPriceChangesCount ?? 0}. Пропущено строк: ${payload?.skippedItemsCount ?? 0}.`,
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось найти изменения цен.");
    } finally {
      setIsDetectingPriceChanges(false);
    }
  }

  async function handleUpdatePriceChange(changeId: string, action: "approve" | "reject") {
    if (!activeEnterpriseId || !params?.id) {
      return;
    }

    setUpdatingPriceChangeId(changeId);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await fetch(`/api/invoices/${params.id}/price-changes/${changeId}/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enterpriseId: activeEnterpriseId,
        }),
      });

      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? "Не удалось обновить изменение цены.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      setSuccessMessage(action === "approve" ? "Изменение цены подтверждено." : "Изменение цены отклонено.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось обновить изменение цены.");
    } finally {
      setUpdatingPriceChangeId(null);
    }
  }

  async function handleApproveInvoice() {
    if (!activeEnterpriseId || !params?.id) {
      return;
    }

    setIsApprovingInvoice(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await fetch(`/api/invoices/${params.id}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enterpriseId: activeEnterpriseId,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { message?: string; error?: string; reviewItemsCount?: number; pendingPriceChangesCount?: number }
        | null;

      if (!response.ok) {
        if (response.status === 400 && payload?.error) {
          throw new Error(
            `${payload.error}. Сначала проверьте строки и изменения цен. Строк на проверке: ${payload.reviewItemsCount ?? 0}. Изменений цен на проверке: ${payload.pendingPriceChangesCount ?? 0}.`,
          );
        }

        throw new Error(payload?.message ?? "Не удалось завершить накладную.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      setSuccessMessage("Накладная подтверждена.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось завершить накладную.");
    } finally {
      setIsApprovingInvoice(false);
    }
  }

  function handleOpenProductSearch(item: InvoiceItem) {
    setProductSearchItemId(item.id);
    setProductSearchQuery(item.productNameRaw);
    setProductSearchResults([]);
    setProductSearchError("");
    setErrorMessage("");
    setSuccessMessage("");
  }

  function handleCloseProductSearch() {
    setProductSearchItemId(null);
    setProductSearchQuery("");
    setProductSearchResults([]);
    setProductSearchError("");
  }

  async function handleSelectProduct(itemId: string, matchedProductId: string | null) {
    if (!activeEnterpriseId || !params?.id) {
      return;
    }

    setIsSavingProduct(true);
    setErrorMessage("");
    setSuccessMessage("");
    setProductSearchError("");

    try {
      const response = await fetch(`/api/invoices/${params.id}/items/${itemId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enterpriseId: activeEnterpriseId,
          matchedProductId,
        }),
      });

      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? "Не удалось сохранить товар.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      handleCloseProductSearch();
      setSuccessMessage(matchedProductId ? "Товар для строки выбран." : "Сопоставление со строкой сброшено.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось сохранить товар.";
      setProductSearchError(message);
      setErrorMessage(message);
    } finally {
      setIsSavingProduct(false);
    }
  }

  if (!activeEnterpriseId) {
    return (
      <div className="pageStack">
        <section className="card pagePlaceholder">
          <p className="panelEyebrow">Накладные</p>
          <h2 className="pageTitle">Сначала выберите предприятие</h2>
          <p className="pageDescription">Чтобы открыть накладную, выберите активное предприятие в верхней панели.</p>
        </section>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="pageStack">
        <section className="card">
          <div className="emptyState invoicesEmptyState">
            <span className="invoicesEmptyIcon" aria-hidden="true">
              <FileText size={28} strokeWidth={2} />
            </span>
            <p className="emptyStateTitle">Загрузка накладной</p>
            <p className="emptyStateText">Карточка накладной загружается.</p>
          </div>
        </section>
      </div>
    );
  }

  if (isNotFound) {
    return (
      <div className="pageStack">
        <section className="card pagePlaceholder">
          <p className="panelEyebrow">Накладные</p>
          <h2 className="pageTitle">Накладная не найдена</h2>
          <p className="pageDescription">Эта накладная не найдена в выбранном предприятии или была удалена.</p>
          <Link className="secondaryButton compactButton invoicesBackLink" href="/invoices">
            <ArrowLeft size={16} strokeWidth={2} />
            Назад к накладным
          </Link>
        </section>
      </div>
    );
  }

  if (errorMessage && !invoice) {
    return (
      <div className="pageStack">
        <section className="card pagePlaceholder">
          <p className="panelEyebrow">Накладные</p>
          <h2 className="pageTitle">Ошибка загрузки</h2>
          <p className="pageDescription">{errorMessage}</p>
          <Link className="secondaryButton compactButton invoicesBackLink" href="/invoices">
            <ArrowLeft size={16} strokeWidth={2} />
            Назад к накладным
          </Link>
        </section>
      </div>
    );
  }

  if (!invoice) {
    return null;
  }

  const fileKind = detectFileKind(invoice.fileUrl, invoice.originalFileName);
  const reviewItemsCount = invoice.items.filter((item) => item.needsReview).length;
  const pendingPriceChangesCount = invoice.priceChanges.filter((change) => change.status === "pending").length;
  const isBusy =
    isSavingRawText ||
    isProcessing ||
    isParsingItems ||
    isDetectingPriceChanges ||
    isApprovingInvoice ||
    isSavingProduct ||
    updatingPriceChangeId !== null;

  return (
    <div className="pageStack">
      <section className="heroCard">
        <Link className="secondaryButton compactButton invoicesBackLink" href="/invoices">
          <ArrowLeft size={16} strokeWidth={2} />
          Назад к накладным
        </Link>

        <div className="invoiceDetailsHeader">
          <div>
            <p className="panelEyebrow">Накладная</p>
            <h2 className="pageTitle">Накладная</h2>
            <p className="pageDescription">
              Здесь собраны файл, текст, строки и найденные изменения цен по загруженной накладной.
            </p>
          </div>
          <div className="invoiceHeaderActions">
            <div className="invoiceApprovalHints">
              <span>Строк на проверке: {reviewItemsCount}</span>
              <span>Изменений цен на проверке: {pendingPriceChangesCount}</span>
            </div>
            <button type="button" className="primaryButton compactButton" onClick={() => void handleApproveInvoice()} disabled={isBusy}>
              {isApprovingInvoice ? "Завершаем..." : "Завершить накладную"}
            </button>
            <span className={`statusPill ${statusClassNames[invoice.status]}`}>{statusLabels[invoice.status]}</span>
          </div>
        </div>

        <div className="invoiceMetaGrid">
          <div className="supplierMetaItem">
            <span>Поставщик</span>
            <strong>{getSupplierName(invoice)}</strong>
          </div>
          <div className="supplierMetaItem">
            <span>Номер</span>
            <strong>{invoice.invoiceNumber || "—"}</strong>
          </div>
          <div className="supplierMetaItem">
            <span>Дата накладной</span>
            <strong>{formatDate(invoice.invoiceDate)}</strong>
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
            <span>Имя файла</span>
            <strong>{invoice.originalFileName || "—"}</strong>
          </div>
          <div className="supplierMetaItem">
            <span>Загружена</span>
            <strong>{formatDateTime(invoice.createdAt)}</strong>
          </div>
          <div className="supplierMetaItem">
            <span>Обновлена</span>
            <strong>{formatDateTime(invoice.updatedAt)}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="cardHeader">
          <div>
            <p className="panelEyebrow">Файл</p>
            <h2 className="sectionTitle">Файл накладной</h2>
          </div>
        </div>

        {!invoice.fileUrl ? (
          <div className="emptyState">
            <p className="emptyStateTitle">Файл не загружен</p>
            <p className="emptyStateText">Для этой накладной пока нет сохранённого файла.</p>
          </div>
        ) : fileKind === "image" ? (
          <div className="invoiceFilePreview">
            <img src={invoice.fileUrl} alt={invoice.originalFileName || "Накладная"} className="invoicePreviewImage" />
          </div>
        ) : (
          <a className="secondaryButton compactButton invoicesFileLink" href={invoice.fileUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={16} strokeWidth={2} />
            {fileKind === "pdf" ? "Открыть PDF" : "Открыть файл"}
          </a>
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <div>
            <p className="panelEyebrow">Текст</p>
            <h2 className="sectionTitle">Распознанный текст</h2>
          </div>
        </div>

        {errorMessage ? <p className="errorText">{errorMessage}</p> : null}
        {successMessage ? <p className="successText">{successMessage}</p> : null}

        <p className="invoiceHint">OCR пока не подключён. Можно вставить текст накладной вручную.</p>

        <textarea
          className="fieldTextarea"
          rows={12}
          value={draftRawText}
          onChange={(event) => setDraftRawText(event.target.value)}
          placeholder="Вставьте текст накладной вручную"
          disabled={isBusy}
        />

        <div className="invoiceTextActions">
          <button type="button" className="primaryButton compactButton" onClick={() => void handleSaveRawText()} disabled={isBusy}>
            {isSavingRawText ? "Сохраняем..." : "Сохранить текст"}
          </button>
          <button type="button" className="secondaryButton compactButton" onClick={() => void handleProcessInvoice()} disabled={isBusy}>
            {isProcessing ? "Распознаём..." : "Распознать"}
          </button>
          <button type="button" className="secondaryButton compactButton" onClick={() => void handleParseItems()} disabled={isBusy}>
            {isParsingItems ? "Разбираем..." : "Разобрать товары"}
          </button>
        </div>

        {invoice.rawText ? (
          <pre className="invoiceRawText">{invoice.rawText}</pre>
        ) : (
          <div className="emptyState">
            <p className="emptyStateTitle">Текст ещё не распознан</p>
            <p className="emptyStateText">Пока OCR нет, вставьте текст вручную и сохраните его.</p>
          </div>
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <div>
            <p className="panelEyebrow">Товары</p>
            <h2 className="sectionTitle">Товары из накладной</h2>
          </div>
        </div>

        {invoice.items.length === 0 ? (
          <div className="emptyState">
            <p className="emptyStateTitle">Товары ещё не разобраны</p>
            <p className="emptyStateText">После разбора здесь появятся строки накладной.</p>
          </div>
        ) : (
          <div className="orderItemsTableWrap">
            <table className="orderItemsTable">
              <thead>
                <tr>
                  <th>Товар из накладной</th>
                  <th>Найденный товар</th>
                  <th>Количество</th>
                  <th>Единица</th>
                  <th>Цена без НДС</th>
                  <th>Цена с НДС</th>
                  <th>НДС</th>
                  <th>Сумма</th>
                  <th>Проверка</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item) => (
                  <Fragment key={item.id}>
                    <tr>
                      <td>
                        <strong>{item.productNameRaw}</strong>
                      </td>
                      <td>
                        <div className="invoiceMatchedProductCell">
                          <span>{getMatchedProductLabel(item)}</span>
                          <div className="compactProductActions">
                            <button
                              type="button"
                              className="secondaryButton compactButton"
                              onClick={() => handleOpenProductSearch(item)}
                              disabled={isBusy}
                            >
                              {item.matchedProductId ? "Изменить" : "Выбрать товар"}
                            </button>
                            {item.matchedProductId ? (
                              <button
                                type="button"
                                className="secondaryButton compactButton"
                                onClick={() => void handleSelectProduct(item.id, null)}
                                disabled={isBusy}
                              >
                                Сбросить
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td>{formatNumber(item.quantity)}</td>
                      <td>{item.unit || "—"}</td>
                      <td>{formatMoney(item.priceWithoutVat)}</td>
                      <td>
                        <strong>{formatMoney(item.priceWithVat)}</strong>
                        <span>Confidence: {item.confidence !== null ? formatNumber(String(item.confidence), 2) : "—"}</span>
                      </td>
                      <td>{formatPercent(item.vatRate)}</td>
                      <td>{formatMoney(item.lineTotal)}</td>
                      <td>
                        <span className={`statusPill ${item.needsReview ? "invoiceStatus-review" : "invoiceStatus-approved"}`}>
                          {item.needsReview ? "Нужна проверка" : "Ок"}
                        </span>
                      </td>
                    </tr>

                    {productSearchItemId === item.id ? (
                      <tr className="invoiceItemSearchRow">
                        <td colSpan={9}>
                          <div className="invoiceItemSearchPanel">
                            <div className="field">
                              <span>Поиск товара</span>
                              <input
                                type="text"
                                value={productSearchQuery}
                                onChange={(event) => setProductSearchQuery(event.target.value)}
                                placeholder="Начните вводить название товара"
                                disabled={isBusy}
                              />
                            </div>

                            <div className="invoiceItemSearchActions">
                              <button type="button" className="secondaryButton compactButton" onClick={handleCloseProductSearch} disabled={isBusy}>
                                Закрыть
                              </button>
                            </div>

                            {productSearchError ? <p className="errorText">{productSearchError}</p> : null}
                            {isSearchingProducts ? <p className="invoiceHint">Ищем товары...</p> : null}
                            {!isSearchingProducts && productSearchQuery.trim() && productSearchResults.length === 0 ? (
                              <p className="invoiceHint">Товары не найдены</p>
                            ) : null}

                            {productSearchResults.length > 0 ? (
                              <div className="invoiceItemSearchResults">
                                {productSearchResults.map((product) => (
                                  <button
                                    key={product.id}
                                    type="button"
                                    className="invoiceItemSearchResult"
                                    onClick={() => void handleSelectProduct(item.id, product.id)}
                                    disabled={isBusy}
                                  >
                                    <strong>{product.name}</strong>
                                    <span>{product.supplierName || "Без поставщика"}</span>
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <div>
            <p className="panelEyebrow">Цены</p>
            <h2 className="sectionTitle">Изменения цен</h2>
          </div>
          <button type="button" className="secondaryButton compactButton" onClick={() => void handleDetectPriceChanges()} disabled={isBusy}>
            {isDetectingPriceChanges ? "Ищем изменения..." : "Найти изменения цен"}
          </button>
        </div>

        {invoice.priceChanges.length === 0 ? (
          <div className="emptyState">
            <p className="emptyStateTitle">Изменений цен пока нет</p>
            <p className="emptyStateText">В этой задаче цены не рассчитываются, поэтому блок пока пустой.</p>
          </div>
        ) : (
          <div className="orderItemsTableWrap">
            <table className="orderItemsTable">
              <thead>
                <tr>
                  <th>Товар</th>
                  <th>Старая цена</th>
                  <th>Новая цена</th>
                  <th>Разница</th>
                  <th>Статус</th>
                  <th>Действие</th>
                </tr>
              </thead>
              <tbody>
                {invoice.priceChanges.map((change) => (
                  <tr key={change.id}>
                    <td>
                      <strong>{change.productName}</strong>
                    </td>
                    <td>{formatMoney(change.oldPrice)}</td>
                    <td>{formatMoney(change.newPrice)}</td>
                    <td>
                      <strong>{formatMoney(change.differenceAmount)}</strong>
                      <span>{formatPercent(change.differencePercent)}</span>
                    </td>
                    <td>
                      <span className={`statusPill ${priceChangeStatusClassNames[change.status]}`}>
                        {priceChangeStatusLabels[change.status]}
                      </span>
                    </td>
                    <td>
                      {change.status === "pending" ? (
                        <div className="compactProductActions">
                          <button
                            type="button"
                            className="primaryButton compactButton"
                            onClick={() => void handleUpdatePriceChange(change.id, "approve")}
                            disabled={isBusy}
                          >
                            {updatingPriceChangeId === change.id ? "Сохраняем..." : "Подтвердить"}
                          </button>
                          <button
                            type="button"
                            className="secondaryButton compactButton"
                            onClick={() => void handleUpdatePriceChange(change.id, "reject")}
                            disabled={isBusy}
                          >
                            {updatingPriceChangeId === change.id ? "Сохраняем..." : "Отклонить"}
                          </button>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
