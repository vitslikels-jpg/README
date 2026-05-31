"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ExternalLink, FileText } from "lucide-react";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";

type InvoiceStatus = "uploaded" | "processing" | "needs_review" | "parsed" | "approved" | "failed";
type PriceChangeStatus = "pending" | "approved" | "rejected";
type SupplierMatchType = "phone" | "email" | "exact_name" | "contains_name";

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
  article: string | null;
  brand: string | null;
  supplierId: string;
  supplierName: string | null;
};

type SupplierSearchResult = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
};

type EditInvoiceItemDraft = {
  productNameRaw: string;
  quantity: string;
  unit: string;
  priceWithVat: string;
  lineTotal: string;
  vatRate: string;
};

type InvoiceDetails = {
  id: string;
  status: InvoiceStatus;
  supplierId: string | null;
  supplierName: string | null;
  detectedSupplierName: string | null;
  confidence: number | null;
  supplierMatchType: SupplierMatchType | null;
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

const supplierMatchTypeLabels: Record<SupplierMatchType, string> = {
  phone: "Совпадение по телефону",
  email: "Совпадение по email",
  exact_name: "Точное совпадение названия",
  contains_name: "Совпадение по названию",
};

function buildItemEditDraft(item: InvoiceItem): EditInvoiceItemDraft {
  return {
    productNameRaw: item.productNameRaw,
    quantity: item.quantity ?? "",
    unit: item.unit ?? "",
    priceWithVat: item.priceWithVat ?? "",
    lineTotal: item.lineTotal ?? "",
    vatRate: item.vatRate ?? "",
  };
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
  const [isSupplierSearchOpen, setIsSupplierSearchOpen] = useState(false);
  const [supplierSearchQuery, setSupplierSearchQuery] = useState("");
  const [supplierSearchResults, setSupplierSearchResults] = useState<SupplierSearchResult[]>([]);
  const [supplierSearchError, setSupplierSearchError] = useState("");
  const [isSearchingSuppliers, setIsSearchingSuppliers] = useState(false);
  const [isSavingSupplier, setIsSavingSupplier] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editItemDraft, setEditItemDraft] = useState<EditInvoiceItemDraft | null>(null);
  const [isSavingItemEdit, setIsSavingItemEdit] = useState(false);

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

  useEffect(() => {
    if (!activeEnterpriseId || !isSupplierSearchOpen) {
      setSupplierSearchResults([]);
      setSupplierSearchError("");
      setIsSearchingSuppliers(false);
      return;
    }

    const query = supplierSearchQuery.trim();

    if (!query) {
      setSupplierSearchResults([]);
      setSupplierSearchError("");
      setIsSearchingSuppliers(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsSearchingSuppliers(true);
      setSupplierSearchError("");

      try {
        const searchParams = new URLSearchParams({
          enterpriseId: activeEnterpriseId,
          q: query,
          limit: "20",
        });

        const response = await fetch(`/api/suppliers?${searchParams.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });

        const payload = (await response.json().catch(() => null)) as SupplierSearchResult[] | { message?: string } | null;

        if (!response.ok) {
          throw new Error((payload as { message?: string } | null)?.message ?? "Не удалось найти поставщиков.");
        }

        setSupplierSearchResults(Array.isArray(payload) ? payload : []);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setSupplierSearchResults([]);
        setSupplierSearchError(error instanceof Error ? error.message : "Не удалось найти поставщиков.");
      } finally {
        if (!controller.signal.aborted) {
          setIsSearchingSuppliers(false);
        }
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [activeEnterpriseId, isSupplierSearchOpen, supplierSearchQuery]);

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
      setSuccessMessage("Текст накладной распознан.");
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
    setEditingItemId(null);
    setEditItemDraft(null);
    setErrorMessage("");
    setSuccessMessage("");
  }

  function handleOpenSupplierSearch() {
    setIsSupplierSearchOpen(true);
    setSupplierSearchQuery(invoice?.supplierName || invoice?.detectedSupplierName || "");
    setSupplierSearchResults([]);
    setSupplierSearchError("");
    setProductSearchItemId(null);
    setProductSearchQuery("");
    setProductSearchResults([]);
    setProductSearchError("");
    setEditingItemId(null);
    setEditItemDraft(null);
    setErrorMessage("");
    setSuccessMessage("");
  }

  function handleCloseSupplierSearch() {
    setIsSupplierSearchOpen(false);
    setSupplierSearchQuery("");
    setSupplierSearchResults([]);
    setSupplierSearchError("");
  }

  function handleCloseProductSearch() {
    setProductSearchItemId(null);
    setProductSearchQuery("");
    setProductSearchResults([]);
    setProductSearchError("");
  }

  function handleOpenItemEdit(item: InvoiceItem) {
    setEditingItemId(item.id);
    setEditItemDraft(buildItemEditDraft(item));
    setProductSearchItemId(null);
    setProductSearchQuery("");
    setProductSearchResults([]);
    setProductSearchError("");
    setErrorMessage("");
    setSuccessMessage("");
  }

  function handleCloseItemEdit() {
    setEditingItemId(null);
    setEditItemDraft(null);
  }

  function handleChangeItemDraft(field: keyof EditInvoiceItemDraft, value: string) {
    setEditItemDraft((current) => (current ? { ...current, [field]: value } : current));
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

  async function handleSaveItemEdit(itemId: string) {
    if (!activeEnterpriseId || !params?.id || !editItemDraft) {
      return;
    }

    const productNameRaw = editItemDraft.productNameRaw.trim();

    if (!productNameRaw) {
      setErrorMessage("Название товара не может быть пустым.");
      return;
    }

    const payload = {
      enterpriseId: activeEnterpriseId,
      productNameRaw,
      quantity: editItemDraft.quantity.trim() ? editItemDraft.quantity.trim() : null,
      unit: editItemDraft.unit.trim() ? editItemDraft.unit.trim() : null,
      priceWithVat: editItemDraft.priceWithVat.trim() ? editItemDraft.priceWithVat.trim() : null,
      lineTotal: editItemDraft.lineTotal.trim() ? editItemDraft.lineTotal.trim() : null,
      vatRate: editItemDraft.vatRate.trim() ? editItemDraft.vatRate.trim() : null,
    };

    setIsSavingItemEdit(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await fetch(`/api/invoices/${params.id}/items/${itemId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const apiPayload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(apiPayload?.message ?? "Не удалось сохранить строку накладной.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      handleCloseItemEdit();
      setSuccessMessage("Строка накладной обновлена.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось сохранить строку накладной.");
    } finally {
      setIsSavingItemEdit(false);
    }
  }

  async function handleSelectSupplier(supplierId: string | null) {
    if (!activeEnterpriseId || !params?.id) {
      return;
    }

    setIsSavingSupplier(true);
    setErrorMessage("");
    setSuccessMessage("");
    setSupplierSearchError("");

    try {
      const response = await fetch(`/api/invoices/${params.id}/supplier`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enterpriseId: activeEnterpriseId,
          supplierId,
        }),
      });

      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? "Не удалось сохранить поставщика.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      handleCloseSupplierSearch();
      setSuccessMessage(supplierId ? "Поставщик для накладной сохранён." : "Поставщик для накладной сброшен.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось сохранить поставщика.";
      setSupplierSearchError(message);
      setErrorMessage(message);
    } finally {
      setIsSavingSupplier(false);
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
    isSavingItemEdit ||
    isSavingSupplier ||
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
            {invoice.supplierId && invoice.confidence !== null && invoice.supplierMatchType ? (
              <span className="invoiceHint">
                {supplierMatchTypeLabels[invoice.supplierMatchType]} · уверенность {formatNumber(String(invoice.confidence), 2)}
              </span>
            ) : invoice.supplierId && invoice.confidence !== null ? (
              <span className="invoiceHint">Выбран вручную · уверенность {formatNumber(String(invoice.confidence), 2)}</span>
            ) : null}
            <div className="invoiceSupplierActions">
              <button type="button" className="secondaryButton compactButton" onClick={handleOpenSupplierSearch} disabled={isBusy}>
                {invoice.supplierId ? "Изменить" : "Выбрать поставщика"}
              </button>
              {invoice.supplierId ? (
                <button
                  type="button"
                  className="secondaryButton compactButton"
                  onClick={() => void handleSelectSupplier(null)}
                  disabled={isBusy}
                >
                  Сбросить
                </button>
              ) : null}
            </div>
            {isSupplierSearchOpen ? (
              <div className="invoiceItemSearchPanel invoiceSupplierSearchPanel">
                <label className="field">
                  <span>Поиск поставщика</span>
                  <input
                    type="text"
                    value={supplierSearchQuery}
                    onChange={(event) => setSupplierSearchQuery(event.target.value)}
                    placeholder="Начните вводить название поставщика"
                    disabled={isBusy}
                  />
                </label>

                <div className="invoiceItemSearchActions">
                  <button type="button" className="secondaryButton compactButton" onClick={handleCloseSupplierSearch} disabled={isBusy}>
                    Закрыть
                  </button>
                </div>

                {supplierSearchError ? <p className="errorText">{supplierSearchError}</p> : null}
                {isSearchingSuppliers ? <p className="invoiceHint">Ищем поставщиков...</p> : null}
                {!isSearchingSuppliers && supplierSearchQuery.trim() && supplierSearchResults.length === 0 ? (
                  <p className="invoiceHint">Поставщики не найдены</p>
                ) : null}

                {supplierSearchResults.length > 0 ? (
                  <div className="invoiceItemSearchResults">
                    {supplierSearchResults.map((supplier) => (
                      <button
                        key={supplier.id}
                        type="button"
                        className="invoiceItemSearchResult"
                        onClick={() => void handleSelectSupplier(supplier.id)}
                        disabled={isBusy}
                      >
                        <strong>{supplier.name}</strong>
                        <span>{supplier.email || supplier.phone || "Без контактов"}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
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

        <p className="invoiceHint">Можно распознать текст из файла или вставить его вручную и потом поправить.</p>

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
            {isProcessing ? "Идёт распознавание..." : "Распознать"}
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
            <p className="emptyStateText">Нажмите «Распознать» или вставьте текст вручную и сохраните его.</p>
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
                          <div className="compactProductActions invoiceItemRowActions">
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
                            <button
                              type="button"
                              className="secondaryButton compactButton"
                              onClick={() => handleOpenItemEdit(item)}
                              disabled={isBusy}
                            >
                              Редактировать
                            </button>
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
                                    <span>{[product.brand, product.article, product.supplierName].filter(Boolean).join(" / ") || "Без поставщика"}</span>
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}

                    {editingItemId === item.id && editItemDraft ? (
                      <tr className="invoiceItemSearchRow">
                        <td colSpan={9}>
                          <div className="invoiceItemSearchPanel invoiceItemEditPanel">
                            <div className="invoiceItemEditGrid">
                              <label className="field">
                                <span>Название</span>
                                <input
                                  type="text"
                                  value={editItemDraft.productNameRaw}
                                  onChange={(event) => handleChangeItemDraft("productNameRaw", event.target.value)}
                                  disabled={isBusy}
                                />
                              </label>
                              <label className="field">
                                <span>Количество</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={editItemDraft.quantity}
                                  onChange={(event) => handleChangeItemDraft("quantity", event.target.value)}
                                  disabled={isBusy}
                                />
                              </label>
                              <label className="field">
                                <span>Единица</span>
                                <input
                                  type="text"
                                  value={editItemDraft.unit}
                                  onChange={(event) => handleChangeItemDraft("unit", event.target.value)}
                                  disabled={isBusy}
                                />
                              </label>
                              <label className="field">
                                <span>Цена</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={editItemDraft.priceWithVat}
                                  onChange={(event) => handleChangeItemDraft("priceWithVat", event.target.value)}
                                  disabled={isBusy}
                                />
                              </label>
                              <label className="field">
                                <span>Сумма</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={editItemDraft.lineTotal}
                                  onChange={(event) => handleChangeItemDraft("lineTotal", event.target.value)}
                                  disabled={isBusy}
                                />
                              </label>
                              <label className="field">
                                <span>НДС %</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={editItemDraft.vatRate}
                                  onChange={(event) => handleChangeItemDraft("vatRate", event.target.value)}
                                  disabled={isBusy}
                                />
                              </label>
                            </div>

                            <div className="invoiceItemEditActions">
                              <button
                                type="button"
                                className="primaryButton compactButton"
                                onClick={() => void handleSaveItemEdit(item.id)}
                                disabled={isBusy}
                              >
                                {isSavingItemEdit ? "Сохраняем..." : "Сохранить"}
                              </button>
                              <button
                                type="button"
                                className="secondaryButton compactButton"
                                onClick={handleCloseItemEdit}
                                disabled={isBusy}
                              >
                                Отмена
                              </button>
                            </div>
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
