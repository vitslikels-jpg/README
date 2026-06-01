import { parseInvoiceWithGemini } from "@/lib/invoice-gemini-parser";
import { jsonUtf8 } from "@/lib/http";
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
    const parsedItems = parsedInvoice.items.map((item) => {
      const needsReview = needsItemReview(item);

      return {
        ...item,
        confidence: needsReview ? 0.65 : 0.85,
        needsReview: true,
      };
    });

    console.info("[invoice-ai-parse:result]", {
      invoiceId: id,
      rawTextLength: rawText.length,
      aiItemsCount: parsedItems.length,
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
          message: "AI не нашёл товары в тексте накладной.",
        },
        { status: 400 },
      );
    }

    const reviewItemsCount = parsedItems.filter((item) => item.needsReview).length;

    await prisma.$transaction(async (tx) => {
      await tx.invoiceItem.deleteMany({
        where: {
          invoiceDocumentId: id,
        },
      });

      for (const item of parsedItems) {
        await tx.invoiceItem.create({
          data: {
            invoiceDocumentId: id,
            productNameRaw: item.name ?? "",
            quantity: item.quantity,
            unit: item.unit,
            priceWithoutVat: item.priceWithoutVat,
            priceWithVat: item.priceWithVat,
            vatRate: item.vatRate,
            lineTotal: item.lineTotal,
            confidence: item.confidence,
            needsReview: item.needsReview,
          },
        });
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
