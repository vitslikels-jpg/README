import { Prisma } from "@prisma/client";
import { normalizeCatalogText } from "@/lib/catalog-model.shared.js";
import { jsonUtf8 } from "@/lib/http";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
    itemId: string;
  }>;
};

type RequestBody = {
  enterpriseId?: string;
};

function normalizeProductName(value: string | null | undefined) {
  return normalizeCatalogText(value)
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

async function recalculateInvoiceStatus(invoiceId: string) {
  const [reviewItemsCount, pendingPriceChangesCount] = await Promise.all([
    prisma.invoiceItem.count({
      where: {
        invoiceDocumentId: invoiceId,
        needsReview: true,
      },
    }),
    prisma.invoicePriceChange.count({
      where: {
        invoiceDocumentId: invoiceId,
        status: "pending",
      },
    }),
  ]);

  await prisma.invoiceDocument.update({
    where: {
      id: invoiceId,
    },
    data: {
      status: reviewItemsCount > 0 || pendingPriceChangesCount > 0 ? "needs_review" : "parsed",
    },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { id, itemId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as RequestBody;
  const enterpriseId = body.enterpriseId?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Поле enterpriseId обязательно." }, { status: 400 });
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
      enterpriseId: true,
      supplierId: true,
    },
  });

  if (!invoice) {
    return jsonUtf8({ message: "Накладная не найдена." }, { status: 404 });
  }

  if (!invoice.supplierId) {
    return jsonUtf8({ message: "Сначала выберите поставщика." }, { status: 400 });
  }

  const item = await prisma.invoiceItem.findFirst({
    where: {
      id: itemId,
      invoiceDocumentId: id,
    },
    select: {
      id: true,
      productNameRaw: true,
      matchedProductId: true,
      quantity: true,
      unit: true,
      priceWithVat: true,
      confidence: true,
    },
  });

  if (!item) {
    return jsonUtf8({ message: "Строка накладной не найдена." }, { status: 404 });
  }

  if (item.matchedProductId) {
    return jsonUtf8({ message: "Для этой строки товар уже выбран." }, { status: 400 });
  }

  const normalizedItemName = normalizeProductName(item.productNameRaw);

  if (!normalizedItemName) {
    return jsonUtf8({ message: "У строки нет корректного названия товара." }, { status: 400 });
  }

  const currentDocument = await prisma.document.findFirst({
    where: {
      enterpriseId,
      supplierId: invoice.supplierId,
      isCurrent: true,
    },
    select: {
      id: true,
    },
    orderBy: [
      {
        uploadedAt: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
  });

  if (!currentDocument) {
    return jsonUtf8(
      { message: "У выбранного поставщика нет текущего прайса. Сначала загрузите прайс поставщика." },
      { status: 400 },
    );
  }

  const existingProducts = await prisma.product.findMany({
    where: {
      enterpriseId,
      document: {
        isCurrent: true,
      },
    },
    select: {
      id: true,
      name: true,
      supplierId: true,
      supplier: {
        select: {
          name: true,
        },
      },
    },
  });

  const duplicateProduct =
    existingProducts.find(
      (product) => product.supplierId === invoice.supplierId && normalizeProductName(product.name) === normalizedItemName,
    ) ?? existingProducts.find((product) => normalizeProductName(product.name) === normalizedItemName);

  if (duplicateProduct) {
    return jsonUtf8(
      {
        message: `Такой товар уже есть в каталоге: ${duplicateProduct.name}. Выберите его вручную.`,
        existingProduct: {
          id: duplicateProduct.id,
          name: duplicateProduct.name,
          supplierId: duplicateProduct.supplierId,
          supplierName: duplicateProduct.supplier?.name ?? null,
        },
      },
      { status: 409 },
    );
  }

  const normalizedUnit = item.unit?.trim() || "шт";
  const hasStructuredFields = item.quantity !== null && Boolean(item.unit?.trim()) && item.priceWithVat !== null;

  const result = await prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        enterpriseId,
        supplierId: invoice.supplierId!,
        documentId: currentDocument.id,
        name: item.productNameRaw.trim(),
        unit: normalizedUnit,
        price: item.priceWithVat?.toString() ?? null,
        sourceRow: 0,
        rawData: {
          source: "invoice_manual_create",
          invoiceId: id,
          invoiceItemId: itemId,
        } satisfies Prisma.InputJsonValue,
      },
      select: {
        id: true,
        name: true,
        supplierId: true,
        documentId: true,
        unit: true,
        price: true,
      },
    });

    const updatedItem = await tx.invoiceItem.update({
      where: {
        id: itemId,
      },
      data: {
        matchedProductId: product.id,
        needsReview: !hasStructuredFields,
        confidence: 0.9,
      },
      select: {
        id: true,
        matchedProductId: true,
        needsReview: true,
        confidence: true,
      },
    });

    return { product, item: updatedItem };
  });

  await recalculateInvoiceStatus(invoice.id);

  return jsonUtf8({
    product: {
      id: result.product.id,
      name: result.product.name,
      supplierId: result.product.supplierId,
      documentId: result.product.documentId,
      unit: result.product.unit,
      price: result.product.price?.toString() ?? null,
    },
    item: result.item,
  });
}
