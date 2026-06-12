"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, FileText, Minus, Plus, RotateCcw, X } from "lucide-react";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";
import { extractInvoiceSupplierDetails } from "@/lib/invoice-supplier-details";
import { deriveVatFields } from "@/lib/invoice-vat";

type InvoiceStatus = "uploaded" | "processing" | "needs_review" | "parsed" | "approved" | "failed";
type PriceChangeStatus = "pending" | "approved" | "rejected";
type SupplierMatchType = "alias_exact" | "alias_contains" | "phone" | "email" | "name_exact" | "name_contains";

type InvoiceFile = {
  id: string;
  fileUrl: string | null;
  storageKey: string | null;
  originalFileName: string | null;
  mimeType: string | null;
  pageIndex: number;
};

type PreviewImageState = {
  index: number;
  zoom: number;
};

type InvoiceItem = {
  id: string;
  productNameRaw: string;
  matchedProductId: string | null;
  matchedProductStatus: "matched" | "ambiguous" | "not_found" | "new";
  matchedProductName: string | null;
  matchedProductArticle: string | null;
  matchedProductBrand: string | null;
  matchedProductPrice: string | null;
  productCandidates: ProductSearchResult[];
  quantity: string | null;
  unit: string | null;
  priceWithoutVat: string | null;
  priceWithVat: string | null;
  vatRate: string | null;
  lineTotal: string | null;
  confidence: number | null;
  needsReview: boolean;
  priceComparisonNote: string | null;
  priceComparisonNeedsReview: boolean;
  normalizedComparisonPrice: string | null;
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
  comparisonNote: string | null;
  status: PriceChangeStatus;
};

type ProductSearchResult = {
  id: string;
  name: string;
  article: string | null;
  brand: string | null;
  unit?: string | null;
  unitsPerPack?: string | null;
  price?: string | null;
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

type CreateSupplierDraft = {
  supplierName: string;
  legalName: string;
  inn: string;
  alias: string;
  comment: string;
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
  files: InvoiceFile[];
  rawText: string | null;
  createdAt: string;
  updatedAt: string;
  items: InvoiceItem[];
  priceChanges: InvoicePriceChange[];
};

type InvoiceParseDebugInfo = {
  tableDetected?: boolean;
  tableRowsCount?: number;
  textParsedItemsCount?: number;
  visionItemsCount?: number;
  itemsBeforeFilter?: number;
  filteredItemsCount?: number;
  rejectedItems?: Array<{
    name: string;
    reason: string;
  }>;
};

type InvoiceItemStatus =
  | "Готово"
  | "Нужно выбрать товар"
  | "Новая позиция"
  | "Цена изменилась"
  | "Проверить цену"
  | "Проверить единицу"
  | "Нет цены"
  | "Нет количества";

const statusLabels: Record<InvoiceStatus, string> = {
  uploaded: "\u0417\u0430\u0433\u0440\u0443\u0436\u0435\u043d\u0430",
  processing: "\u041e\u0431\u0440\u0430\u0431\u0430\u0442\u044b\u0432\u0430\u0435\u0442\u0441\u044f",
  needs_review: "\u0422\u0440\u0435\u0431\u0443\u0435\u0442 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438",
  parsed: "\u0420\u0430\u0437\u043e\u0431\u0440\u0430\u043d\u0430",
  approved: "\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0430",
  failed: "\u041e\u0448\u0438\u0431\u043a\u0430",
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
  pending: "\u041d\u0430 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0435",
  approved: "\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u043e",
  rejected: "\u041e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u043e",
};

const priceChangeStatusClassNames: Record<PriceChangeStatus, string> = {
  pending: "invoiceStatus-review",
  approved: "invoiceStatus-approved",
  rejected: "invoiceStatus-failed",
};
function formatMoney(value: string | null) {
  if (!value) {
    return "\u2014";
  }

  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return value;
  }

  return `${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)} \u20BD`;
}

function formatNumber(value: string | null, digits = 3) {
  if (!value) {
    return "\u2014";
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
    return "\u2014";
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
    return "\u2014";
  }

  return new Date(value).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function resolveInvoiceDate(value: string | null, rawText: string | null) {
  if (value) {
    return value;
  }

  if (!rawText) {
    return null;
  }

  const normalizedText = rawText.replace(/[^\d.\-/ ]+/g, " ");
  const match = normalizedText.match(/\b(\d{2})[.\-/ ](\d{2})[.\-/ ](20\d{2})\b/);

  if (!match) {
    return null;
  }

  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
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
  return invoice.supplierName || invoice.detectedSupplierName || "\u041f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a \u043d\u0435 \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0451\u043d";
}

function getInvoiceFiles(invoice: InvoiceDetails) {
  if (invoice.files.length > 0) {
    return invoice.files;
  }

  if (!invoice.fileUrl) {
    return [];
  }

  return [
    {
      id: "legacy-file",
      fileUrl: invoice.fileUrl,
      storageKey: null,
      originalFileName: invoice.originalFileName,
      mimeType: null,
      pageIndex: 0,
    },
  ];
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
    if (item.matchedProductStatus === "ambiguous") {
      return "Нужно выбрать товар";
    }

    if (item.matchedProductStatus === "new") {
      return "Новая позиция";
    }

    return "Нужно выбрать товар";
  }

  return [item.matchedProductName, item.matchedProductArticle, item.matchedProductBrand].filter(Boolean).join(" \u2022 ");
}

function getInvoiceItemStatus(item: InvoiceItem, change: InvoicePriceChange | null): InvoiceItemStatus {
  if (item.matchedProductStatus === "new" || (!item.matchedProductId && item.productCandidates.length === 0)) {
    return "Новая позиция";
  }

  if (!item.matchedProductId) {
    return "Нужно выбрать товар";
  }

  if (!item.quantity) {
    return "Нет количества";
  }

  if (!item.priceWithVat) {
    return "Нет цены";
  }

  if (item.priceComparisonNeedsReview) {
    return "Проверить единицу";
  }

  if (change?.status === "pending") {
    return "Цена изменилась";
  }

  if (item.needsReview && (!item.quantity || !item.unit || !item.priceWithVat)) {
    return "Проверить цену";
  }

  return "Готово";
}

function getInvoiceItemStatusClassName(itemStatus: InvoiceItemStatus) {
  if (itemStatus === "Готово") {
    return "invoiceStatus-approved";
  }

  if (
    itemStatus === "Цена изменилась" ||
    itemStatus === "Проверить цену" ||
    itemStatus === "Проверить единицу" ||
    itemStatus === "Нет цены" ||
    itemStatus === "Нет количества"
  ) {
    return "invoiceStatus-review";
  }

  if (itemStatus === "Новая позиция") {
    return "invoiceStatus-new";
  }

  return "invoiceStatus-neutral";
}

function getCalculatedLineTotal(item: InvoiceItem) {
  if (item.lineTotal) {
    return item.lineTotal;
  }

  const quantity = item.quantity ? Number(item.quantity) : null;
  const priceWithVat = item.priceWithVat ? Number(item.priceWithVat) : null;

  if (quantity === null || priceWithVat === null || !Number.isFinite(quantity) || !Number.isFinite(priceWithVat)) {
    return null;
  }

  return String(quantity * priceWithVat);
}

function getDisplayVatFields(item: InvoiceItem) {
  const priceWithoutVat = item.priceWithoutVat ? Number(item.priceWithoutVat) : null;
  const priceWithVat = item.priceWithVat ? Number(item.priceWithVat) : null;
  const vatRate = item.vatRate ? Number(item.vatRate) : null;
  const derived = deriveVatFields({
    priceWithoutVat: priceWithoutVat !== null && Number.isFinite(priceWithoutVat) ? priceWithoutVat : null,
    priceWithVat: priceWithVat !== null && Number.isFinite(priceWithVat) ? priceWithVat : null,
    vatRate: vatRate !== null && Number.isFinite(vatRate) ? vatRate : null,
  });

  return derived;
}

const supplierMatchTypeLabels: Record<SupplierMatchType, string> = {
  alias_exact: "Точное совпадение alias",
  alias_contains: "Совпадение по alias",
  phone: "\u0421\u043e\u0432\u043f\u0430\u0434\u0435\u043d\u0438\u0435 \u043f\u043e \u0442\u0435\u043b\u0435\u0444\u043e\u043d\u0443",
  email: "\u0421\u043e\u0432\u043f\u0430\u0434\u0435\u043d\u0438\u0435 \u043f\u043e email",
  name_exact: "\u0422\u043e\u0447\u043d\u043e\u0435 \u0441\u043e\u0432\u043f\u0430\u0434\u0435\u043d\u0438\u0435 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u044f",
  name_contains: "\u0421\u043e\u0432\u043f\u0430\u0434\u0435\u043d\u0438\u0435 \u043f\u043e \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u044e",
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

function clampPreviewZoom(value: number) {
  return Math.min(4, Math.max(0.5, Number(value.toFixed(2))));
}

function buildProductSearchQueries(value: string) {
  const normalized = value
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return [];
  }

  const words = normalized.split(" ").filter(Boolean);
  const queries = new Set<string>([normalized]);

  if (words.length > 0) {
    queries.add(words[0]);
  }

  if (words.length > 1) {
    queries.add(words.slice(0, 2).join(" "));
  }

  if (words.length > 2) {
    queries.add(words.slice(0, 3).join(" "));
  }

  return Array.from(queries).filter(Boolean);
}

function formatCount(value: number, one: string, few: string, many: string) {
  const mod10 = value % 10;
  const mod100 = value % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return `${value} ${one}`;
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${value} ${few}`;
  }

  return `${value} ${many}`;
}

export default function InvoiceDetailsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { activeEnterpriseId } = useEnterprise();
  const [invoice, setInvoice] = useState<InvoiceDetails | null>(null);
  const [draftRawText, setDraftRawText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingRawText, setIsSavingRawText] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAiParsingItems, setIsAiParsingItems] = useState(false);
  const [isParsingItems, setIsParsingItems] = useState(false);
  const [isDetectingPriceChanges, setIsDetectingPriceChanges] = useState(false);
  const [isApprovingInvoice, setIsApprovingInvoice] = useState(false);
  const [updatingPriceChangeId, setUpdatingPriceChangeId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [debugRawTextPreview, setDebugRawTextPreview] = useState("");
  const [debugParseInfo, setDebugParseInfo] = useState<InvoiceParseDebugInfo | null>(null);
  const [isNotFound, setIsNotFound] = useState(false);
  const [productSearchItemId, setProductSearchItemId] = useState<string | null>(null);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [productSearchResults, setProductSearchResults] = useState<ProductSearchResult[]>([]);
  const [productSearchError, setProductSearchError] = useState("");
  const [productSearchAllSuppliers, setProductSearchAllSuppliers] = useState(false);
  const [previewImage, setPreviewImage] = useState<PreviewImageState | null>(null);
  const [isSearchingProducts, setIsSearchingProducts] = useState(false);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [isSupplierSearchOpen, setIsSupplierSearchOpen] = useState(false);
  const [supplierSearchQuery, setSupplierSearchQuery] = useState("");
  const [supplierSearchResults, setSupplierSearchResults] = useState<SupplierSearchResult[]>([]);
  const [supplierSearchError, setSupplierSearchError] = useState("");
  const [isSearchingSuppliers, setIsSearchingSuppliers] = useState(false);
  const [isSavingSupplier, setIsSavingSupplier] = useState(false);
  const [isCreatingSupplier, setIsCreatingSupplier] = useState(false);
  const [createSupplierDraft, setCreateSupplierDraft] = useState<CreateSupplierDraft>({
    supplierName: "",
    legalName: "",
    inn: "",
    alias: "",
    comment: "",
  });
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editItemDraft, setEditItemDraft] = useState<EditInvoiceItemDraft | null>(null);
  const [isSavingItemEdit, setIsSavingItemEdit] = useState(false);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [creatingProductItemId, setCreatingProductItemId] = useState<string | null>(null);
  const [isDeletingInvoice, setIsDeletingInvoice] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [isBulkDeletingItems, setIsBulkDeletingItems] = useState(false);
  const previewModalBodyRef = useRef<HTMLDivElement | null>(null);

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
      setDebugRawTextPreview("");
    setDebugParseInfo(null);
      setIsNotFound(false);
      return;
    }

    const controller = new AbortController();
    void loadInvoice(activeEnterpriseId, params.id, controller.signal);

    return () => controller.abort();
  }, [activeEnterpriseId, loadInvoice, params?.id]);

  const extractedSupplierDetails = useMemo(
    () => extractInvoiceSupplierDetails(invoice?.rawText, invoice?.detectedSupplierName),
    [invoice?.detectedSupplierName, invoice?.rawText],
  );

  useEffect(() => {
    setCreateSupplierDraft({
      supplierName: extractedSupplierDetails.supplierName ?? "",
      legalName: extractedSupplierDetails.legalName ?? "",
      inn: extractedSupplierDetails.inn ?? "",
      alias: extractedSupplierDetails.aliases.find((value) => value !== extractedSupplierDetails.supplierName) ?? "",
      comment: "",
    });
  }, [extractedSupplierDetails]);

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
        const collected = new Map<string, ProductSearchResult>();
        const queries = buildProductSearchQueries(query);

        for (const searchQuery of queries) {
          if (controller.signal.aborted) {
            return;
          }

          const searchParams = new URLSearchParams({
            enterpriseId: activeEnterpriseId,
            q: searchQuery,
            limit: "50",
          });

          if (invoice?.supplierId && !productSearchAllSuppliers) {
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

          for (const product of payload?.products ?? []) {
            if (!collected.has(product.id)) {
              collected.set(product.id, product);
            }
          }

          if (collected.size >= 50) {
            break;
          }
        }

        setProductSearchResults(Array.from(collected.values()).slice(0, 50));
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
  }, [activeEnterpriseId, invoice?.supplierId, productSearchAllSuppliers, productSearchItemId, productSearchQuery]);

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
    setDebugRawTextPreview("");
    setDebugParseInfo(null);

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
    setDebugRawTextPreview("");
    setDebugParseInfo(null);

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
    setDebugRawTextPreview("");
    setDebugParseInfo(null);

    try {
      const query = new URLSearchParams({ enterpriseId: activeEnterpriseId });
      const response = await fetch(`/api/invoices/${params.id}/parse-items?${query.toString()}`, {
        method: "POST",
      });

      const payload = (await response.json().catch(() => null)) as
        | ({ createdItemsCount?: number; reviewItemsCount?: number; message?: string } & InvoiceParseDebugInfo)
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

  async function handleAiParseItems() {
    if (!activeEnterpriseId || !params?.id) {
      return;
    }

    setIsAiParsingItems(true);
    setErrorMessage("");
    setSuccessMessage("");
    setDebugRawTextPreview("");
    setDebugParseInfo(null);

    try {
      const query = new URLSearchParams({ enterpriseId: activeEnterpriseId });
      const response = await fetch(`/api/invoices/${params.id}/ai-parse?${query.toString()}`, {
        method: "POST",
      });

      const payload = (await response.json().catch(() => null)) as
        | ({
            createdItemsCount?: number;
            reviewItemsCount?: number;
            fallbackUsed?: boolean;
            visionUsed?: boolean;
            message?: string;
            rawTextPreview?: string;
          } & InvoiceParseDebugInfo)
        | null;

      if (!response.ok) {
        setDebugRawTextPreview(payload?.rawTextPreview ?? "");
        throw new Error(payload?.message ?? "AI не смог разобрать товары. Проверьте распознанный текст или используйте разбор без AI.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      setSuccessMessage(
        payload?.visionUsed || payload?.fallbackUsed
          ? payload?.message ?? "AI не нашёл товары, использован простой разбор."
          : `AI-разбор готов. Создано строк: ${payload?.createdItemsCount ?? 0}. Требуют проверки: ${payload?.reviewItemsCount ?? 0}.`,
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "AI не смог разобрать товары. Проверьте распознанный текст или используйте разбор без AI.");
    } finally {
      setIsAiParsingItems(false);
    }
  }

  async function handleProcessAndParseInvoice() {
    if (!activeEnterpriseId || !params?.id) {
      return;
    }

    setIsProcessing(true);
    setIsAiParsingItems(true);
    setIsDetectingPriceChanges(true);
    setErrorMessage("");
    setSuccessMessage("");
    setDebugRawTextPreview("");
    setDebugParseInfo(null);

    try {
      const query = new URLSearchParams({ enterpriseId: activeEnterpriseId });

      const processResponse = await fetch(`/api/invoices/${params.id}/process?${query.toString()}`, {
        method: "POST",
      });
      const processPayload = (await processResponse.json().catch(() => null)) as { message?: string } | null;

      if (!processResponse.ok) {
        throw new Error(processPayload?.message ?? "OCR не прочитал текст.");
      }

      const aiResponse = await fetch(`/api/invoices/${params.id}/ai-parse?${query.toString()}`, {
        method: "POST",
      });
      const aiPayload = (await aiResponse.json().catch(() => null)) as
        | ({
            message?: string;
            fallbackUsed?: boolean;
            visionUsed?: boolean;
            rawTextPreview?: string;
            createdItemsCount?: number;
            reviewItemsCount?: number;
          } & InvoiceParseDebugInfo)
        | null;

      if (!aiResponse.ok) {
        setDebugRawTextPreview(aiPayload?.rawTextPreview ?? "");
        await loadInvoice(activeEnterpriseId, params.id);
        throw new Error(aiPayload?.message ?? "AI не смог разобрать товары. Проверьте распознанный текст или используйте разбор без AI.");
      }

      await loadInvoice(activeEnterpriseId, params.id);

      const detectResponse = await fetch(`/api/invoices/${params.id}/detect-price-changes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enterpriseId: activeEnterpriseId,
        }),
      });
      const detectPayload = (await detectResponse.json().catch(() => null)) as { message?: string } | null;

      if (!detectResponse.ok) {
        await loadInvoice(activeEnterpriseId, params.id);
        setSuccessMessage(
          aiPayload?.visionUsed
            ? "\u0422\u0435\u043a\u0441\u0442 OCR \u0431\u044b\u043b \u043f\u043b\u043e\u0445\u043e\u0439, \u0442\u043e\u0432\u0430\u0440\u044b \u0440\u0430\u0437\u043e\u0431\u0440\u0430\u043d\u044b \u043f\u043e \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044e. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u0446\u0435\u043d\u044b \u0438 \u0441\u0442\u0440\u043e\u043a\u0438."
            : aiPayload?.fallbackUsed
              ? "AI \u043d\u0435 \u0441\u043c\u043e\u0433 \u043d\u0430\u0434\u0451\u0436\u043d\u043e \u0440\u0430\u0437\u043e\u0431\u0440\u0430\u0442\u044c \u0442\u0430\u0431\u043b\u0438\u0446\u0443, \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u043d \u043f\u0440\u043e\u0441\u0442\u043e\u0439 \u0440\u0430\u0437\u0431\u043e\u0440. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u0441\u0442\u0440\u043e\u043a\u0438 \u0432\u0440\u0443\u0447\u043d\u0443\u044e."
              : "\u0422\u043e\u0432\u0430\u0440\u044b \u0441\u043e\u0437\u0434\u0430\u043d\u044b, \u043d\u043e \u043f\u043e\u0438\u0441\u043a \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0439 \u0446\u0435\u043d \u043d\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u043b\u0441\u044f.",
        );
        throw new Error(detectPayload?.message ?? "\u0422\u043e\u0432\u0430\u0440\u044b \u0441\u043e\u0437\u0434\u0430\u043d\u044b, \u043d\u043e \u043f\u043e\u0438\u0441\u043a \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0439 \u0446\u0435\u043d \u043d\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u043b\u0441\u044f.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      setSuccessMessage(
        aiPayload?.visionUsed
          ? "\u0422\u0435\u043a\u0441\u0442 OCR \u0431\u044b\u043b \u043f\u043b\u043e\u0445\u043e\u0439, \u0442\u043e\u0432\u0430\u0440\u044b \u0440\u0430\u0437\u043e\u0431\u0440\u0430\u043d\u044b \u043f\u043e \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044e. \u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u043d\u0443\u0436\u043d\u0430."
          : aiPayload?.fallbackUsed
            ? "AI \u043d\u0435 \u0441\u043c\u043e\u0433 \u043d\u0430\u0434\u0451\u0436\u043d\u043e \u0440\u0430\u0437\u043e\u0431\u0440\u0430\u0442\u044c \u0442\u0430\u0431\u043b\u0438\u0446\u0443, \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u043d \u043f\u0440\u043e\u0441\u0442\u043e\u0439 \u0440\u0430\u0437\u0431\u043e\u0440."
            : "\u041d\u0430\u043a\u043b\u0430\u0434\u043d\u0430\u044f \u0440\u0430\u0441\u043f\u043e\u0437\u043d\u0430\u043d\u0430, \u0442\u043e\u0432\u0430\u0440\u044b \u0438 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f \u0446\u0435\u043d \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u044b.",
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось выполнить полный разбор накладной.");
    } finally {
      setIsProcessing(false);
      setIsAiParsingItems(false);
      setIsDetectingPriceChanges(false);
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
    setProductSearchAllSuppliers(false);
    setEditingItemId(null);
    setEditItemDraft(null);
    setErrorMessage("");
    setSuccessMessage("");
  }

  function handleOpenSupplierSearch() {
    setIsSupplierSearchOpen(true);
    setSupplierSearchQuery(invoice?.supplierName || invoice?.detectedSupplierName || "");
    setCreateSupplierDraft({
      supplierName: extractedSupplierDetails.supplierName ?? "",
      legalName: extractedSupplierDetails.legalName ?? "",
      inn: extractedSupplierDetails.inn ?? "",
      alias: extractedSupplierDetails.aliases.find((value) => value !== extractedSupplierDetails.supplierName) ?? "",
      comment: "",
    });
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

  function handleChangeCreateSupplierDraft(field: keyof CreateSupplierDraft, value: string) {
    setCreateSupplierDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function handleCloseProductSearch() {
    setProductSearchItemId(null);
    setProductSearchQuery("");
    setProductSearchResults([]);
    setProductSearchError("");
    setProductSearchAllSuppliers(false);
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

  async function handleDeleteItem(itemId: string) {
    if (!activeEnterpriseId || !params?.id) {
      return;
    }

    if (!window.confirm("Удалить эту строку из накладной?")) {
      return;
    }

    setDeletingItemId(itemId);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await fetch(`/api/invoices/${params.id}/items/${itemId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enterpriseId: activeEnterpriseId,
        }),
      });

      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? "Не удалось удалить строку накладной.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      setSuccessMessage("Строка накладной удалена.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось удалить строку накладной.");
    } finally {
      setDeletingItemId(null);
    }
  }

  async function handleCreateProduct(item: InvoiceItem) {
    if (!activeEnterpriseId || !params?.id || !invoice) {
      return;
    }

    if (!invoice.supplierId) {
      setErrorMessage("Сначала выберите поставщика.");
      return;
    }

    if (!window.confirm("Создать новый товар во внутреннем накопителе?")) {
      return;
    }

    setCreatingProductItemId(item.id);
    setErrorMessage("");
    setSuccessMessage("");
    setProductSearchError("");

    try {
      const response = await fetch(`/api/invoices/${params.id}/items/${item.id}/create-product`, {
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
        throw new Error(payload?.message ?? "Не удалось создать товар.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      handleCloseProductSearch();
      setSuccessMessage("Товар создан и привязан к строке накладной.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось создать товар.";
      setProductSearchError(message);
      setErrorMessage(message);
    } finally {
      setCreatingProductItemId(null);
    }
  }

  async function handleDeleteInvoice() {
    if (!activeEnterpriseId || !params?.id) {
      return;
    }

    if (!window.confirm("Удалить накладную? Это действие нельзя отменить.")) {
      return;
    }

    setIsDeletingInvoice(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const query = new URLSearchParams({ enterpriseId: activeEnterpriseId });
      const response = await fetch(`/api/invoices/${params.id}?${query.toString()}`, {
        method: "DELETE",
      });

      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? "Не удалось удалить накладную.");
      }

      router.push("/invoices");
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось удалить накладную.");
      setIsDeletingInvoice(false);
    }
  }

  function handleToggleItemSelection(itemId: string) {
    setSelectedItemIds((current) =>
      current.includes(itemId) ? current.filter((selectedId) => selectedId !== itemId) : [...current, itemId],
    );
  }

  function handleToggleAllItems() {
    if (!invoice) {
      return;
    }

    setSelectedItemIds((current) => (current.length === invoice.items.length ? [] : invoice.items.map((item) => item.id)));
  }

  async function handleBulkDeleteItems() {
    if (!activeEnterpriseId || !params?.id || selectedItemIds.length === 0) {
      return;
    }

    if (!window.confirm(`Удалить выбранные строки: ${selectedItemIds.length}?`)) {
      return;
    }

    setIsBulkDeletingItems(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await fetch(`/api/invoices/${params.id}/items/bulk-delete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enterpriseId: activeEnterpriseId,
          itemIds: selectedItemIds,
        }),
      });

      const payload = (await response.json().catch(() => null)) as { message?: string; deletedCount?: number } | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? "Не удалось удалить выбранные строки.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      setSelectedItemIds([]);
      setSuccessMessage(`Удалено строк: ${payload?.deletedCount ?? selectedItemIds.length}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось удалить выбранные строки.");
    } finally {
      setIsBulkDeletingItems(false);
    }
  }

  async function handleSelectSupplier(supplierId: string | null) {
    if (!activeEnterpriseId || !params?.id || !invoice) {
      return;
    }

    setIsSavingSupplier(true);
    setErrorMessage("");
    setSuccessMessage("");
    setSupplierSearchError("");

    try {
      let aliasAlreadyExists = false;

      if (supplierId && !invoice.supplierId && invoice.detectedSupplierName?.trim()) {
        const aliasResponse = await fetch(`/api/suppliers/${supplierId}/aliases`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            enterpriseId: activeEnterpriseId,
            value: invoice.detectedSupplierName.trim(),
            type: "invoice_name",
          }),
        });

        const aliasPayload = (await aliasResponse.json().catch(() => null)) as { message?: string } | null;

        if (!aliasResponse.ok && aliasResponse.status !== 409) {
          throw new Error(aliasPayload?.message ?? "Не удалось сохранить alias поставщика.");
        }

        aliasAlreadyExists = aliasResponse.status === 409;
      }

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
      if (!supplierId) {
        setSuccessMessage("Поставщик для накладной сброшен.");
      } else if (!invoice.supplierId && invoice.detectedSupplierName?.trim()) {
        setSuccessMessage(
          aliasAlreadyExists
            ? "Такой alias уже был сохранён. Накладная привязана к поставщику."
            : "Alias сохранён. Накладная привязана к поставщику.",
        );
      } else {
        setSuccessMessage("Поставщик для накладной сохранён.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось сохранить поставщика.";
      setSupplierSearchError(message);
      setErrorMessage(message);
    } finally {
      setIsSavingSupplier(false);
    }
  }

  async function handleCreateSupplierFromInvoice() {
    if (!activeEnterpriseId || !params?.id || !invoice) {
      return;
    }

    if (!createSupplierDraft.supplierName.trim()) {
      setErrorMessage("В накладной нет названия поставщика.");
      return;
    }

    setIsCreatingSupplier(true);
    setErrorMessage("");
    setSuccessMessage("");
    setSupplierSearchError("");

    try {
      const response = await fetch(`/api/invoices/${params.id}/create-supplier-from-invoice`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enterpriseId: activeEnterpriseId,
          supplierName: createSupplierDraft.supplierName,
          legalName: createSupplierDraft.legalName,
          inn: createSupplierDraft.inn,
          alias: createSupplierDraft.alias,
          comment: createSupplierDraft.comment,
        }),
      });

      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? "Не удалось создать поставщика из накладной.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      handleCloseSupplierSearch();
      setSuccessMessage("Поставщик создан, alias сохранён, накладная привязана.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось создать поставщика из накладной.";
      setSupplierSearchError(message);
      setErrorMessage(message);
    } finally {
      setIsCreatingSupplier(false);
    }
  }

  const invoiceFiles = invoice ? getInvoiceFiles(invoice) : [];
  const invoiceImageFiles = useMemo(
    () => invoiceFiles.filter((file) => detectFileKind(file.fileUrl, file.originalFileName) === "image" && file.fileUrl),
    [invoiceFiles],
  );
  const currentPreviewFile = previewImage ? invoiceImageFiles[previewImage.index] ?? null : null;
  const productSearchItem = productSearchItemId && invoice ? invoice.items.find((item) => item.id === productSearchItemId) ?? null : null;
  const displayedInvoiceDate = invoice ? resolveInvoiceDate(invoice.invoiceDate, invoice.rawText) : null;
  const pendingPriceChangesCount = invoice?.priceChanges.filter((change) => change.status === "pending").length ?? 0;
  const hasRawText = Boolean(invoice?.rawText?.trim());
  const hasSupplier = Boolean(invoice?.supplierId);
  const hasItems = (invoice?.items.length ?? 0) > 0;
  const hasPriceChanges = (invoice?.priceChanges.length ?? 0) > 0;
  const priceChangesByItemId = new Map((invoice?.priceChanges ?? []).map((change) => [change.invoiceItemId, change]));
  const itemRows = (invoice?.items ?? []).map((item) => {
    const priceChange = priceChangesByItemId.get(item.id) ?? null;
    const itemStatus = getInvoiceItemStatus(item, priceChange);
    const oldPrice = item.matchedProductPrice;
    const newPrice = item.priceWithVat;
    const comparisonPrice = item.normalizedComparisonPrice ?? newPrice;
    const oldPriceNumber = oldPrice ? Number(oldPrice) : null;
    const newPriceNumber = comparisonPrice ? Number(comparisonPrice) : null;
    const differenceAmount =
      oldPriceNumber !== null && Number.isFinite(oldPriceNumber) && newPriceNumber !== null && Number.isFinite(newPriceNumber)
        ? String(newPriceNumber - oldPriceNumber)
        : null;
    const differencePercent =
      oldPriceNumber && newPriceNumber !== null && Number.isFinite(newPriceNumber)
        ? String(((newPriceNumber - oldPriceNumber) / oldPriceNumber) * 100)
        : null;

    return {
      item,
      priceChange,
      itemStatus,
      lineTotal: getCalculatedLineTotal(item),
      differenceAmount,
      differencePercent,
    };
  });
  const totalItemsCount = itemRows.length;
  const matchedItemsCount = itemRows.filter(({ item }) => Boolean(item.matchedProductId)).length;
  const unmatchedItemsCount = itemRows.filter(({ itemStatus }) => itemStatus === "Нужно выбрать товар").length;
  const newItemsCount = itemRows.filter(({ itemStatus }) => itemStatus === "Новая позиция").length;
  const missingQuantityCount = itemRows.filter(({ itemStatus }) => itemStatus === "Нет количества").length;
  const missingPriceCount = itemRows.filter(({ itemStatus }) => itemStatus === "Нет цены").length;
  const unitReviewCount = itemRows.filter(({ itemStatus }) => itemStatus === "Проверить единицу").length;
  const priceReviewItemsCount = itemRows.filter(({ itemStatus }) => itemStatus === "Цена изменилась").length;
  const problemItemsCount = itemRows.filter(({ itemStatus }) => itemStatus !== "Готово").length;
  const blockingRows = itemRows.filter(({ itemStatus }) =>
    itemStatus === "Нужно выбрать товар" ||
    itemStatus === "Новая позиция" ||
    itemStatus === "Цена изменилась" ||
    itemStatus === "Проверить единицу" ||
    itemStatus === "Нет количества" ||
    itemStatus === "Нет цены" ||
    itemStatus === "Проверить цену",
  );
  const completionIssues = [
    unmatchedItemsCount > 0 ? `Нужно выбрать товар: ${unmatchedItemsCount}` : null,
    newItemsCount > 0 ? `Новые позиции: ${newItemsCount}` : null,
    priceReviewItemsCount > 0 ? `Цены на проверке: ${priceReviewItemsCount}` : null,
    unitReviewCount > 0 ? `Проверить единицу цены: ${unitReviewCount}` : null,
    missingQuantityCount > 0 ? `Нет количества: ${missingQuantityCount}` : null,
    missingPriceCount > 0 ? `Нет цены: ${missingPriceCount}` : null,
  ].filter((value): value is string => Boolean(value));
  const canApproveInvoice = completionIssues.length === 0 && invoice?.status !== "approved";
  const priceChangesChecked = hasItems && pendingPriceChangesCount === 0;
  const areAllItemsSelected = hasItems && selectedItemIds.length === (invoice?.items.length ?? 0);
  const isBusy =
    isSavingRawText ||
    isProcessing ||
    isAiParsingItems ||
    isParsingItems ||
    isDetectingPriceChanges ||
    isApprovingInvoice ||
    isDeletingInvoice ||
    isSavingItemEdit ||
    isBulkDeletingItems ||
    deletingItemId !== null ||
    creatingProductItemId !== null ||
    isSavingSupplier ||
    isCreatingSupplier ||
    isSavingProduct ||
    updatingPriceChangeId !== null;
  const processSteps = [
    { label: "Файл загружен", done: Boolean(invoice?.fileUrl) },
    { label: "Текст распознан", done: hasRawText },
    { label: "Поставщик выбран", done: hasSupplier },
    { label: "Товары разобраны", done: hasItems },
    { label: "Цены проверены", done: priceChangesChecked },
    { label: "Завершено", done: invoice?.status === "approved" },
  ];

  const closePreviewModal = useCallback(() => {
    setPreviewImage(null);
  }, []);

  const changePreviewZoom = useCallback((nextZoom: number) => {
    setPreviewImage((current) => (current ? { ...current, zoom: clampPreviewZoom(nextZoom) } : current));
  }, []);

  const resetPreviewZoom = useCallback(() => {
    setPreviewImage((current) => (current ? { ...current, zoom: 1 } : current));
  }, []);

  const goToPreviewImage = useCallback(
    (nextIndex: number) => {
      if (invoiceImageFiles.length === 0) {
        return;
      }

      const normalizedIndex = (nextIndex + invoiceImageFiles.length) % invoiceImageFiles.length;
      setPreviewImage({
        index: normalizedIndex,
        zoom: 1,
      });
    },
    [invoiceImageFiles.length],
  );

  const openPreviewModal = useCallback(
    (fileId: string) => {
      const imageIndex = invoiceImageFiles.findIndex((file) => file.id === fileId);

      if (imageIndex === -1) {
        return;
      }

      setPreviewImage({
        index: imageIndex,
        zoom: 1,
      });
    },
    [invoiceImageFiles],
  );

  useEffect(() => {
    if (!previewImage) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [previewImage]);

  useEffect(() => {
    if (!previewImage) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePreviewModal();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToPreviewImage(previewImage.index - 1);
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        goToPreviewImage(previewImage.index + 1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closePreviewModal, goToPreviewImage, previewImage]);

  useEffect(() => {
    if (!previewImage || !previewModalBodyRef.current) {
      return;
    }

    const target = previewModalBodyRef.current;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      changePreviewZoom(previewImage.zoom + (event.deltaY < 0 ? 0.1 : -0.1));
    };

    target.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      target.removeEventListener("wheel", handleWheel);
    };
  }, [changePreviewZoom, previewImage]);

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

  return (
    <div className="pageStack">
      <section className="heroCard invoiceHeroCompact">
        <Link className="secondaryButton compactButton invoicesBackLink" href="/invoices">
          <ArrowLeft size={16} strokeWidth={2} />
          Назад к накладным
        </Link>

        <div className="invoiceDetailsHeader">
          <div>
            <p className="panelEyebrow">Накладная</p>
            <h2 className="pageTitle">Накладная</h2>
          </div>
          <div className="invoiceHeaderActions">
            <button type="button" className="primaryButton compactButton" onClick={() => void handleProcessAndParseInvoice()} disabled={isBusy || invoiceFiles.length === 0}>
              {isProcessing || isAiParsingItems || isDetectingPriceChanges ? "Обрабатываем..." : "Распознать и разобрать"}
            </button>
            <button type="button" className="secondaryButton compactButton" onClick={() => void handleDeleteInvoice()} disabled={isBusy || isDeletingInvoice}>
              {isDeletingInvoice ? "Удаляем..." : "Удалить накладную"}
            </button>
            <span className={`statusPill ${statusClassNames[invoice.status]}`}>{statusLabels[invoice.status]}</span>
          </div>
        </div>

        <div className="invoiceProgressSteps">
          {processSteps.map((step, index) => (
            <div key={step.label} className={`invoiceProgressStep ${step.done ? "invoiceProgressStepDone" : ""}`}>
              <span>{index + 1}</span>
              <strong>{step.label}</strong>
            </div>
          ))}
        </div>

        <div className="invoiceMetaGrid invoiceMetaGridCompact invoiceMetaGridSummary">
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
            <strong>{formatDate(displayedInvoiceDate)}</strong>
          </div>
          <div className="supplierMetaItem">
            <span>Сумма</span>
            <strong>{formatMoney(invoice.totalAmount)}</strong>
          </div>
          <div className="supplierMetaItem">
            <span>Файлов</span>
            <strong>{invoiceFiles.length}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="cardHeader">
          <div>
            <p className="panelEyebrow">Проверка</p>
            <h2 className="sectionTitle">Проверка накладной</h2>
          </div>
          <button type="button" className="primaryButton compactButton" onClick={() => void handleApproveInvoice()} disabled={isBusy || !canApproveInvoice}>
            {isApprovingInvoice ? "Завершаем..." : invoice.status === "approved" ? "Завершена" : "Завершить накладную"}
          </button>
        </div>

        <div className="invoiceCompletionChecks">
          <span>Всего строк: <strong>{totalItemsCount}</strong></span>
          <span>Сопоставлено товаров: <strong>{matchedItemsCount}</strong></span>
          <span>Нужно выбрать товар: <strong>{unmatchedItemsCount}</strong></span>
          <span>Новых товаров: <strong>{newItemsCount}</strong></span>
          <span>Цен на проверке: <strong>{priceReviewItemsCount}</strong></span>
          <span>Строк с проблемами: <strong>{problemItemsCount}</strong></span>
        </div>

        {invoice.status === "approved" ? (
          <p className="successText">Накладная уже завершена.</p>
        ) : completionIssues.length > 0 ? (
          <>
            <p className="invoiceHint">До завершения нужно исправить:</p>
            <ul className="invoiceCompletionChecks">
              {completionIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
            <div className="invoiceItemSearchPanel">
              {blockingRows.map(({ item, itemStatus, priceChange }) => (
                <div key={item.id} className="invoiceSearchModalResultCard">
                  <div className="invoiceSearchModalResultMeta">
                    <strong>{item.productNameRaw}</strong>
                    <span>
                      {itemStatus === "Нужно выбрать товар"
                        ? "Нужно выбрать товар или создать новый."
                        : itemStatus === "Новая позиция"
                          ? "Новой позиции нет в каталоге."
                          : itemStatus === "Цена изменилась"
                            ? "Нужно подтвердить или отклонить изменение цены."
                            : itemStatus === "Нет цены"
                              ? "В строке нет цены."
                              : itemStatus === "Нет количества"
                                ? "В строке нет количества."
                                : itemStatus === "Проверить единицу"
                                  ? "Нужно проверить единицу цены."
                                  : "Строка требует проверки."}
                    </span>
                  </div>
                  <div className="compactProductActions invoiceItemRowActions">
                    {(itemStatus === "Нужно выбрать товар" || itemStatus === "Новая позиция") ? (
                      <>
                        <button type="button" className="secondaryButton compactButton" onClick={() => handleOpenProductSearch(item)} disabled={isBusy}>
                          Выбрать товар
                        </button>
                        <button
                          type="button"
                          className="secondaryButton compactButton"
                          onClick={() => void handleCreateProduct(item)}
                          disabled={isBusy}
                          title={invoice.supplierId ? undefined : "Сначала выберите поставщика"}
                        >
                          {creatingProductItemId === item.id ? "Создаём..." : "Создать товар"}
                        </button>
                      </>
                    ) : null}
                    {itemStatus === "Цена изменилась" && priceChange ? (
                      <>
                        <button
                          type="button"
                          className="primaryButton compactButton"
                          onClick={() => void handleUpdatePriceChange(priceChange.id, "approve")}
                          disabled={isBusy}
                        >
                          {updatingPriceChangeId === priceChange.id ? "Сохраняем..." : "Подтвердить цену"}
                        </button>
                        <button
                          type="button"
                          className="secondaryButton compactButton"
                          onClick={() => void handleUpdatePriceChange(priceChange.id, "reject")}
                          disabled={isBusy}
                        >
                          {updatingPriceChangeId === priceChange.id ? "Сохраняем..." : "Отклонить цену"}
                        </button>
                      </>
                    ) : null}
                    {(itemStatus === "Нет цены" || itemStatus === "Нет количества" || itemStatus === "Проверить единицу" || itemStatus === "Проверить цену") ? (
                      <button type="button" className="secondaryButton compactButton" onClick={() => handleOpenItemEdit(item)} disabled={isBusy}>
                        Редактировать
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            <p className="invoiceHint">Сначала исправьте строки на проверке.</p>
          </>
        ) : (
          <p className="successText">Все строки готовы. Накладную можно завершать.</p>
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <div>
            <p className="panelEyebrow">Файл</p>
            <h2 className="sectionTitle">Файлы накладной</h2>
          </div>
          <button type="button" className="primaryButton compactButton" onClick={() => void handleProcessAndParseInvoice()} disabled={isBusy || invoiceFiles.length === 0}>
            {isProcessing || isAiParsingItems || isDetectingPriceChanges ? "Обрабатываем..." : "Распознать и разобрать"}
          </button>
        </div>

        {errorMessage ? <p className="errorText">{errorMessage}</p> : null}
        {errorMessage && (debugRawTextPreview || draftRawText.trim()) ? (
          <details className="invoiceDetailsPanel">
            <summary>Показать распознанный текст</summary>
            <pre className="invoiceRawText">{debugRawTextPreview || draftRawText.slice(0, 4000)}</pre>
          </details>
        ) : null}
        {debugParseInfo ? (
          <details className="invoiceDetailsPanel">
            <summary>Показать детали разбора товаров</summary>
            <div className="invoiceCompletionChecks">
              <span>AI нашёл таблицу: <strong>{debugParseInfo.tableDetected ? "да" : "нет"}</strong></span>
              <span>Строк таблицы найдено: <strong>{debugParseInfo.tableRowsCount ?? 0}</strong></span>
              <span>Строк до фильтра: <strong>{debugParseInfo.itemsBeforeFilter ?? debugParseInfo.textParsedItemsCount ?? debugParseInfo.visionItemsCount ?? 0}</strong></span>
              <span>Товаров после фильтра: <strong>{debugParseInfo.filteredItemsCount ?? 0}</strong></span>
            </div>
            {debugParseInfo.rejectedItems?.length ? (
              <div className="invoiceItemSearchResults">
                {debugParseInfo.rejectedItems.slice(0, 50).map((item, index) => (
                  <div key={`${item.reason}-${index}`} className="invoiceItemSearchResult">
                    <strong>{item.name || "Пустая строка"}</strong>
                    <span>{item.reason}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </details>
        ) : null}
        {successMessage ? <p className="successText">{successMessage}</p> : null}

        {invoiceFiles.length === 0 ? (
          <div className="emptyState">
            <p className="emptyStateTitle">Файлы не загружены</p>
            <p className="emptyStateText">Для этой накладной пока нет сохранённых файлов.</p>
          </div>
        ) : (
          <div className="invoiceFilesGrid">
            {invoiceFiles.map((file) => {
              const currentFileKind = detectFileKind(file.fileUrl, file.originalFileName);
              const previewAlt = file.originalFileName || `Страница ${file.pageIndex + 1}`;

              return (
                <div key={file.id} className="invoiceFileTile">
                  <strong>Страница {file.pageIndex + 1}</strong>
                  {currentFileKind === "image" && file.fileUrl ? (
                    <>
                      <button type="button" className="invoicePreviewButton" onClick={() => openPreviewModal(file.id)}>
                        <div className="invoiceFilePreview">
                          <img src={file.fileUrl} alt={previewAlt} className="invoicePreviewImage" />
                        </div>
                      </button>
                      <a className="secondaryButton compactButton invoicesFileLink" href={file.fileUrl} target="_blank" rel="noreferrer">
                        <ExternalLink size={16} strokeWidth={2} />
                        Открыть крупно
                      </a>
                    </>
                  ) : (
                    <a className="secondaryButton compactButton invoicesFileLink" href={file.fileUrl || "#"} target="_blank" rel="noreferrer">
                      <ExternalLink size={16} strokeWidth={2} />
                      {currentFileKind === "pdf" ? "Открыть PDF" : "Открыть файл"}
                    </a>
                  )}
                  <span>{file.originalFileName || "Файл без имени"}</span>
                </div>
              );
            })}
          </div>
        )}

        {invoice.status === "failed" && !hasRawText ? (
          <p className="errorText">Не удалось прочитать текст. Попробуйте фото чётче или вставьте текст вручную.</p>
        ) : hasRawText ? (
          <p className="successText">Текст накладной есть. Можно переходить к поставщику и товарам.</p>
        ) : (
          <p className="invoiceHint">После распознавания здесь появится текст для разбора товаров.</p>
        )}

        <details className="invoiceDetailsPanel">
          <summary>Дополнительные действия</summary>
          <div className="invoiceSupplierActions">
            <button type="button" className="secondaryButton compactButton" onClick={() => void handleProcessInvoice()} disabled={isBusy || invoiceFiles.length === 0}>
              {isProcessing ? "Распознаём..." : "Только распознать"}
            </button>
            <button type="button" className="secondaryButton compactButton" onClick={() => void handleParseItems()} disabled={isBusy || !hasRawText}>
              {isParsingItems ? "Разбираем..." : "Разобрать без AI"}
            </button>
            <button type="button" className="secondaryButton compactButton" onClick={() => void handleDetectPriceChanges()} disabled={isBusy || !hasItems}>
              {isDetectingPriceChanges ? "Ищем..." : "Найти изменения цен"}
            </button>
          </div>
        </details>

        <details className="invoiceDetailsPanel">
          <summary>Показать распознанный текст</summary>
          <div className="invoiceManualTextPanel">
            <textarea
              className="fieldTextarea"
              rows={10}
              value={draftRawText}
              onChange={(event) => setDraftRawText(event.target.value)}
              placeholder="Вставьте текст накладной вручную"
              disabled={isBusy}
            />
            <div className="invoiceSupplierActions">
              <button type="button" className="primaryButton compactButton" onClick={() => void handleSaveRawText()} disabled={isBusy}>
                {isSavingRawText ? "Сохраняем..." : "Сохранить текст"}
              </button>
              <button
                type="button"
                className="secondaryButton compactButton"
                onClick={() => setDraftRawText(invoice.rawText ?? "")}
                disabled={isBusy}
              >
                Вернуть текст
              </button>
            </div>
          </div>
        </details>
      </section>

      <section className="card">
        <div className="cardHeader">
          <div>
            <p className="panelEyebrow">Шаг 2</p>
            <h2 className="sectionTitle">Поставщик</h2>
          </div>
          <div className="invoiceSupplierActions">
            <button type="button" className="secondaryButton compactButton" onClick={handleOpenSupplierSearch} disabled={isBusy}>
              {invoice.supplierId ? "Изменить" : "Выбрать поставщика"}
            </button>
            {invoice.supplierId ? (
              <button type="button" className="secondaryButton compactButton" onClick={() => void handleSelectSupplier(null)} disabled={isBusy}>
                Сбросить
              </button>
            ) : null}
          </div>
        </div>

        <div className="invoiceStepSummary">
          <FileText size={20} strokeWidth={2} />
          <div>
            <strong>{invoice.supplierId ? getSupplierName(invoice) : "Поставщик не найден"}</strong>
            <p>
              {invoice.supplierId
                ? "Поставщик выбран для этой накладной."
                : "Создайте нового поставщика из накладной или свяжите её с существующим."}
            </p>
          </div>
        </div>

        {!invoice.supplierId ? (
          <div className="emptyState invoiceSearchEmptyState">
            <p className="emptyStateTitle">Поставщик не найден</p>
            <p className="emptyStateText">
              {extractedSupplierDetails.supplierName ? `Название: ${extractedSupplierDetails.supplierName}` : "Название не удалось уверенно вытащить."}
            </p>
            {extractedSupplierDetails.legalName && extractedSupplierDetails.legalName !== extractedSupplierDetails.supplierName ? (
              <p className="emptyStateText">Юр. название: {extractedSupplierDetails.legalName}</p>
            ) : null}
            {extractedSupplierDetails.inn ? <p className="emptyStateText">ИНН: {extractedSupplierDetails.inn}</p> : null}
            <div className="invoiceSupplierActions">
              <button type="button" className="secondaryButton compactButton" onClick={handleOpenSupplierSearch} disabled={isBusy}>
                Связать с существующим поставщиком
              </button>
              <button type="button" className="primaryButton compactButton" onClick={handleOpenSupplierSearch} disabled={isBusy}>
                Создать поставщика из накладной
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="cardHeader">
          <div>
            <p className="panelEyebrow">Шаг 3</p>
            <h2 className="sectionTitle">Товары</h2>
          </div>
        </div>

        {hasItems ? (
          <div className="invoiceItemEditActions">
            <span className="invoiceHint">Выбрано строк: {selectedItemIds.length}</span>
            <button
              type="button"
              className="secondaryButton compactButton"
              onClick={() => void handleBulkDeleteItems()}
              disabled={isBusy || selectedItemIds.length === 0}
            >
              {isBulkDeletingItems ? "Удаляем..." : "Удалить выбранные"}
            </button>
          </div>
        ) : null}

        {!hasRawText ? <p className="invoiceHint">Сначала распознайте накладную или вставьте текст вручную.</p> : null}

        {invoice.items.length === 0 ? (
          <div className="emptyState">
            <p className="emptyStateTitle">Товары ещё не разобраны</p>
            <p className="emptyStateText">После разбора здесь появятся строки накладной.</p>
          </div>
        ) : (
          <div className="orderItemsTableWrap invoiceItemsTableWrap">
            <table className="orderItemsTable invoiceItemsTable">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={areAllItemsSelected}
                      onChange={handleToggleAllItems}
                      disabled={isBusy || !hasItems}
                      aria-label="Выбрать все строки"
                    />
                  </th>
                  <th>Товар</th>
                  <th>Кол-во</th>
                  <th>Цена без НДС</th>
                  <th>НДС</th>
                  <th>Цена с НДС</th>
                  <th>Сумма</th>
                  <th>Изменение</th>
                  <th>Статус</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {itemRows.map(({ item, priceChange, itemStatus, lineTotal, differenceAmount, differencePercent }) => {
                  const vatFields = getDisplayVatFields(item);
                  const showDerivedWithoutVat = !item.priceWithoutVat && vatFields.derivedPriceWithoutVat;
                  const showDerivedWithVat = !item.priceWithVat && vatFields.derivedPriceWithVat;
                  return (
                    <Fragment key={item.id}>
                      <tr className={item.matchedProductStatus === "new" ? "invoiceItemRowNew" : undefined}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedItemIds.includes(item.id)}
                            onChange={() => handleToggleItemSelection(item.id)}
                            disabled={isBusy}
                            aria-label="Выбрать строку"
                          />
                        </td>
                        <td>
                          <div className={`invoiceProductCell ${item.matchedProductStatus === "new" ? "invoiceProductCellNew" : ""}`}>
                            <strong>{item.productNameRaw}</strong>
                            <span>{getMatchedProductLabel(item)}</span>
                            {item.matchedProductStatus === "new" ? <span className="invoiceProductWarning">Такого товара нет в прайсе</span> : null}
                          </div>
                        </td>
                        <td>
                          <strong>{formatNumber(item.quantity)}</strong>
                          <span>{item.unit || "—"}</span>
                        </td>
                        <td>
                          <strong>{formatMoney(vatFields.priceWithoutVat === null ? null : String(vatFields.priceWithoutVat))}</strong>
                          {showDerivedWithoutVat ? <span>расчёт по НДС</span> : <span>—</span>}
                        </td>
                        <td>
                          <strong>{formatPercent(item.vatRate)}</strong>
                          <span>Ставка НДС</span>
                        </td>
                        <td>
                          <strong>{formatMoney(vatFields.priceWithVat === null ? null : String(vatFields.priceWithVat))}</strong>
                          <span>{item.matchedProductPrice ? `Было: ${formatMoney(item.matchedProductPrice)}` : "—"}</span>
                          {showDerivedWithVat ? <span>расчёт по НДС</span> : null}
                          {item.priceComparisonNote ? <span>{item.priceComparisonNote}</span> : null}
                        </td>
                        <td>
                          <strong>{formatMoney(lineTotal)}</strong>
                          {!item.lineTotal && lineTotal ? <span>Расчётная сумма</span> : null}
                        </td>
                        <td>
                          <strong>{formatMoney(priceChange?.differenceAmount ?? differenceAmount)}</strong>
                          <span>{formatPercent(priceChange?.differencePercent ?? differencePercent)}</span>
                        </td>
                        <td>
                          <span className={`statusPill ${getInvoiceItemStatusClassName(itemStatus)}`}>
                            {itemStatus}
                          </span>
                        </td>
                        <td>
                          <div className="compactProductActions invoiceItemRowActions">
                            {!item.matchedProductId ? (
                              <>
                                <button
                                  type="button"
                                  className="secondaryButton compactButton"
                                  onClick={() => handleOpenProductSearch(item)}
                                  disabled={isBusy}
                                >
                                  {itemStatus === "Нужно выбрать товар" ? "Выбрать" : "Выбрать вручную"}
                                </button>
                                <button
                                  type="button"
                                  className="secondaryButton compactButton"
                                  onClick={() => void handleCreateProduct(item)}
                                  disabled={isBusy}
                                  title={invoice.supplierId ? undefined : "Сначала выберите поставщика"}
                                >
                                  {creatingProductItemId === item.id ? "Создаём..." : "Создать товар"}
                                </button>
                              </>
                            ) : itemStatus !== "Цена изменилась" ? (
                              <button
                                type="button"
                                className="secondaryButton compactButton"
                                onClick={() => handleOpenProductSearch(item)}
                                disabled={isBusy}
                              >
                                Изменить
                              </button>
                            ) : null}

                            {priceChange?.status === "pending" ? (
                              <>
                                <button
                                  type="button"
                                  className="primaryButton compactButton"
                                  onClick={() => void handleUpdatePriceChange(priceChange.id, "approve")}
                                  disabled={isBusy}
                                >
                                  {updatingPriceChangeId === priceChange.id ? "Сохраняем..." : "Подтвердить цену"}
                                </button>
                                <button
                                  type="button"
                                  className="secondaryButton compactButton"
                                  onClick={() => void handleUpdatePriceChange(priceChange.id, "reject")}
                                  disabled={isBusy}
                                >
                                  {updatingPriceChangeId === priceChange.id ? "Сохраняем..." : "Отклонить цену"}
                                </button>
                              </>
                            ) : null}

                            {itemStatus !== "Цена изменилась" ? (
                              <button
                                type="button"
                                className="secondaryButton compactButton"
                                onClick={() => handleOpenItemEdit(item)}
                                disabled={isBusy}
                              >
                                Редактировать
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="secondaryButton compactButton"
                              onClick={() => void handleDeleteItem(item.id)}
                              disabled={isBusy}
                            >
                              {deletingItemId === item.id ? "Удаляем..." : "Удалить"}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {editingItemId === item.id && editItemDraft ? (
                        <tr className="invoiceItemSearchRow">
                          <td colSpan={10}>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {hasItems ? (
        <section className="card">
          <div className="cardHeader">
            <div>
              <p className="panelEyebrow">Шаг 4</p>
              <h2 className="sectionTitle">Изменения цен</h2>
            </div>
          </div>

          {invoice.priceChanges.length === 0 ? (
            <p className="invoiceHint">Изменений цен пока нет.</p>
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
                  </tr>
                </thead>
                <tbody>
                  {invoice.priceChanges.map((change) => (
                    <tr key={change.id}>
                      <td><strong>{change.productName}</strong></td>
                      <td>{formatMoney(change.oldPrice)}</td>
                      <td>
                        <strong>{formatMoney(change.newPrice)}</strong>
                        {change.comparisonNote ? <span>{change.comparisonNote}</span> : null}
                      </td>
                      <td>
                        <strong>{formatMoney(change.differenceAmount)}</strong>
                        <span>{formatPercent(change.differencePercent)}</span>
                      </td>
                      <td>
                        <span className={`statusPill ${priceChangeStatusClassNames[change.status]}`}>{priceChangeStatusLabels[change.status]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {productSearchItem ? (
        <div className="invoiceSearchModal" onClick={handleCloseProductSearch} role="presentation">
          <div className="invoiceSearchModalBody" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Выбрать товар">
            <div className="invoiceSearchModalHeader">
              <div>
                <p className="panelEyebrow">Товар из накладной</p>
                <h2 className="sectionTitle">Выбрать товар</h2>
                <p className="pageDescription">{productSearchItem.productNameRaw}</p>
              </div>
              <button type="button" className="secondaryButton compactButton" onClick={handleCloseProductSearch} disabled={isBusy}>
                Закрыть
              </button>
            </div>

            <div className="invoiceSearchModalToolbar">
              <label className="field">
                <span>Поиск</span>
                <input
                  type="text"
                  value={productSearchQuery}
                  onChange={(event) => setProductSearchQuery(event.target.value)}
                  placeholder="Начните вводить название товара"
                  disabled={isBusy}
                />
              </label>

              <div className="invoiceSearchScope">
                <span className="invoiceHint">
                  {invoice.supplierId && !productSearchAllSuppliers
                    ? `Сейчас ищем только у поставщика: ${getSupplierName(invoice)}`
                    : "Сейчас ищем по всем поставщикам"}
                </span>
                {invoice.supplierId && !productSearchAllSuppliers ? (
                  <button
                    type="button"
                    className="secondaryButton compactButton"
                    onClick={() => setProductSearchAllSuppliers(true)}
                    disabled={isBusy}
                  >
                    Искать среди всех поставщиков
                  </button>
                ) : null}
              </div>
            </div>

            <div className="invoiceItemSearchPanel">
              <div className="invoiceSearchModalHeader">
                <div>
                  <p className="panelEyebrow">Новая позиция</p>
                  <h3 className="sectionTitle">Не нашли нужный товар?</h3>
                  <p className="pageDescription">Можно сразу создать новый товар из строки накладной.</p>
                </div>
                <button
                  type="button"
                  className="primaryButton compactButton"
                  onClick={() => void handleCreateProduct(productSearchItem)}
                  disabled={isBusy}
                  title={invoice.supplierId ? undefined : "Сначала выберите поставщика"}
                >
                  {creatingProductItemId === productSearchItem.id ? "Создаём..." : "Создать новый товар из строки накладной"}
                </button>
              </div>
              {!invoice.supplierId ? <p className="invoiceHint">Сначала выберите поставщика.</p> : null}
            </div>

            {productSearchError ? <p className="errorText">{productSearchError}</p> : null}
            {isSearchingProducts ? <p className="invoiceHint">Ищем товары...</p> : null}

            {!isSearchingProducts && productSearchQuery.trim() && productSearchResults.length === 0 ? (
              <div className="emptyState invoiceSearchEmptyState">
                <p className="emptyStateTitle">
                  {invoice.supplierId && !productSearchAllSuppliers ? "У этого поставщика товар не найден" : "Товары не найдены"}
                </p>
                <div className="invoiceSupplierActions">
                  {invoice.supplierId && !productSearchAllSuppliers ? (
                    <button
                      type="button"
                      className="secondaryButton compactButton"
                      onClick={() => setProductSearchAllSuppliers(true)}
                      disabled={isBusy}
                    >
                      Искать среди всех поставщиков
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {productSearchResults.length > 0 ? (
              <>
                <p className="invoiceHint">Найдено товаров: {productSearchResults.length}</p>
                <div className="invoiceSearchModalResults">
                  {productSearchResults.map((product) => (
                    <div key={product.id} className="invoiceSearchModalResultCard">
                      <div className="invoiceSearchModalResultMeta">
                        <strong>{product.name}</strong>
                        <span>Поставщик: {product.supplierName || "—"}</span>
                        <span>
                          {[product.price ? formatMoney(product.price) : null, product.unit || null, product.unitsPerPack ? `фасовка ${product.unitsPerPack}` : null]
                            .filter(Boolean)
                            .join(" • ") || "Без цены и фасовки"}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="primaryButton compactButton"
                        onClick={() => void handleSelectProduct(productSearchItem.id, product.id)}
                        disabled={isBusy}
                      >
                        Выбрать
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {isSupplierSearchOpen ? (
        <div className="invoiceSearchModal" onClick={handleCloseSupplierSearch} role="presentation">
          <div className="invoiceSearchModalBody" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Выбрать поставщика">
            <div className="invoiceSearchModalHeader">
              <div>
                <p className="panelEyebrow">Поставщик</p>
                <h2 className="sectionTitle">Связать или создать поставщика</h2>
                {extractedSupplierDetails.supplierName ? <p className="pageDescription">Из накладной: {extractedSupplierDetails.supplierName}</p> : null}
              </div>
              <button type="button" className="secondaryButton compactButton" onClick={handleCloseSupplierSearch} disabled={isBusy}>
                Закрыть
              </button>
            </div>

            {!invoice?.supplierId ? (
              <div className="card">
                <div className="cardHeader">
                  <div>
                    <p className="panelEyebrow">Новый поставщик</p>
                    <h3 className="sectionTitle">Создать поставщика из накладной</h3>
                  </div>
                </div>

                <div className="invoiceSearchModalToolbar">
                  <label className="field">
                    <span>Название поставщика</span>
                    <input
                      type="text"
                      value={createSupplierDraft.supplierName}
                      onChange={(event) => handleChangeCreateSupplierDraft("supplierName", event.target.value)}
                      placeholder="ООО Хорека Фуд"
                      disabled={isBusy}
                    />
                  </label>
                  <label className="field">
                    <span>Юр. название</span>
                    <input
                      type="text"
                      value={createSupplierDraft.legalName}
                      onChange={(event) => handleChangeCreateSupplierDraft("legalName", event.target.value)}
                      placeholder="Полное юр. название"
                      disabled={isBusy}
                    />
                  </label>
                  <label className="field">
                    <span>ИНН</span>
                    <input
                      type="text"
                      value={createSupplierDraft.inn}
                      onChange={(event) => handleChangeCreateSupplierDraft("inn", event.target.value)}
                      placeholder="10 или 12 цифр"
                      disabled={isBusy}
                    />
                  </label>
                  <label className="field">
                    <span>Alias</span>
                    <input
                      type="text"
                      value={createSupplierDraft.alias}
                      onChange={(event) => handleChangeCreateSupplierDraft("alias", event.target.value)}
                      placeholder="Доп. вариант названия из накладной"
                      disabled={isBusy}
                    />
                  </label>
                  <label className="field">
                    <span>Комментарий</span>
                    <input
                      type="text"
                      value={createSupplierDraft.comment}
                      onChange={(event) => handleChangeCreateSupplierDraft("comment", event.target.value)}
                      placeholder="Что сохранить по поставщику"
                      disabled={isBusy}
                    />
                  </label>
                </div>

                <div className="invoiceSupplierActions">
                  <button type="button" className="primaryButton compactButton" onClick={() => void handleCreateSupplierFromInvoice()} disabled={isBusy}>
                    {isCreatingSupplier ? "Создаём..." : "Создать поставщика из накладной"}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="invoiceSearchModalToolbar">
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
            </div>

            {supplierSearchError ? <p className="errorText">{supplierSearchError}</p> : null}
            {isSearchingSuppliers ? <p className="invoiceHint">Ищем поставщиков...</p> : null}

            {!isSearchingSuppliers && supplierSearchQuery.trim() && supplierSearchResults.length === 0 ? (
              <div className="emptyState invoiceSearchEmptyState">
                <p className="emptyStateTitle">Поставщики не найдены</p>
                <p className="emptyStateText">Попробуйте другое название или часть названия.</p>
              </div>
            ) : null}

            {supplierSearchResults.length > 0 ? (
              <>
                <p className="invoiceHint">Найдено поставщиков: {supplierSearchResults.length}</p>
                <div className="invoiceSearchModalResults">
                  {supplierSearchResults.map((supplier) => (
                    <div key={supplier.id} className="invoiceSearchModalResultCard">
                      <div className="invoiceSearchModalResultMeta">
                        <strong>{supplier.name}</strong>
                        <span>{supplier.email || supplier.phone || "Без контактов"}</span>
                      </div>
                      <button
                        type="button"
                        className="primaryButton compactButton"
                        onClick={() => void handleSelectSupplier(supplier.id)}
                        disabled={isBusy}
                      >
                        Связать
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {previewImage && currentPreviewFile?.fileUrl ? (
        <div className="invoicePreviewModal" onClick={closePreviewModal} role="presentation">
          <div
            ref={previewModalBodyRef}
            className="invoicePreviewModalBody"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Просмотр накладной"
          >
            <div className="invoicePreviewModalToolbar">
              <div className="invoicePreviewModalPager">
                <button
                  type="button"
                  className="secondaryButton compactButton"
                  onClick={() => goToPreviewImage(previewImage.index - 1)}
                  disabled={invoiceImageFiles.length <= 1}
                  aria-label="Предыдущая страница"
                >
                  <ChevronLeft size={16} strokeWidth={2} />
                </button>
                <span>
                  Страница {previewImage.index + 1} из {invoiceImageFiles.length}
                </span>
                <button
                  type="button"
                  className="secondaryButton compactButton"
                  onClick={() => goToPreviewImage(previewImage.index + 1)}
                  disabled={invoiceImageFiles.length <= 1}
                  aria-label="Следующая страница"
                >
                  <ChevronRight size={16} strokeWidth={2} />
                </button>
              </div>

              <div className="invoicePreviewModalActions">
                <button type="button" className="secondaryButton compactButton" onClick={() => changePreviewZoom(previewImage.zoom - 0.1)}>
                  <Minus size={16} strokeWidth={2} />
                </button>
                <span className="invoicePreviewZoomLabel">{Math.round(previewImage.zoom * 100)}%</span>
                <button type="button" className="secondaryButton compactButton" onClick={() => changePreviewZoom(previewImage.zoom + 0.1)}>
                  <Plus size={16} strokeWidth={2} />
                </button>
                <button type="button" className="secondaryButton compactButton" onClick={resetPreviewZoom}>
                  <RotateCcw size={16} strokeWidth={2} />
                  Сбросить масштаб
                </button>
                <button type="button" className="secondaryButton compactButton invoicePreviewModalClose" onClick={closePreviewModal}>
                  <X size={16} strokeWidth={2} />
                  Закрыть
                </button>
              </div>
            </div>

            <div className="invoicePreviewViewport">
              <img
                src={currentPreviewFile.fileUrl}
                alt={currentPreviewFile.originalFileName || `Страница ${previewImage.index + 1}`}
                className="invoicePreviewModalImage"
                style={{ transform: `scale(${previewImage.zoom})` }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}


