import { parseInvoiceWithGemini } from "@/lib/invoice-gemini-parser";
import {
  InvoiceVisionUnsupportedError,
  parseInvoiceWithGeminiVision,
  type InvoiceVisionInputFile,
} from "@/lib/invoice-gemini-vision-parser";
import { jsonUtf8 } from "@/lib/http";
import { parseInvoiceItemsFromText } from "@/lib/invoice-item-parser";
import { sanitizeMoney, sanitizeQuantity, sanitizeVatRate } from "@/lib/invoice-number-sanitize";
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

  return {
    ...sanitizedItem,
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
) {
  return items.map((item) => {
    const sanitizedItem = sanitizeParsedItem(item);
    const needsReview = sanitizedItem.forcedReview || needsItemReview(sanitizedItem);

    return {
      ...sanitizedItem,
      confidence: sanitizedItem.forcedReview ? 0.5 : needsReview ? baseConfidenceWhenReview : baseConfidenceWhenReady,
      needsReview,
    } satisfies ParsedItemDraft;
  });
}

function buildFallbackDraftItems(tableRows: string[]) {
  const fallbackItems = parseInvoiceItemsFromText(tableRows.join("\n"));

  return {
    fallbackItemsCount: fallbackItems.length,
    items: fallbackItems.map((item) => {
      const sanitizedQuantity = sanitizeQuantity(item.quantity);
      const sanitizedPriceWithVat = sanitizeMoney(item.priceWithVat);
      const sanitizedLineTotal = sanitizeMoney(item.lineTotal);
      const forcedReview =
        sanitizedQuantity.forcedReview || sanitizedPriceWithVat.forcedReview || sanitizedLineTotal.forcedReview;

      return {
        name: item.productNameRaw,
        quantity: sanitizedQuantity.value?.toNumber() ?? null,
        unit: item.unit,
        priceWithVat: sanitizedPriceWithVat.value?.toNumber() ?? null,
        priceWithoutVat: null,
        vatRate: null,
        lineTotal: sanitizedLineTotal.value?.toNumber() ?? null,
        forcedReview,
        confidence: forcedReview ? 0.5 : item.confidence,
        needsReview: true,
      } satisfies ParsedItemDraft;
    }),
  };
}

async function createInvoiceItems(invoiceId: string, items: ParsedItemDraft[]) {
  const reviewItemsCount = items.filter((item) => item.needsReview).length;
  const createdItemsCount = items.length;

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
        quantity: sanitizedQuantity.value,
        unit: item.unit,
        priceWithoutVat: sanitizedPriceWithoutVat.value,
        priceWithVat: sanitizedPriceWithVat.value,
        vatRate: sanitizedVatRate.value,
        lineTotal: sanitizedLineTotal.value,
        confidence: forcedReview ? Math.min(item.confidence ?? 0.5, 0.5) : item.confidence,
        needsReview: forcedReview || item.needsReview,
      };

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
  };
}

async function updateInvoiceMetadata(invoiceId: string, data: {
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  totalAmount: number | null;
  vatAmount: number | null;
  status: "needs_review" | "parsed" | "failed" | "processing";
}) {
  await prisma.invoiceDocument.update({
    where: {
      id: invoiceId,
    },
    data: {
      detectedSupplierName: data.supplierName,
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

  console.info("[invoice-ai-parse:start]", {
    invoiceId: id,
    rawTextLength: rawText.length,
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
        parsedItems = buildDraftItems(parsedInvoice.items, 0.65, 0.85);
        textParsedItemsCount = parsedItems.length;
        rawTextPreview = buildRowsPreview(tableRows);

        if (parsedItems.length === 0) {
          const fallbackResult = buildFallbackDraftItems(tableRows);
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

    if (tableRowsCount === 0 || textParsedItemsCount === 0) {
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
          parsedItems = buildDraftItems(visionResult.items, 0.7, 0.9);
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
      });

      return jsonUtf8(
        {
          message: "Не удалось разобрать товары. Попробуйте более чёткое фото или внесите строки вручную.",
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

    const { createdItemsCount, reviewItemsCount } = await createInvoiceItems(id, parsedItems);

    console.info("[invoice-ai-parse:created]", {
      invoiceId: id,
      rawTextLength: rawText.length,
      tableDetected: textTableDetected,
      tableRowsCount,
      textParsedItemsCount,
      visionAttempted,
      visionItemsCount,
      createdItemsCount,
      reviewItemsCount,
    });

    await updateInvoiceMetadata(id, {
      ...metadata,
      status: createdItemsCount === 0 || reviewItemsCount > 0 ? "needs_review" : "parsed",
    });

    return jsonUtf8({
      invoiceId: id,
      createdItemsCount,
      reviewItemsCount,
      fallbackUsed,
      visionUsed,
      tableDetected: textTableDetected,
      tableRowsCount,
      textParsedItemsCount,
      visionAttempted,
      visionItemsCount,
      columns,
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
