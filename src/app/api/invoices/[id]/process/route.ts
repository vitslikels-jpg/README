import { extractInvoiceText } from "@/lib/invoice-ocr";
import { matchInvoiceSupplier } from "@/lib/invoice-supplier-match";
import { jsonUtf8 } from "@/lib/http";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

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
      supplierId: true,
      fileUrl: true,
      storageKey: true,
      originalFileName: true,
    },
  });

  if (!invoice) {
    return jsonUtf8({ message: "Накладная не найдена." }, { status: 404 });
  }

  if (!invoice.fileUrl && !invoice.storageKey) {
    return jsonUtf8({ message: "У накладной нет загруженного файла." }, { status: 400 });
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
    const result = await extractInvoiceText(invoice.storageKey, invoice.fileUrl, invoice.originalFileName);
    const supplierMatch = await matchInvoiceSupplier(result.rawText, enterpriseId);

    const updatedInvoice = await prisma.invoiceDocument.update({
      where: {
        id,
      },
      data: {
        rawText: result.rawText,
        status: "parsed",
        detectedSupplierName: supplierMatch?.supplierName ?? null,
        confidence: supplierMatch?.confidence ?? null,
        ...(invoice.supplierId ? {} : { supplierId: supplierMatch?.supplierId ?? null }),
      },
      select: {
        id: true,
        status: true,
        rawText: true,
        supplierId: true,
        detectedSupplierName: true,
        confidence: true,
        updatedAt: true,
      },
    });

    return jsonUtf8({
      invoice: updatedInvoice,
      source: result.source,
      supplierMatchType: supplierMatch?.matchType ?? null,
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
        message: error instanceof Error ? error.message : "Не удалось распознать текст накладной.",
      },
      { status: 500 },
    );
  }
}
