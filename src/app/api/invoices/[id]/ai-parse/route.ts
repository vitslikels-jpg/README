import { parseInvoiceWithGemini } from "@/lib/invoice-gemini-parser";
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
    },
  });

  if (!invoice) {
    return jsonUtf8({ message: "Накладная не найдена." }, { status: 404 });
  }

  const rawText = invoice.rawText?.trim() ?? "";

  console.info("[invoice-ai-parse:start]", {
    invoiceId: id,
    rawTextLength: rawText.length,
  });

  if (!rawText) {
    return jsonUtf8({ message: "У накладной нет текста для AI-разбора." }, { status: 400 });
  }

  await prisma.invoiceDocument.update({
    where: {
      id,
    },
    data: {
      status: "processing",
    },
  });

  try {
    const parsedInvoice = await parseInvoiceWithGemini(rawText);
    let parsedItems = parsedInvoice.items.map((item) => {
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
      const needsReview = forcedReview || needsItemReview(sanitizedItem);

      return {
        ...sanitizedItem,
        confidence: forcedReview ? 0.5 : needsReview ? 0.65 : 0.85,
        needsReview,
      };
    });
    let fallbackUsed = false;

    console.info("[invoice-ai-parse:result]", {
      invoiceId: id,
      rawTextLength: rawText.length,
      aiItemsCount: parsedItems.length,
    });

    if (parsedItems.length === 0) {
      const fallbackItems = parseInvoiceItemsFromText(rawText);
      fallbackUsed = fallbackItems.length > 0;

      console.info("[invoice-ai-parse:fallback]", {
        invoiceId: id,
        rawTextLength: rawText.length,
        fallbackItemsCount: fallbackItems.length,
      });

      parsedItems = fallbackItems.map((item) => {
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
          confidence: forcedReview ? 0.5 : item.confidence,
          needsReview: true,
        };
      });

      if (parsedItems.length === 0) {
        await prisma.invoiceDocument.update({
          where: {
            id,
          },
          data: {
            status: "needs_review",
          },
        });

        return jsonUtf8(
          {
            message: "AI не смог разобрать товары. Проверьте распознанный текст или используйте разбор без AI.",
            rawTextPreview: buildRawTextPreview(rawText),
          },
          { status: 400 },
        );
      }
    }

    const reviewItemsCount = parsedItems.filter((item) => item.needsReview).length;

    await prisma.$transaction(async (tx) => {
      await tx.invoiceItem.deleteMany({
        where: {
          invoiceDocumentId: id,
        },
      });

      for (const item of parsedItems) {
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
        const payload = {
          invoiceDocumentId: id,
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
            invoiceId: id,
            itemIndex: parsedItems.indexOf(item),
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

      console.info("[invoice-ai-parse:created]", {
        invoiceId: id,
        createdItemsCount: parsedItems.length,
        reviewItemsCount,
      });

      await tx.invoiceDocument.update({
        where: {
          id,
        },
        data: {
          detectedSupplierName: parsedInvoice.supplierName,
          invoiceNumber: parsedInvoice.invoiceNumber,
          invoiceDate: parseDate(parsedInvoice.invoiceDate),
          totalAmount: parsedInvoice.totalAmount,
          vatAmount: parsedInvoice.vatAmount,
          status: parsedItems.length === 0 || reviewItemsCount > 0 ? "needs_review" : "parsed",
        },
      });
    });

    return jsonUtf8({
      invoiceId: id,
      createdItemsCount: parsedItems.length,
      reviewItemsCount,
      fallbackUsed,
      message: fallbackUsed ? "AI не нашёл товары, использован простой разбор." : undefined,
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
