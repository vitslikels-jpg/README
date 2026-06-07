"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, FileText, Minus, Plus, RotateCcw, X } from "lucide-react";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";

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
      return "РќСѓР¶РЅРѕ РІС‹Р±СЂР°С‚СЊ С‚РѕРІР°СЂ";
    }

    if (item.matchedProductStatus === "new") {
      return "РќРѕРІР°СЏ РїРѕР·РёС†РёСЏ";
    }

    return "РќРµ СЃРѕРїРѕСЃС‚Р°РІР»РµРЅ";
  }

  return [item.matchedProductName, item.matchedProductArticle, item.matchedProductBrand].filter(Boolean).join(" \u2022 ");
}

function getInvoiceItemStatus(item: InvoiceItem, change: InvoicePriceChange | null) {
  if (item.matchedProductStatus === "new") {
    return "РќРѕРІР°СЏ РїРѕР·РёС†РёСЏ";
  }

  if (!item.matchedProductId) {
    return "РќРµ СЃРѕРїРѕСЃС‚Р°РІР»РµРЅ";
  }

  if (change?.status === "pending") {
    return "Р¦РµРЅР° РёР·РјРµРЅРёР»Р°СЃСЊ";
  }

  if (item.needsReview || change?.status === "rejected") {
    return "РџСЂРѕРІРµСЂРёС‚СЊ";
  }

  return "Р“РѕС‚РѕРІРѕ";
}

function getInvoiceItemStatusClassName(itemStatus: string) {
  if (itemStatus === "Р“РѕС‚РѕРІРѕ") {
    return "invoiceStatus-approved";
  }

  if (itemStatus === "Р¦РµРЅР° РёР·РјРµРЅРёР»Р°СЃСЊ" || itemStatus === "РџСЂРѕРІРµСЂРёС‚СЊ") {
    return "invoiceStatus-review";
  }

  if (itemStatus === "РќРѕРІР°СЏ РїРѕР·РёС†РёСЏ") {
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
          throw new Error(payload?.message ?? "РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РЅР°РєР»Р°РґРЅСѓСЋ.");
        }

        setInvoice(payload);
        setDraftRawText(payload?.rawText ?? "");
      } catch (error) {
        if (signal?.aborted) {
          return;
        }

        setInvoice(null);
        setDraftRawText("");
        setErrorMessage(error instanceof Error ? error.message : "РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РЅР°РєР»Р°РґРЅСѓСЋ.");
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
          throw new Error((payload as { message?: string } | null)?.message ?? "РќРµ СѓРґР°Р»РѕСЃСЊ РЅР°Р№С‚Рё РїРѕСЃС‚Р°РІС‰РёРєРѕРІ.");
        }

        setSupplierSearchResults(Array.isArray(payload) ? payload : []);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setSupplierSearchResults([]);
        setSupplierSearchError(error instanceof Error ? error.message : "РќРµ СѓРґР°Р»РѕСЃСЊ РЅР°Р№С‚Рё РїРѕСЃС‚Р°РІС‰РёРєРѕРІ.");
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
        throw new Error(payload?.message ?? "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ С‚РµРєСЃС‚.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      setSuccessMessage(draftRawText.trim() ? "РўРµРєСЃС‚ РЅР°РєР»Р°РґРЅРѕР№ СЃРѕС…СЂР°РЅС‘РЅ." : "РўРµРєСЃС‚ РѕС‡РёС‰РµРЅ, СЃС‚Р°С‚СѓСЃ РѕР±РЅРѕРІР»С‘РЅ.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ С‚РµРєСЃС‚.");
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
        throw new Error(payload?.message ?? "РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±СЂР°Р±РѕС‚Р°С‚СЊ РЅР°РєР»Р°РґРЅСѓСЋ.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      setSuccessMessage("РўРµРєСЃС‚ РЅР°РєР»Р°РґРЅРѕР№ СЂР°СЃРїРѕР·РЅР°РЅ.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±СЂР°Р±РѕС‚Р°С‚СЊ РЅР°РєР»Р°РґРЅСѓСЋ.");
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
        throw new Error(payload?.message ?? "РќРµ СѓРґР°Р»РѕСЃСЊ СЂР°Р·РѕР±СЂР°С‚СЊ С‚РѕРІР°СЂС‹.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      setSuccessMessage(`РЎРѕР·РґР°РЅРѕ СЃС‚СЂРѕРє: ${payload?.createdItemsCount ?? 0}. РўСЂРµР±СѓСЋС‚ РїСЂРѕРІРµСЂРєРё: ${payload?.reviewItemsCount ?? 0}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "РќРµ СѓРґР°Р»РѕСЃСЊ СЂР°Р·РѕР±СЂР°С‚СЊ С‚РѕРІР°СЂС‹.");
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
        throw new Error(payload?.message ?? "AI РЅРµ СЃРјРѕРі СЂР°Р·РѕР±СЂР°С‚СЊ С‚РѕРІР°СЂС‹. РџСЂРѕРІРµСЂСЊС‚Рµ СЂР°СЃРїРѕР·РЅР°РЅРЅС‹Р№ С‚РµРєСЃС‚ РёР»Рё РёСЃРїРѕР»СЊР·СѓР№С‚Рµ СЂР°Р·Р±РѕСЂ Р±РµР· AI.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      setSuccessMessage(
        payload?.visionUsed || payload?.fallbackUsed
          ? payload?.message ?? "AI РЅРµ РЅР°С€С‘Р» С‚РѕРІР°СЂС‹, РёСЃРїРѕР»СЊР·РѕРІР°РЅ РїСЂРѕСЃС‚РѕР№ СЂР°Р·Р±РѕСЂ."
          : `AI-СЂР°Р·Р±РѕСЂ РіРѕС‚РѕРІ. РЎРѕР·РґР°РЅРѕ СЃС‚СЂРѕРє: ${payload?.createdItemsCount ?? 0}. РўСЂРµР±СѓСЋС‚ РїСЂРѕРІРµСЂРєРё: ${payload?.reviewItemsCount ?? 0}.`,
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "AI РЅРµ СЃРјРѕРі СЂР°Р·РѕР±СЂР°С‚СЊ С‚РѕРІР°СЂС‹. РџСЂРѕРІРµСЂСЊС‚Рµ СЂР°СЃРїРѕР·РЅР°РЅРЅС‹Р№ С‚РµРєСЃС‚ РёР»Рё РёСЃРїРѕР»СЊР·СѓР№С‚Рµ СЂР°Р·Р±РѕСЂ Р±РµР· AI.");
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
        throw new Error(processPayload?.message ?? "OCR РЅРµ РїСЂРѕС‡РёС‚Р°Р» С‚РµРєСЃС‚.");
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
        throw new Error(aiPayload?.message ?? "AI РЅРµ СЃРјРѕРі СЂР°Р·РѕР±СЂР°С‚СЊ С‚РѕРІР°СЂС‹. РџСЂРѕРІРµСЂСЊС‚Рµ СЂР°СЃРїРѕР·РЅР°РЅРЅС‹Р№ С‚РµРєСЃС‚ РёР»Рё РёСЃРїРѕР»СЊР·СѓР№С‚Рµ СЂР°Р·Р±РѕСЂ Р±РµР· AI.");
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
      setErrorMessage(error instanceof Error ? error.message : "РќРµ СѓРґР°Р»РѕСЃСЊ РІС‹РїРѕР»РЅРёС‚СЊ РїРѕР»РЅС‹Р№ СЂР°Р·Р±РѕСЂ РЅР°РєР»Р°РґРЅРѕР№.");
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
        throw new Error(payload?.message ?? "РќРµ СѓРґР°Р»РѕСЃСЊ РЅР°Р№С‚Рё РёР·РјРµРЅРµРЅРёСЏ С†РµРЅ.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      setSuccessMessage(
        `РќР°Р№РґРµРЅРѕ РёР·РјРµРЅРµРЅРёР№ С†РµРЅ: ${payload?.createdPriceChangesCount ?? 0}. РџСЂРѕРїСѓС‰РµРЅРѕ СЃС‚СЂРѕРє: ${payload?.skippedItemsCount ?? 0}.`,
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "РќРµ СѓРґР°Р»РѕСЃСЊ РЅР°Р№С‚Рё РёР·РјРµРЅРµРЅРёСЏ С†РµРЅ.");
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
        throw new Error(payload?.message ?? "РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ РёР·РјРµРЅРµРЅРёРµ С†РµРЅС‹.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      setSuccessMessage(action === "approve" ? "РР·РјРµРЅРµРЅРёРµ С†РµРЅС‹ РїРѕРґС‚РІРµСЂР¶РґРµРЅРѕ." : "РР·РјРµРЅРµРЅРёРµ С†РµРЅС‹ РѕС‚РєР»РѕРЅРµРЅРѕ.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ РёР·РјРµРЅРµРЅРёРµ С†РµРЅС‹.");
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
            `${payload.error}. РЎРЅР°С‡Р°Р»Р° РїСЂРѕРІРµСЂСЊС‚Рµ СЃС‚СЂРѕРєРё Рё РёР·РјРµРЅРµРЅРёСЏ С†РµРЅ. РЎС‚СЂРѕРє РЅР° РїСЂРѕРІРµСЂРєРµ: ${payload.reviewItemsCount ?? 0}. РР·РјРµРЅРµРЅРёР№ С†РµРЅ РЅР° РїСЂРѕРІРµСЂРєРµ: ${payload.pendingPriceChangesCount ?? 0}.`,
          );
        }

        throw new Error(payload?.message ?? "РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РІРµСЂС€РёС‚СЊ РЅР°РєР»Р°РґРЅСѓСЋ.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      setSuccessMessage("РќР°РєР»Р°РґРЅР°СЏ РїРѕРґС‚РІРµСЂР¶РґРµРЅР°.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РІРµСЂС€РёС‚СЊ РЅР°РєР»Р°РґРЅСѓСЋ.");
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
        throw new Error(payload?.message ?? "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ С‚РѕРІР°СЂ.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      handleCloseProductSearch();
      setSuccessMessage(matchedProductId ? "РўРѕРІР°СЂ РґР»СЏ СЃС‚СЂРѕРєРё РІС‹Р±СЂР°РЅ." : "РЎРѕРїРѕСЃС‚Р°РІР»РµРЅРёРµ СЃРѕ СЃС‚СЂРѕРєРѕР№ СЃР±СЂРѕС€РµРЅРѕ.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ С‚РѕРІР°СЂ.";
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
      setErrorMessage("РќР°Р·РІР°РЅРёРµ С‚РѕРІР°СЂР° РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ РїСѓСЃС‚С‹Рј.");
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
        throw new Error(apiPayload?.message ?? "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ СЃС‚СЂРѕРєСѓ РЅР°РєР»Р°РґРЅРѕР№.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      handleCloseItemEdit();
      setSuccessMessage("РЎС‚СЂРѕРєР° РЅР°РєР»Р°РґРЅРѕР№ РѕР±РЅРѕРІР»РµРЅР°.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ СЃС‚СЂРѕРєСѓ РЅР°РєР»Р°РґРЅРѕР№.");
    } finally {
      setIsSavingItemEdit(false);
    }
  }

  async function handleDeleteItem(itemId: string) {
    if (!activeEnterpriseId || !params?.id) {
      return;
    }

    if (!window.confirm("РЈРґР°Р»РёС‚СЊ СЌС‚Сѓ СЃС‚СЂРѕРєСѓ РёР· РЅР°РєР»Р°РґРЅРѕР№?")) {
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
        throw new Error(payload?.message ?? "РќРµ СѓРґР°Р»РѕСЃСЊ СѓРґР°Р»РёС‚СЊ СЃС‚СЂРѕРєСѓ РЅР°РєР»Р°РґРЅРѕР№.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      setSuccessMessage("РЎС‚СЂРѕРєР° РЅР°РєР»Р°РґРЅРѕР№ СѓРґР°Р»РµРЅР°.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "РќРµ СѓРґР°Р»РѕСЃСЊ СѓРґР°Р»РёС‚СЊ СЃС‚СЂРѕРєСѓ РЅР°РєР»Р°РґРЅРѕР№.");
    } finally {
      setDeletingItemId(null);
    }
  }

  async function handleCreateProduct(item: InvoiceItem) {
    if (!activeEnterpriseId || !params?.id || !invoice) {
      return;
    }

    if (!invoice.supplierId) {
      setErrorMessage("РЎРЅР°С‡Р°Р»Р° РІС‹Р±РµСЂРёС‚Рµ РїРѕСЃС‚Р°РІС‰РёРєР°.");
      return;
    }

    if (!window.confirm("РЎРѕР·РґР°С‚СЊ РЅРѕРІС‹Р№ С‚РѕРІР°СЂ РІРѕ РІРЅСѓС‚СЂРµРЅРЅРµРј РЅР°РєРѕРїРёС‚РµР»Рµ?")) {
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
        throw new Error(payload?.message ?? "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕР·РґР°С‚СЊ С‚РѕРІР°СЂ.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      handleCloseProductSearch();
      setSuccessMessage("РўРѕРІР°СЂ СЃРѕР·РґР°РЅ Рё РїСЂРёРІСЏР·Р°РЅ Рє СЃС‚СЂРѕРєРµ РЅР°РєР»Р°РґРЅРѕР№.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕР·РґР°С‚СЊ С‚РѕРІР°СЂ.";
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

    if (!window.confirm("РЈРґР°Р»РёС‚СЊ РЅР°РєР»Р°РґРЅСѓСЋ? Р­С‚Рѕ РґРµР№СЃС‚РІРёРµ РЅРµР»СЊР·СЏ РѕС‚РјРµРЅРёС‚СЊ.")) {
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
        throw new Error(payload?.message ?? "РќРµ СѓРґР°Р»РѕСЃСЊ СѓРґР°Р»РёС‚СЊ РЅР°РєР»Р°РґРЅСѓСЋ.");
      }

      router.push("/invoices");
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "РќРµ СѓРґР°Р»РѕСЃСЊ СѓРґР°Р»РёС‚СЊ РЅР°РєР»Р°РґРЅСѓСЋ.");
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

    if (!window.confirm(`РЈРґР°Р»РёС‚СЊ РІС‹Р±СЂР°РЅРЅС‹Рµ СЃС‚СЂРѕРєРё: ${selectedItemIds.length}?`)) {
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
        throw new Error(payload?.message ?? "РќРµ СѓРґР°Р»РѕСЃСЊ СѓРґР°Р»РёС‚СЊ РІС‹Р±СЂР°РЅРЅС‹Рµ СЃС‚СЂРѕРєРё.");
      }

      await loadInvoice(activeEnterpriseId, params.id);
      setSelectedItemIds([]);
      setSuccessMessage(`РЈРґР°Р»РµРЅРѕ СЃС‚СЂРѕРє: ${payload?.deletedCount ?? selectedItemIds.length}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "РќРµ СѓРґР°Р»РѕСЃСЊ СѓРґР°Р»РёС‚СЊ РІС‹Р±СЂР°РЅРЅС‹Рµ СЃС‚СЂРѕРєРё.");
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
        throw new Error(payload?.message ?? "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ РїРѕСЃС‚Р°РІС‰РёРєР°.");
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
      const message = error instanceof Error ? error.message : "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ РїРѕСЃС‚Р°РІС‰РёРєР°.";
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
          <p className="panelEyebrow">РќР°РєР»Р°РґРЅС‹Рµ</p>
          <h2 className="pageTitle">РЎРЅР°С‡Р°Р»Р° РІС‹Р±РµСЂРёС‚Рµ РїСЂРµРґРїСЂРёСЏС‚РёРµ</h2>
          <p className="pageDescription">Р§С‚РѕР±С‹ РѕС‚РєСЂС‹С‚СЊ РЅР°РєР»Р°РґРЅСѓСЋ, РІС‹Р±РµСЂРёС‚Рµ Р°РєС‚РёРІРЅРѕРµ РїСЂРµРґРїСЂРёСЏС‚РёРµ РІ РІРµСЂС…РЅРµР№ РїР°РЅРµР»Рё.</p>
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
            <p className="emptyStateTitle">Р—Р°РіСЂСѓР·РєР° РЅР°РєР»Р°РґРЅРѕР№</p>
            <p className="emptyStateText">РљР°СЂС‚РѕС‡РєР° РЅР°РєР»Р°РґРЅРѕР№ Р·Р°РіСЂСѓР¶Р°РµС‚СЃСЏ.</p>
          </div>
        </section>
      </div>
    );
  }

  if (isNotFound) {
    return (
      <div className="pageStack">
        <section className="card pagePlaceholder">
          <p className="panelEyebrow">РќР°РєР»Р°РґРЅС‹Рµ</p>
          <h2 className="pageTitle">РќР°РєР»Р°РґРЅР°СЏ РЅРµ РЅР°Р№РґРµРЅР°</h2>
          <p className="pageDescription">Р­С‚Р° РЅР°РєР»Р°РґРЅР°СЏ РЅРµ РЅР°Р№РґРµРЅР° РІ РІС‹Р±СЂР°РЅРЅРѕРј РїСЂРµРґРїСЂРёСЏС‚РёРё РёР»Рё Р±С‹Р»Р° СѓРґР°Р»РµРЅР°.</p>
          <Link className="secondaryButton compactButton invoicesBackLink" href="/invoices">
            <ArrowLeft size={16} strokeWidth={2} />
            РќР°Р·Р°Рґ Рє РЅР°РєР»Р°РґРЅС‹Рј
          </Link>
        </section>
      </div>
    );
  }

  if (errorMessage && !invoice) {
    return (
      <div className="pageStack">
        <section className="card pagePlaceholder">
          <p className="panelEyebrow">РќР°РєР»Р°РґРЅС‹Рµ</p>
          <h2 className="pageTitle">РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё</h2>
          <p className="pageDescription">{errorMessage}</p>
          <Link className="secondaryButton compactButton invoicesBackLink" href="/invoices">
            <ArrowLeft size={16} strokeWidth={2} />
            РќР°Р·Р°Рґ Рє РЅР°РєР»Р°РґРЅС‹Рј
          </Link>
        </section>
      </div>
    );
  }

  if (!invoice) {
    return null;
  }

  const invoiceFiles = getInvoiceFiles(invoice);
  const invoiceImageFiles = useMemo(
    () => invoiceFiles.filter((file) => detectFileKind(file.fileUrl, file.originalFileName) === "image" && file.fileUrl),
    [invoiceFiles],
  );
  const currentPreviewFile = previewImage ? invoiceImageFiles[previewImage.index] ?? null : null;
  const productSearchItem = productSearchItemId ? invoice.items.find((item) => item.id === productSearchItemId) ?? null : null;
  const reviewItemsCount = invoice.items.filter((item) => item.needsReview).length;
  const pendingPriceChangesCount = invoice.priceChanges.filter((change) => change.status === "pending").length;
  const hasRawText = Boolean(invoice.rawText?.trim());
  const hasSupplier = Boolean(invoice.supplierId);
  const hasItems = invoice.items.length > 0;
  const hasPriceChanges = invoice.priceChanges.length > 0;
  const priceChangesByItemId = new Map(invoice.priceChanges.map((change) => [change.invoiceItemId, change]));
  const priceChangesChecked = hasItems && pendingPriceChangesCount === 0;
  const areAllItemsSelected = hasItems && selectedItemIds.length === invoice.items.length;
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
    isSavingProduct ||
    updatingPriceChangeId !== null;
  const processSteps = [
    { label: "Р¤Р°Р№Р» Р·Р°РіСЂСѓР¶РµРЅ", done: Boolean(invoice.fileUrl) },
    { label: "РўРµРєСЃС‚ СЂР°СЃРїРѕР·РЅР°РЅ", done: hasRawText },
    { label: "РџРѕСЃС‚Р°РІС‰РёРє РІС‹Р±СЂР°РЅ", done: hasSupplier },
    { label: "РўРѕРІР°СЂС‹ СЂР°Р·РѕР±СЂР°РЅС‹", done: hasItems },
    { label: "Р¦РµРЅС‹ РїСЂРѕРІРµСЂРµРЅС‹", done: priceChangesChecked },
    { label: "Р—Р°РІРµСЂС€РµРЅРѕ", done: invoice.status === "approved" },
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

  return (
    <div className="pageStack">
      <section className="heroCard invoiceHeroCompact">
        <Link className="secondaryButton compactButton invoicesBackLink" href="/invoices">
          <ArrowLeft size={16} strokeWidth={2} />
          РќР°Р·Р°Рґ Рє РЅР°РєР»Р°РґРЅС‹Рј
        </Link>

        <div className="invoiceDetailsHeader">
          <div>
            <p className="panelEyebrow">РќР°РєР»Р°РґРЅР°СЏ</p>
            <h2 className="pageTitle">РќР°РєР»Р°РґРЅР°СЏ</h2>
          </div>
          <div className="invoiceHeaderActions">
            <button type="button" className="primaryButton compactButton" onClick={() => void handleProcessAndParseInvoice()} disabled={isBusy || invoiceFiles.length === 0}>
              {isProcessing || isAiParsingItems || isDetectingPriceChanges ? "РћР±СЂР°Р±Р°С‚С‹РІР°РµРј..." : "Р Р°СЃРїРѕР·РЅР°С‚СЊ Рё СЂР°Р·РѕР±СЂР°С‚СЊ"}
            </button>
            <button type="button" className="secondaryButton compactButton" onClick={() => void handleDeleteInvoice()} disabled={isBusy || isDeletingInvoice}>
              {isDeletingInvoice ? "РЈРґР°Р»СЏРµРј..." : "РЈРґР°Р»РёС‚СЊ РЅР°РєР»Р°РґРЅСѓСЋ"}
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
            <span>РџРѕСЃС‚Р°РІС‰РёРє</span>
            <strong>{getSupplierName(invoice)}</strong>
          </div>
          <div className="supplierMetaItem">
            <span>РќРѕРјРµСЂ</span>
            <strong>{invoice.invoiceNumber || "вЂ”"}</strong>
          </div>
          <div className="supplierMetaItem">
            <span>РЎСѓРјРјР°</span>
            <strong>{formatMoney(invoice.totalAmount)}</strong>
          </div>
          <div className="supplierMetaItem">
            <span>Р¤Р°Р№Р»РѕРІ</span>
            <strong>{invoiceFiles.length}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="cardHeader">
          <div>
            <p className="panelEyebrow">Р¤Р°Р№Р»</p>
            <h2 className="sectionTitle">Р¤Р°Р№Р»С‹ РЅР°РєР»Р°РґРЅРѕР№</h2>
          </div>
          <button type="button" className="primaryButton compactButton" onClick={() => void handleProcessAndParseInvoice()} disabled={isBusy || invoiceFiles.length === 0}>
            {isProcessing || isAiParsingItems || isDetectingPriceChanges ? "РћР±СЂР°Р±Р°С‚С‹РІР°РµРј..." : "Р Р°СЃРїРѕР·РЅР°С‚СЊ Рё СЂР°Р·РѕР±СЂР°С‚СЊ"}
          </button>
        </div>

        {errorMessage ? <p className="errorText">{errorMessage}</p> : null}
        {errorMessage && (debugRawTextPreview || draftRawText.trim()) ? (
          <details className="invoiceDetailsPanel">
            <summary>РџРѕРєР°Р·Р°С‚СЊ СЂР°СЃРїРѕР·РЅР°РЅРЅС‹Р№ С‚РµРєСЃС‚</summary>
            <pre className="invoiceRawText">{debugRawTextPreview || draftRawText.slice(0, 4000)}</pre>
          </details>
        ) : null}
        {debugParseInfo ? (
          <details className="invoiceDetailsPanel">
            <summary>РџРѕРєР°Р·Р°С‚СЊ РґРµС‚Р°Р»Рё СЂР°Р·Р±РѕСЂР° С‚РѕРІР°СЂРѕРІ</summary>
            <div className="invoiceCompletionChecks">
              <span>AI РЅР°С€С‘Р» С‚Р°Р±Р»РёС†Сѓ: <strong>{debugParseInfo.tableDetected ? "РґР°" : "РЅРµС‚"}</strong></span>
              <span>РЎС‚СЂРѕРє С‚Р°Р±Р»РёС†С‹ РЅР°Р№РґРµРЅРѕ: <strong>{debugParseInfo.tableRowsCount ?? 0}</strong></span>
              <span>РЎС‚СЂРѕРє РґРѕ С„РёР»СЊС‚СЂР°: <strong>{debugParseInfo.itemsBeforeFilter ?? debugParseInfo.textParsedItemsCount ?? debugParseInfo.visionItemsCount ?? 0}</strong></span>
              <span>РўРѕРІР°СЂРѕРІ РїРѕСЃР»Рµ С„РёР»СЊС‚СЂР°: <strong>{debugParseInfo.filteredItemsCount ?? 0}</strong></span>
            </div>
            {debugParseInfo.rejectedItems?.length ? (
              <div className="invoiceItemSearchResults">
                {debugParseInfo.rejectedItems.slice(0, 50).map((item, index) => (
                  <div key={`${item.reason}-${index}`} className="invoiceItemSearchResult">
                    <strong>{item.name || "РџСѓСЃС‚Р°СЏ СЃС‚СЂРѕРєР°"}</strong>
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
            <p className="emptyStateTitle">Р¤Р°Р№Р»С‹ РЅРµ Р·Р°РіСЂСѓР¶РµРЅС‹</p>
            <p className="emptyStateText">Р”Р»СЏ СЌС‚РѕР№ РЅР°РєР»Р°РґРЅРѕР№ РїРѕРєР° РЅРµС‚ СЃРѕС…СЂР°РЅС‘РЅРЅС‹С… С„Р°Р№Р»РѕРІ.</p>
          </div>
        ) : (
          <div className="invoiceFilesGrid">
            {invoiceFiles.map((file) => {
              const currentFileKind = detectFileKind(file.fileUrl, file.originalFileName);
              const previewAlt = file.originalFileName || `РЎС‚СЂР°РЅРёС†Р° ${file.pageIndex + 1}`;

              return (
                <div key={file.id} className="invoiceFileTile">
                  <strong>РЎС‚СЂР°РЅРёС†Р° {file.pageIndex + 1}</strong>
                  {currentFileKind === "image" && file.fileUrl ? (
                    <>
                      <button type="button" className="invoicePreviewButton" onClick={() => openPreviewModal(file.id)}>
                        <div className="invoiceFilePreview">
                          <img src={file.fileUrl} alt={previewAlt} className="invoicePreviewImage" />
                        </div>
                      </button>
                      <a className="secondaryButton compactButton invoicesFileLink" href={file.fileUrl} target="_blank" rel="noreferrer">
                        <ExternalLink size={16} strokeWidth={2} />
                        РћС‚РєСЂС‹С‚СЊ РєСЂСѓРїРЅРѕ
                      </a>
                    </>
                  ) : (
                    <a className="secondaryButton compactButton invoicesFileLink" href={file.fileUrl || "#"} target="_blank" rel="noreferrer">
                      <ExternalLink size={16} strokeWidth={2} />
                      {currentFileKind === "pdf" ? "РћС‚РєСЂС‹С‚СЊ PDF" : "РћС‚РєСЂС‹С‚СЊ С„Р°Р№Р»"}
                    </a>
                  )}
                  <span>{file.originalFileName || "Р¤Р°Р№Р» Р±РµР· РёРјРµРЅРё"}</span>
                </div>
              );
            })}
          </div>
        )}

        {invoice.status === "failed" && !hasRawText ? (
          <p className="errorText">РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРѕС‡РёС‚Р°С‚СЊ С‚РµРєСЃС‚. РџРѕРїСЂРѕР±СѓР№С‚Рµ С„РѕС‚Рѕ С‡С‘С‚С‡Рµ РёР»Рё РІСЃС‚Р°РІСЊС‚Рµ С‚РµРєСЃС‚ РІСЂСѓС‡РЅСѓСЋ.</p>
        ) : hasRawText ? (
          <p className="successText">РўРµРєСЃС‚ РЅР°РєР»Р°РґРЅРѕР№ РµСЃС‚СЊ. РњРѕР¶РЅРѕ РїРµСЂРµС…РѕРґРёС‚СЊ Рє РїРѕСЃС‚Р°РІС‰РёРєСѓ Рё С‚РѕРІР°СЂР°Рј.</p>
        ) : (
          <p className="invoiceHint">РџРѕСЃР»Рµ СЂР°СЃРїРѕР·РЅР°РІР°РЅРёСЏ Р·РґРµСЃСЊ РїРѕСЏРІРёС‚СЃСЏ С‚РµРєСЃС‚ РґР»СЏ СЂР°Р·Р±РѕСЂР° С‚РѕРІР°СЂРѕРІ.</p>
        )}

        <details className="invoiceDetailsPanel">
          <summary>Р”РѕРїРѕР»РЅРёС‚РµР»СЊРЅС‹Рµ РґРµР№СЃС‚РІРёСЏ</summary>
          <div className="invoiceSupplierActions">
            <button type="button" className="secondaryButton compactButton" onClick={() => void handleProcessInvoice()} disabled={isBusy || invoiceFiles.length === 0}>
              {isProcessing ? "Р Р°СЃРїРѕР·РЅР°С‘Рј..." : "РўРѕР»СЊРєРѕ СЂР°СЃРїРѕР·РЅР°С‚СЊ"}
            </button>
            <button type="button" className="secondaryButton compactButton" onClick={() => void handleParseItems()} disabled={isBusy || !hasRawText}>
              {isParsingItems ? "Р Р°Р·Р±РёСЂР°РµРј..." : "Р Р°Р·РѕР±СЂР°С‚СЊ Р±РµР· AI"}
            </button>
            <button type="button" className="secondaryButton compactButton" onClick={() => void handleDetectPriceChanges()} disabled={isBusy || !hasItems}>
              {isDetectingPriceChanges ? "РС‰РµРј..." : "РќР°Р№С‚Рё РёР·РјРµРЅРµРЅРёСЏ С†РµРЅ"}
            </button>
          </div>
        </details>

        <details className="invoiceDetailsPanel">
          <summary>РџРѕРєР°Р·Р°С‚СЊ СЂР°СЃРїРѕР·РЅР°РЅРЅС‹Р№ С‚РµРєСЃС‚</summary>
          <div className="invoiceManualTextPanel">
            <textarea
              className="fieldTextarea"
              rows={10}
              value={draftRawText}
              onChange={(event) => setDraftRawText(event.target.value)}
              placeholder="Р’СЃС‚Р°РІСЊС‚Рµ С‚РµРєСЃС‚ РЅР°РєР»Р°РґРЅРѕР№ РІСЂСѓС‡РЅСѓСЋ"
              disabled={isBusy}
            />
            <div className="invoiceSupplierActions">
              <button type="button" className="primaryButton compactButton" onClick={() => void handleSaveRawText()} disabled={isBusy}>
                {isSavingRawText ? "РЎРѕС…СЂР°РЅСЏРµРј..." : "РЎРѕС…СЂР°РЅРёС‚СЊ С‚РµРєСЃС‚"}
              </button>
              <button
                type="button"
                className="secondaryButton compactButton"
                onClick={() => setDraftRawText(invoice.rawText ?? "")}
                disabled={isBusy}
              >
                Р’РµСЂРЅСѓС‚СЊ С‚РµРєСЃС‚
              </button>
            </div>
          </div>
        </details>
      </section>

      <section className="card">
        <div className="cardHeader">
          <div>
            <p className="panelEyebrow">РЁР°Рі 2</p>
            <h2 className="sectionTitle">РџРѕСЃС‚Р°РІС‰РёРє</h2>
          </div>
          <div className="invoiceSupplierActions">
            <button type="button" className="secondaryButton compactButton" onClick={handleOpenSupplierSearch} disabled={isBusy}>
              {invoice.supplierId ? "РР·РјРµРЅРёС‚СЊ" : "Р’С‹Р±СЂР°С‚СЊ РїРѕСЃС‚Р°РІС‰РёРєР°"}
            </button>
            {invoice.supplierId ? (
              <button type="button" className="secondaryButton compactButton" onClick={() => void handleSelectSupplier(null)} disabled={isBusy}>
                РЎР±СЂРѕСЃРёС‚СЊ
              </button>
            ) : null}
          </div>
        </div>

        <div className="invoiceStepSummary">
          <FileText size={20} strokeWidth={2} />
          <div>
            <strong>{invoice.supplierId ? getSupplierName(invoice) : "РџРѕСЃС‚Р°РІС‰РёРє РЅРµ РЅР°Р№РґРµРЅ"}</strong>
            <p>{invoice.supplierId ? "РџРѕСЃС‚Р°РІС‰РёРє РІС‹Р±СЂР°РЅ РґР»СЏ СЌС‚РѕР№ РЅР°РєР»Р°РґРЅРѕР№." : "Р’С‹Р±РµСЂРёС‚Рµ РїРѕСЃС‚Р°РІС‰РёРєР°, С‡С‚РѕР±С‹ РїРѕРёСЃРє С‚РѕРІР°СЂРѕРІ Р±С‹Р» С‚РѕС‡РЅРµРµ."}</p>
          </div>
        </div>

        {!invoice.supplierId && invoice.detectedSupplierName ? (
          <div className="invoiceSupplierActions">
            <p className="invoiceHint">
              AI нашёл поставщика: <strong>{invoice.detectedSupplierName}</strong>
            </p>
            <button type="button" className="secondaryButton compactButton" onClick={handleOpenSupplierSearch} disabled={isBusy}>
              Связать с существующим поставщиком
            </button>
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="cardHeader">
          <div>
            <p className="panelEyebrow">РЁР°Рі 3</p>
            <h2 className="sectionTitle">РўРѕРІР°СЂС‹</h2>
          </div>
        </div>

        {hasItems ? (
          <div className="invoiceItemEditActions">
            <span className="invoiceHint">Р’С‹Р±СЂР°РЅРѕ СЃС‚СЂРѕРє: {selectedItemIds.length}</span>
            <button
              type="button"
              className="secondaryButton compactButton"
              onClick={() => void handleBulkDeleteItems()}
              disabled={isBusy || selectedItemIds.length === 0}
            >
              {isBulkDeletingItems ? "РЈРґР°Р»СЏРµРј..." : "РЈРґР°Р»РёС‚СЊ РІС‹Р±СЂР°РЅРЅС‹Рµ"}
            </button>
          </div>
        ) : null}

        {!hasRawText ? <p className="invoiceHint">РЎРЅР°С‡Р°Р»Р° СЂР°СЃРїРѕР·РЅР°Р№С‚Рµ РЅР°РєР»Р°РґРЅСѓСЋ РёР»Рё РІСЃС‚Р°РІСЊС‚Рµ С‚РµРєСЃС‚ РІСЂСѓС‡РЅСѓСЋ.</p> : null}

        {invoice.items.length === 0 ? (
          <div className="emptyState">
            <p className="emptyStateTitle">РўРѕРІР°СЂС‹ РµС‰С‘ РЅРµ СЂР°Р·РѕР±СЂР°РЅС‹</p>
            <p className="emptyStateText">РџРѕСЃР»Рµ СЂР°Р·Р±РѕСЂР° Р·РґРµСЃСЊ РїРѕСЏРІСЏС‚СЃСЏ СЃС‚СЂРѕРєРё РЅР°РєР»Р°РґРЅРѕР№.</p>
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
                      aria-label="Р’С‹Р±СЂР°С‚СЊ РІСЃРµ СЃС‚СЂРѕРєРё"
                    />
                  </th>
                  <th>РўРѕРІР°СЂ</th>
                  <th>РљРѕР»-РІРѕ</th>
                  <th>Р¦РµРЅР°</th>
                  <th>РЎСѓРјРјР°</th>
                  <th>РР·РјРµРЅРµРЅРёРµ</th>
                  <th>РЎС‚Р°С‚СѓСЃ</th>
                  <th>Р”РµР№СЃС‚РІРёСЏ</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item) => {
                  const priceChange = priceChangesByItemId.get(item.id) ?? null;
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
                  const itemStatus = getInvoiceItemStatus(item, priceChange);
                  const lineTotal = getCalculatedLineTotal(item);

                  return (
                    <Fragment key={item.id}>
                      <tr className={item.matchedProductStatus === "new" ? "invoiceItemRowNew" : undefined}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedItemIds.includes(item.id)}
                            onChange={() => handleToggleItemSelection(item.id)}
                            disabled={isBusy}
                            aria-label="Р’С‹Р±СЂР°С‚СЊ СЃС‚СЂРѕРєСѓ"
                          />
                        </td>
                        <td>
                          <div className={`invoiceProductCell ${item.matchedProductStatus === "new" ? "invoiceProductCellNew" : ""}`}>
                            <strong>{item.productNameRaw}</strong>
                            <span>{getMatchedProductLabel(item)}</span>
                            {item.matchedProductStatus === "new" ? <span className="invoiceProductWarning">РўР°РєРѕРіРѕ С‚РѕРІР°СЂР° РЅРµС‚ РІ РїСЂР°Р№СЃРµ</span> : null}
                          </div>
                        </td>
                        <td>
                          <strong>{formatNumber(item.quantity)}</strong>
                          <span>{item.unit || "вЂ”"}</span>
                        </td>
                        <td>
                          <strong>{formatMoney(newPrice)}</strong>
                          <span>{oldPrice ? `Р‘С‹Р»Рѕ: ${formatMoney(oldPrice)}` : "вЂ”"}</span>
                          {item.priceComparisonNote ? <span>{item.priceComparisonNote}</span> : null}
                        </td>
                        <td>
                          <strong>{formatMoney(lineTotal)}</strong>
                          {!item.lineTotal && lineTotal ? <span>Р Р°СЃС‡С‘С‚РЅР°СЏ СЃСѓРјРјР°</span> : null}
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
                                  Выбрать
                                </button>
                                {item.matchedProductStatus === "new" ? (
                                  <button
                                    type="button"
                                    className="secondaryButton compactButton"
                                    onClick={() => void handleCreateProduct(item)}
                                    disabled={isBusy}
                                    title={invoice.supplierId ? undefined : "РЎРЅР°С‡Р°Р»Р° РІС‹Р±РµСЂРёС‚Рµ РїРѕСЃС‚Р°РІС‰РёРєР°"}
                                  >
                                    {creatingProductItemId === item.id ? "РЎРѕР·РґР°С‘Рј..." : "РЎРѕР·РґР°С‚СЊ С‚РѕРІР°СЂ"}
                                  </button>
                                ) : null}
                              </>
                            ) : (
                              <button
                                type="button"
                                className="secondaryButton compactButton"
                                onClick={() => handleOpenProductSearch(item)}
                                disabled={isBusy}
                              >
                                Изменить
                              </button>
                            )}

                            {priceChange?.status === "pending" ? (
                              <>
                                <button
                                  type="button"
                                  className="primaryButton compactButton"
                                  onClick={() => void handleUpdatePriceChange(priceChange.id, "approve")}
                                  disabled={isBusy}
                                >
                                  {updatingPriceChangeId === priceChange.id ? "РЎРѕС…СЂР°РЅСЏРµРј..." : "РџРѕРґС‚РІРµСЂРґРёС‚СЊ С†РµРЅСѓ"}
                                </button>
                                <button
                                  type="button"
                                  className="secondaryButton compactButton"
                                  onClick={() => void handleUpdatePriceChange(priceChange.id, "reject")}
                                  disabled={isBusy}
                                >
                                  {updatingPriceChangeId === priceChange.id ? "РЎРѕС…СЂР°РЅСЏРµРј..." : "РћС‚РєР»РѕРЅРёС‚СЊ С†РµРЅСѓ"}
                                </button>
                              </>
                            ) : null}

                            <button
                              type="button"
                              className="secondaryButton compactButton"
                              onClick={() => handleOpenItemEdit(item)}
                              disabled={isBusy}
                            >
                              Р РµРґР°РєС‚РёСЂРѕРІР°С‚СЊ
                            </button>
                            <button
                              type="button"
                              className="secondaryButton compactButton"
                              onClick={() => void handleDeleteItem(item.id)}
                              disabled={isBusy}
                            >
                              {deletingItemId === item.id ? "РЈРґР°Р»СЏРµРј..." : "РЈРґР°Р»РёС‚СЊ"}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {editingItemId === item.id && editItemDraft ? (
                        <tr className="invoiceItemSearchRow">
                          <td colSpan={8}>
                            <div className="invoiceItemSearchPanel invoiceItemEditPanel">
                              <div className="invoiceItemEditGrid">
                                <label className="field">
                                  <span>РќР°Р·РІР°РЅРёРµ</span>
                                  <input
                                    type="text"
                                    value={editItemDraft.productNameRaw}
                                    onChange={(event) => handleChangeItemDraft("productNameRaw", event.target.value)}
                                    disabled={isBusy}
                                  />
                                </label>
                                <label className="field">
                                  <span>РљРѕР»РёС‡РµСЃС‚РІРѕ</span>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={editItemDraft.quantity}
                                    onChange={(event) => handleChangeItemDraft("quantity", event.target.value)}
                                    disabled={isBusy}
                                  />
                                </label>
                                <label className="field">
                                  <span>Р•РґРёРЅРёС†Р°</span>
                                  <input
                                    type="text"
                                    value={editItemDraft.unit}
                                    onChange={(event) => handleChangeItemDraft("unit", event.target.value)}
                                    disabled={isBusy}
                                  />
                                </label>
                                <label className="field">
                                  <span>Р¦РµРЅР°</span>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={editItemDraft.priceWithVat}
                                    onChange={(event) => handleChangeItemDraft("priceWithVat", event.target.value)}
                                    disabled={isBusy}
                                  />
                                </label>
                                <label className="field">
                                  <span>РЎСѓРјРјР°</span>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={editItemDraft.lineTotal}
                                    onChange={(event) => handleChangeItemDraft("lineTotal", event.target.value)}
                                    disabled={isBusy}
                                  />
                                </label>
                                <label className="field">
                                  <span>РќР”РЎ %</span>
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
                                  {isSavingItemEdit ? "РЎРѕС…СЂР°РЅСЏРµРј..." : "РЎРѕС…СЂР°РЅРёС‚СЊ"}
                                </button>
                                <button
                                  type="button"
                                  className="secondaryButton compactButton"
                                  onClick={handleCloseItemEdit}
                                  disabled={isBusy}
                                >
                                  РћС‚РјРµРЅР°
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
              <p className="panelEyebrow">РЁР°Рі 4</p>
              <h2 className="sectionTitle">РР·РјРµРЅРµРЅРёСЏ С†РµРЅ</h2>
            </div>
          </div>

          {invoice.priceChanges.length === 0 ? (
            <p className="invoiceHint">РР·РјРµРЅРµРЅРёР№ С†РµРЅ РїРѕРєР° РЅРµС‚.</p>
          ) : (
            <div className="orderItemsTableWrap">
              <table className="orderItemsTable">
                <thead>
                  <tr>
                    <th>РўРѕРІР°СЂ</th>
                    <th>РЎС‚Р°СЂР°СЏ С†РµРЅР°</th>
                    <th>РќРѕРІР°СЏ С†РµРЅР°</th>
                    <th>Р Р°Р·РЅРёС†Р°</th>
                    <th>РЎС‚Р°С‚СѓСЃ</th>
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

      <section className="card">
        <div className="cardHeader">
          <div>
            <p className="panelEyebrow">РЁР°Рі 5</p>
            <h2 className="sectionTitle">Р—Р°РІРµСЂС€РµРЅРёРµ</h2>
          </div>
          <button type="button" className="primaryButton compactButton" onClick={() => void handleApproveInvoice()} disabled={isBusy}>
            {isApprovingInvoice ? "Р—Р°РІРµСЂС€Р°РµРј..." : "Р—Р°РІРµСЂС€РёС‚СЊ РЅР°РєР»Р°РґРЅСѓСЋ"}
          </button>
        </div>

        <div className="invoiceCompletionChecks">
          <span>РЎС‚СЂРѕРє РЅР° РїСЂРѕРІРµСЂРєРµ: <strong>{reviewItemsCount}</strong></span>
          <span>РР·РјРµРЅРµРЅРёР№ С†РµРЅ РЅР° РїСЂРѕРІРµСЂРєРµ: <strong>{pendingPriceChangesCount}</strong></span>
        </div>
        {(reviewItemsCount > 0 || pendingPriceChangesCount > 0) && invoice.status !== "approved" ? (
          <p className="invoiceHint">РЎРЅР°С‡Р°Р»Р° РїСЂРѕРІРµСЂСЊС‚Рµ СЃС‚СЂРѕРєРё Рё РёР·РјРµРЅРµРЅРёСЏ С†РµРЅ.</p>
        ) : null}
      </section>

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
                  <button
                    type="button"
                    className="secondaryButton compactButton"
                    onClick={() => void handleCreateProduct(productSearchItem)}
                    disabled={isBusy || !invoice.supplierId}
                    title={invoice.supplierId ? undefined : "Сначала выберите поставщика"}
                  >
                    {creatingProductItemId === productSearchItem.id ? "Создаём..." : "Создать новый товар"}
                  </button>
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
                <h2 className="sectionTitle">Связать с существующим поставщиком</h2>
                {invoice?.detectedSupplierName ? <p className="pageDescription">AI нашёл: {invoice.detectedSupplierName}</p> : null}
              </div>
              <button type="button" className="secondaryButton compactButton" onClick={handleCloseSupplierSearch} disabled={isBusy}>
                Закрыть
              </button>
            </div>

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
            aria-label="РџСЂРѕСЃРјРѕС‚СЂ РЅР°РєР»Р°РґРЅРѕР№"
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


