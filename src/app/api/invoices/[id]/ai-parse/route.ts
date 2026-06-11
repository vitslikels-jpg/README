import { parseInvoiceWithGemini } from "@/lib/invoice-gemini-parser";
import { Prisma } from "@prisma/client";
import {
  InvoiceVisionUnsupportedError,
  parseInvoiceWithGeminiVision,
  type InvoiceVisionInputFile,
} from "@/lib/invoice-gemini-vision-parser";
import { jsonUtf8 } from "@/lib/http";
import { filterInvoiceItems } from "@/lib/invoice-item-filter";
import { parseInvoiceItemsFromText } from "@/lib/invoice-item-parser";
import { normalizeInvoiceLinePrices } from "@/lib/invoice-line-price-normalizer";
import { sanitizeMoney, sanitizeQuantity, sanitizeVatRate } from "@/lib/invoice-number-sanitize";
import { matchInvoiceProduct } from "@/lib/invoice-product-match";
import { matchInvoiceSupplier } from "@/lib/invoice-supplier-match";
import { deriveVatFields } from "@/lib/invoice-vat";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type ParsedItemDraft = {
  name: string | null;
  quantity: number | null;
  unit: string | null;
  priceWithVat: number | null;
  priceWithoutVat: number | null;
  vatRate: number | null;
  lineTotal: number | null;
  confidence: number | null;
  needsReview: boolean;
  forcedReview?: boolean;
};

function parseDate(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function needsItemReview(item: {
  quantity: number | null;
  unit: string | null;
  priceWithVat: number | null;
}) {
  return item.quantity === null || !item.unit || item.priceWithVat === null;
}

function countStructuredItems(items: Array<{
  quantity: number | null;
  unit: string | null;
  priceWithVat: number | null;
}>) {
  return items.filter((item) => !needsItemReview(item)).length;
}

function looksLikePoorOcrText(rawText: string) {
  const letters = rawText.match(/\p{L}/gu) ?? [];

  if (letters.length < 40) {
    return true;
  }

  const cyrillicLetters = rawText.match(/\p{Script=Cyrillic}/gu) ?? [];
  const latinLetters = rawText.match(/\p{Script=Latin}/gu) ?? [];
  const cyrillicRatio = cyrillicLetters.length / letters.length;
  const latinRatio = latinLetters.length / letters.length;

  return cyrillicRatio < 0.45 || latinRatio > 0.35;
}

function buildRawTextPreview(rawText: string) {
  return rawText.replace(/\s+/g, " ").trim().slice(0, 1000);
}

function buildRowsPreview(rows: string[]) {
  return rows.join("\n").slice(0, 1000);
}

async function clearInvoiceParsedData(invoiceId: string) {
  await prisma.$transaction([
    prisma.invoicePriceChange.deleteMany({
      where: {
        invoiceDocumentId: invoiceId,
      },
    }),
    prisma.invoiceItem.deleteMany({
      where: {
        invoiceDocumentId: invoiceId,
      },
    }),
  ]);
}

function sanitizeParsedItem(item: {
  supplierName?: string | null;
  name: string | null;
  quantity: number | null;
  unit: string | null;
  priceWithVat: number | null;
  priceWithoutVat: number | null;
  vatRate: number | null;
  lineTotal: number | null;
}) {
  const sanitizedQuantity = sanitizeQuantity(item.quantity);
  const sanitizedPriceWithoutVat = sanitizeMoney(item.priceWithoutVat);
  const sanitizedPriceWithVat = sanitizeMoney(item.priceWithVat);
  const sanitizedVatRate = sanitizeVatRate(item.vatRate);
  const sanitizedLineTotal = sanitizeMoney(item.lineTotal);
  const forcedReview =
    sanitizedQuantity.forcedReview ||
    sanitizedPriceWithoutVat.forcedReview ||
    sanitizedPriceWithVat.forcedReview ||
    sanitizedVatRate.forcedReview ||
    sanitizedLineTotal.forcedReview;

  const sanitizedItem = {
    ...item,
    quantity: sanitizedQuantity.value?.toNumber() ?? null,
    priceWithoutVat: sanitizedPriceWithoutVat.value?.toNumber() ?? null,
    priceWithVat: sanitizedPriceWithVat.value?.toNumber() ?? null,
    vatRate: sanitizedVatRate.value?.toNumber() ?? null,
    lineTotal: sanitizedLineTotal.value?.toNumber() ?? null,
  };

  const normalizedLinePrices = normalizeInvoiceLinePrices({
    supplierName: item.supplierName,
    quantity: sanitizedItem.quantity,
    priceWithoutVat: sanitizedItem.priceWithoutVat,
    priceWithVat: sanitizedItem.priceWithVat,
    vatRate: sanitizedItem.vatRate,
    lineTotal: sanitizedItem.lineTotal,
  });

  const derivedVatFields = deriveVatFields({
    priceWithoutVat: normalizedLinePrices.priceWithoutVat,
    priceWithVat: normalizedLinePrices.priceWithVat,
    vatRate: normalizedLinePrices.vatRate,
  });

  return {
    ...sanitizedItem,
    priceWithoutVat: derivedVatFields.priceWithoutVat,
    priceWithVat: derivedVatFields.priceWithVat,
    vatRate: normalizedLinePrices.vatRate,
    forcedReview,
  };
}

function buildDraftItems(
  items: Array<{
    name: string | null;
    quantity: number | null;
    unit: string | null;
    priceWithVat: number | null;
    priceWithoutVat: number | null;
    vatRate: number | null;
    lineTotal: number | null;
  }>,
  baseConfidenceWhenReview: number,
  baseConfidenceWhenReady: number,
  supplierName?: string | null,
) {
  return items.map((item) => {
    const sanitizedItem = sanitizeParsedItem({
      ...item,
      supplierName,
    });
    const needsReview = sanitizedItem.forcedReview || needsItemReview(sanitizedItem);

    return {
      ...sanitizedItem,
      confidence: sanitizedItem.forcedReview ? 0.5 : needsReview ? baseConfidenceWhenReview : baseConfidenceWhenReady,
      needsReview,
    } satisfies ParsedItemDraft;
  });
}

function buildFallbackDraftItems(tableRows: string[], supplierName?: string | null) {
  const fallbackItems = parseInvoiceItemsFromText(tableRows.join("\n"));

  return {
    fallbackItemsCount: fallbackItems.length,
    items: fallbackItems.map((item) => {
      const sanitizedQuantity = sanitizeQuantity(item.quantity);
      const sanitizedPriceWithVat = sanitizeMoney(item.priceWithVat);
      const sanitizedLineTotal = sanitizeMoney(item.lineTotal);
      const forcedReview =
        sanitizedQuantity.forcedReview || sanitizedPriceWithVat.forcedReview || sanitizedLineTotal.forcedReview;

      const normalizedLinePrices = normalizeInvoiceLinePrices({
        supplierName,
        quantity: sanitizedQuantity.value?.toNumber() ?? null,
        priceWithoutVat: null,
        priceWithVat: sanitizedPriceWithVat.value?.toNumber() ?? null,
        vatRate: null,
        lineTotal: sanitizedLineTotal.value?.toNumber() ?? null,
      });

      return {
        name: item.productNameRaw,
        quantity: sanitizedQuantity.value?.toNumber() ?? null,
        unit: item.unit,
        priceWithVat: normalizedLinePrices.priceWithVat,
        priceWithoutVat: normalizedLinePrices.priceWithoutVat,
        vatRate: normalizedLinePrices.vatRate,
        lineTotal: normalizedLinePrices.lineTotal,
        forcedReview,
        confidence: forcedReview ? 0.5 : item.confidence,
        needsReview: true,
      } satisfies ParsedItemDraft;
    }),
  };
}

async function createInvoiceItems(params: {
  invoiceId: string;
  enterpriseId: string;
  supplierId: string | null;
  supplierName?: string | null;
  items: ParsedItemDraft[];
}) {
  const { invoiceId, enterpriseId, supplierId, supplierName, items } = params;
  const createdItemsCount = items.length;
  let reviewItemsCount = 0;
  let matchedItemsCount = 0;

  await prisma.$transaction(async (tx) => {
    await tx.invoicePriceChange.deleteMany({
      where: {
        invoiceDocumentId: invoiceId,
      },
    });

    await tx.invoiceItem.deleteMany({
      where: {
        invoiceDocumentId: invoiceId,
      },
    });

    for (const [itemIndex, item] of items.entries()) {
      const sanitizedQuantity = sanitizeQuantity(item.quantity);
      const sanitizedPriceWithoutVat = sanitizeMoney(item.priceWithoutVat);
      const sanitizedPriceWithVat = sanitizeMoney(item.priceWithVat);
      const sanitizedVatRate = sanitizeVatRate(item.vatRate);
      const sanitizedLineTotal = sanitizeMoney(item.lineTotal);
      const forcedReview =
        sanitizedQuantity.forcedReview ||
        sanitizedPriceWithoutVat.forcedReview ||
        sanitizedPriceWithVat.forcedReview ||
        sanitizedVatRate.forcedReview ||
        sanitizedLineTotal.forcedReview ||
        item.forcedReview;

      const payload = {
        invoiceDocumentId: invoiceId,
        productNameRaw: item.name ?? "",
        matchedProductId: null as string | null,
        quantity: sanitizedQuantity.value,
        unit: item.unit,
        ...(() => {
          const normalizedLinePrices = normalizeInvoiceLinePrices({
            supplierName,
            quantity: sanitizedQuantity.value?.toNumber() ?? null,
            priceWithoutVat: sanitizedPriceWithoutVat.value?.toNumber() ?? null,
            priceWithVat: sanitizedPriceWithVat.value?.toNumber() ?? null,
            vatRate: sanitizedVatRate.value?.toNumber() ?? null,
            lineTotal: sanitizedLineTotal.value?.toNumber() ?? null,
          });
          const derivedVatFields = deriveVatFields({
            priceWithoutVat: normalizedLinePrices.priceWithoutVat,
            priceWithVat: normalizedLinePrices.priceWithVat,
            vatRate: normalizedLinePrices.vatRate,
          });

          return {
            priceWithoutVat: derivedVatFields.priceWithoutVat === null ? null : new Prisma.Decimal(derivedVatFields.priceWithoutVat),
            priceWithVat: derivedVatFields.priceWithVat === null ? null : new Prisma.Decimal(derivedVatFields.priceWithVat),
          };
        })(),
        vatRate: sanitizedVatRate.value,
        lineTotal: sanitizedLineTotal.value,
        confidence: forcedReview ? Math.min(item.confidence ?? 0.5, 0.5) : item.confidence,
        needsReview: forcedReview || item.needsReview,
      };

      const productMatch = await matchInvoiceProduct({
        enterpriseId,
        supplierId,
        productNameRaw: payload.productNameRaw,
      });
      const hasStructuredFields = payload.quantity !== null && Boolean(payload.unit) && payload.priceWithVat !== null;

      if (productMatch.status === "matched" && productMatch.matchedProductId) {
        payload.matchedProductId = productMatch.matchedProductId;
        payload.confidence = forcedReview
          ? Math.min(payload.confidence ?? 0.5, 0.5)
          : Math.max(payload.confidence ?? 0, productMatch.confidence ?? 0.9);
        payload.needsReview = forcedReview || !hasStructuredFields;
        matchedItemsCount += 1;
      } else if (productMatch.status === "ambiguous") {
        payload.confidence = Math.min(payload.confidence ?? 0.5, 0.5);
        payload.needsReview = true;
      }

      if (payload.needsReview) {
        reviewItemsCount += 1;
      }

      try {
        await tx.invoiceItem.create({
          data: payload,
        });
      } catch (error) {
        console.error("[invoice-ai-parse:create-failed]", {
          invoiceId,
          itemIndex,
          payload: {
            ...payload,
            quantity: payload.quantity?.toString() ?? null,
            priceWithoutVat: payload.priceWithoutVat?.toString() ?? null,
            priceWithVat: payload.priceWithVat?.toString() ?? null,
            vatRate: payload.vatRate?.toString() ?? null,
            lineTotal: payload.lineTotal?.toString() ?? null,
          },
          message: error instanceof Error ? error.message : "Unknown error",
        });
        throw error;
      }
    }
  });

  return {
    createdItemsCount,
    reviewItemsCount,
    matchedItemsCount,
  };
}

async function updateInvoiceMetadata(invoiceId: string, data: {
  supplierId?: string | null;
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  totalAmount: number | null;
  vatAmount: number | null;
  status: "needs_review" | "parsed" | "failed" | "processing";
  confidence?: number | null;
}) {
  await prisma.invoiceDocument.update({
    where: {
      id: invoiceId,
    },
    data: {
      ...(data.supplierId !== undefined ? { supplierId: data.supplierId } : {}),
      detectedSupplierName: data.supplierName,
      ...(data.confidence !== undefined ? { confidence: data.confidence } : {}),
      invoiceNumber: data.invoiceNumber,
      invoiceDate: parseDate(data.invoiceDate),
      totalAmount: data.totalAmount,
      vatAmount: data.vatAmount,
      status: data.status,
    },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  const invoice = await prisma.invoiceDocument.findFirst({
    where: {
      id,
      enterpriseId,
    },
    select: {
      id: true,
      rawText: true,
      supplierId: true,
      files: {
        select: {
          fileUrl: true,
          storageKey: true,
          originalFileName: true,
          mimeType: true,
          pageIndex: true,
        },
        orderBy: {
          pageIndex: "asc",
        },
      },
    },
  });

  if (!invoice) {
    return jsonUtf8({ message: "Накладная не найдена." }, { status: 404 });
  }

  const rawText = invoice.rawText?.trim() ?? "";
  const invoiceFiles = invoice.files as InvoiceVisionInputFile[];
  const poorOcrText = rawText ? looksLikePoorOcrText(rawText) : false;

  console.info("[invoice-ai-parse:start]", {
    invoiceId: id,
    rawTextLength: rawText.length,
    poorOcrText,
  });

  await prisma.invoiceDocument.update({
    where: {
      id,
    },
    data: {
      status: "processing",
    },
  });

  try {
    let textTableDetected = false;
    let tableRowsCount = 0;
    let textParsedItemsCount = 0;
    let visionAttempted = false;
    let visionItemsCount = 0;
    let fallbackUsed = false;
    let visionUsed = false;
    let itemsBeforeFilter = 0;
    let rejectedItems: Array<{ name: string; reason: string }> = [];
    let columns: Record<string, string | null> | undefined;

    let metadata = {
      supplierName: null as string | null,
      invoiceNumber: null as string | null,
      invoiceDate: null as string | null,
      totalAmount: null as number | null,
      vatAmount: null as number | null,
    };

    let parsedItems: ParsedItemDraft[] = [];
    let rawTextPreview = rawText ? buildRawTextPreview(rawText) : "";
    let resolvedSupplierId = invoice.supplierId;
    let resolvedSupplierConfidence: number | null | undefined = undefined;
    let resolvedSupplierMatchType: string | null = null;

    if (rawText) {
      const parsedInvoice = await parseInvoiceWithGemini(rawText);
      const { structure, tableRows } = parsedInvoice;

      textTableDetected = structure.tableDetected;
      tableRowsCount = tableRows.length;
      columns = structure.columns;
      metadata = {
        supplierName: structure.supplierName,
        invoiceNumber: structure.invoiceNumber,
        invoiceDate: structure.invoiceDate,
        totalAmount: structure.totalAmount,
        vatAmount: structure.vatAmount,
      };

      console.info("[invoice-ai-parse:text-structure]", {
        invoiceId: id,
        rawTextLength: rawText.length,
        tableDetected: textTableDetected,
        tableRowsCount,
        textParsedItemsCount: parsedInvoice.items.length,
        visionAttempted,
        visionItemsCount,
      });

      if (textTableDetected && tableRows.length > 0) {
        parsedItems = buildDraftItems(parsedInvoice.items, 0.65, 0.85, structure.supplierName);
        textParsedItemsCount = parsedItems.length;
        rawTextPreview = buildRowsPreview(tableRows);

        if (parsedItems.length === 0) {
          const fallbackResult = buildFallbackDraftItems(tableRows, structure.supplierName);
          parsedItems = fallbackResult.items;
          textParsedItemsCount = parsedItems.length;
          fallbackUsed = fallbackResult.items.length > 0;

          console.info("[invoice-ai-parse:fallback]", {
            invoiceId: id,
            rawTextLength: rawText.length,
            tableDetected: textTableDetected,
            tableRowsCount,
            textParsedItemsCount,
            visionAttempted,
            visionItemsCount,
            fallbackItemsCount: fallbackResult.fallbackItemsCount,
          });
        }
      }
    }

    const shouldAttemptVision =
      invoiceFiles.length > 0 && (tableRowsCount === 0 || textParsedItemsCount === 0 || poorOcrText);

    if (shouldAttemptVision) {
      visionAttempted = true;

      try {
        const visionResult = await parseInvoiceWithGeminiVision(invoiceFiles, rawText || null);
        visionItemsCount = visionResult.items.length;

        console.info("[invoice-ai-parse:vision]", {
          invoiceId: id,
          rawTextLength: rawText.length,
          tableDetected: textTableDetected,
          tableRowsCount,
          textParsedItemsCount,
          visionAttempted,
          visionItemsCount,
        });

        if (visionItemsCount > 0) {
          const visionDraftItems = buildDraftItems(visionResult.items, 0.7, 0.9, visionResult.supplierName ?? metadata.supplierName);
          const shouldPreferVision =
            parsedItems.length === 0 ||
            (poorOcrText && countStructuredItems(visionDraftItems) > 0) ||
            countStructuredItems(visionDraftItems) > countStructuredItems(parsedItems);

          if (shouldPreferVision) {
            parsedItems = visionDraftItems;
            visionUsed = true;
            fallbackUsed = false;
            metadata = {
              supplierName: visionResult.supplierName ?? metadata.supplierName,
              invoiceNumber: visionResult.invoiceNumber ?? metadata.invoiceNumber,
              invoiceDate: visionResult.invoiceDate ?? metadata.invoiceDate,
              totalAmount: visionResult.totalAmount ?? metadata.totalAmount,
              vatAmount: visionResult.vatAmount ?? metadata.vatAmount,
            };
          }
        }
      } catch (error) {
        if (error instanceof InvoiceVisionUnsupportedError) {
          await clearInvoiceParsedData(id);
          await updateInvoiceMetadata(id, {
            ...metadata,
            status: "needs_review",
          });

          console.info("[invoice-ai-parse:vision-unsupported]", {
            invoiceId: id,
            rawTextLength: rawText.length,
            tableDetected: textTableDetected,
            tableRowsCount,
            textParsedItemsCount,
            visionAttempted,
            visionItemsCount,
          });

          return jsonUtf8(
            {
              message: "Текущий AI-провайдер не поддерживает разбор изображения напрямую",
              rawTextPreview,
              tableDetected: textTableDetected,
              tableRowsCount,
              textParsedItemsCount,
              visionAttempted,
              visionItemsCount,
              columns,
            },
            { status: 400 },
          );
        }

        throw error;
      }
    }

    if (!invoice.supplierId && metadata.supplierName) {
      const supplierMatch =
        (await matchInvoiceSupplier(metadata.supplierName, enterpriseId).catch(() => null)) ??
        (rawText ? await matchInvoiceSupplier(rawText, enterpriseId).catch(() => null) : null);

      if (supplierMatch) {
        resolvedSupplierId = supplierMatch.supplierId;
        resolvedSupplierConfidence = supplierMatch.confidence;
        resolvedSupplierMatchType = supplierMatch.matchType;
      }
    }

    itemsBeforeFilter = parsedItems.length;
    const filterResult = filterInvoiceItems(parsedItems);
    parsedItems = filterResult.accepted;
    rejectedItems = filterResult.rejected;

    console.info("[invoice-ai-parse:filter]", {
      invoiceId: id,
      rawTextLength: rawText.length,
      tableDetected: textTableDetected,
      tableRowsCount,
      textParsedItemsCount,
      visionAttempted,
      visionItemsCount,
      itemsBeforeFilter,
      filteredItemsCount: parsedItems.length,
      rejectedItemsCount: rejectedItems.length,
    });

    if (parsedItems.length === 0) {
      await clearInvoiceParsedData(id);
      await updateInvoiceMetadata(id, {
        ...metadata,
        status: "needs_review",
      });

      console.info("[invoice-ai-parse:empty]", {
        invoiceId: id,
        rawTextLength: rawText.length,
        tableDetected: textTableDetected,
        tableRowsCount,
        textParsedItemsCount,
        visionAttempted,
        visionItemsCount,
        itemsBeforeFilter,
        filteredItemsCount: 0,
        rejectedItemsCount: rejectedItems.length,
      });

      return jsonUtf8(
        {
          message: "???????? ?????? ?? ???????. ?????????? ????? ?????? ???? ??? ??????? ?????? ???????.",
          rawTextPreview,
          tableDetected: textTableDetected,
          tableRowsCount,
          textParsedItemsCount,
          visionAttempted,
          visionItemsCount,
          itemsBeforeFilter,
          filteredItemsCount: 0,
          rejectedItems,
          columns,
        },
        { status: 400 },
      );
    }

    const { createdItemsCount, reviewItemsCount, matchedItemsCount } = await createInvoiceItems({
      invoiceId: id,
      enterpriseId,
      supplierId: resolvedSupplierId,
      supplierName: metadata.supplierName,
      items: parsedItems,
    });

    console.info("[invoice-ai-parse:created]", {
      invoiceId: id,
      rawTextLength: rawText.length,
      tableDetected: textTableDetected,
      tableRowsCount,
      textParsedItemsCount,
      visionAttempted,
      visionItemsCount,
      itemsBeforeFilter,
      filteredItemsCount: createdItemsCount,
      rejectedItemsCount: rejectedItems.length,
      createdItemsCount,
      reviewItemsCount,
      matchedItemsCount,
    });

    await updateInvoiceMetadata(id, {
      ...(invoice.supplierId ? {} : { supplierId: resolvedSupplierId }),
      ...metadata,
      confidence: resolvedSupplierConfidence,
      status: createdItemsCount === 0 || reviewItemsCount > 0 ? "needs_review" : "parsed",
    });

    return jsonUtf8({
      invoiceId: id,
      createdItemsCount,
      reviewItemsCount,
      matchedItemsCount,
      fallbackUsed,
      visionUsed,
      tableDetected: textTableDetected,
      tableRowsCount,
      textParsedItemsCount,
      visionAttempted,
      visionItemsCount,
      itemsBeforeFilter,
      filteredItemsCount: createdItemsCount,
      rejectedItems,
      columns,
      supplierMatchType: resolvedSupplierMatchType,
      message: visionUsed
        ? "Текст OCR был плохой, товары разобраны по изображению."
        : fallbackUsed
          ? "AI не нашёл товары, использован простой разбор по строкам таблицы."
          : undefined,
    });
  } catch (error) {
    await prisma.invoiceDocument.update({
      where: {
        id,
      },
      data: {
        status: "failed",
      },
    });

    return jsonUtf8(
      {
        message: error instanceof Error ? error.message : "Не удалось разобрать накладную через AI.",
      },
      { status: 500 },
    );
  }
}
