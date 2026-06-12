import { Prisma } from "@prisma/client";
import {
  buildCatalogDedupeKey,
  normalizeCatalogText,
  normalizeCatalogUnit,
  normalizeOptionalString,
} from "@/lib/catalog-model.shared.js";
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
    .replace(/\u0451/g, "\u0435")
    .replace(/\u0401/g, "\u0415")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveUnit(unitValue: string | null | undefined) {
  const unitCode = normalizeCatalogUnit(unitValue);

  if (!unitCode) {
    return null;
  }

  return prisma.unit.findUnique({
    where: {
      code: unitCode,
    },
    select: {
      id: true,
      code: true,
    },
  });
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
    return jsonUtf8({ message: "\u041f\u043e\u043b\u0435 enterpriseId \u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u043e." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "\u041f\u0440\u0435\u0434\u043f\u0440\u0438\u044f\u0442\u0438\u0435 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e." }, { status: 404 });
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
      invoiceDate: true,
    },
  });

  if (!invoice) {
    return jsonUtf8({ message: "\u041d\u0430\u043a\u043b\u0430\u0434\u043d\u0430\u044f \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u0430." }, { status: 404 });
  }

  if (!invoice.supplierId) {
    return jsonUtf8({ message: "\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0432\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0430." }, { status: 400 });
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
      priceWithoutVat: true,
      priceWithVat: true,
      vatRate: true,
      lineTotal: true,
      confidence: true,
    },
  });

  if (!item) {
    return jsonUtf8({ message: "\u0421\u0442\u0440\u043e\u043a\u0430 \u043d\u0430\u043a\u043b\u0430\u0434\u043d\u043e\u0439 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u0430." }, { status: 404 });
  }

  if (item.matchedProductId) {
    return jsonUtf8({ message: "\u0414\u043b\u044f \u044d\u0442\u043e\u0439 \u0441\u0442\u0440\u043e\u043a\u0438 \u0442\u043e\u0432\u0430\u0440 \u0443\u0436\u0435 \u0432\u044b\u0431\u0440\u0430\u043d." }, { status: 400 });
  }

  const normalizedItemName = normalizeProductName(item.productNameRaw);

  if (!normalizedItemName) {
    return jsonUtf8({ message: "\u0423 \u0441\u0442\u0440\u043e\u043a\u0438 \u043d\u0435\u0442 \u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u043e\u0433\u043e \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u044f \u0442\u043e\u0432\u0430\u0440\u0430." }, { status: 400 });
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
    orderBy: [{ uploadedAt: "desc" }, { createdAt: "desc" }],
  });

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
        message: `\u0422\u0430\u043a\u043e\u0439 \u0442\u043e\u0432\u0430\u0440 \u0443\u0436\u0435 \u0435\u0441\u0442\u044c \u0432 \u043a\u0430\u0442\u0430\u043b\u043e\u0433\u0435: ${duplicateProduct.name}. \u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0435\u0433\u043e \u0432\u0440\u0443\u0447\u043d\u0443\u044e.`, 
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

  const productName = item.productNameRaw.trim();
  const fallbackUnit = item.unit?.trim() || "\u0448\u0442";
  const unitFromItem = normalizeOptionalString(item.unit);
  const catalogUnit = await resolveUnit(item.unit ?? fallbackUnit);
  const unitCode = catalogUnit?.code ?? normalizeCatalogUnit(item.unit ?? fallbackUnit);
  const normalizedName = normalizeCatalogText(productName);
  const priceWithVat = item.priceWithVat?.toString() ?? null;
  const priceWithoutVat = item.priceWithoutVat?.toString() ?? null;
  const vatRate = item.vatRate?.toString() ?? null;
  const quantity = item.quantity?.toString() ?? null;
  const lineTotal = item.lineTotal?.toString() ?? null;
  const effectivePrice = priceWithVat ?? priceWithoutVat;
  const hasStructuredFields = item.quantity !== null && Boolean(item.unit?.trim()) && item.priceWithVat !== null;
  const unitDedupePart = unitCode ?? normalizeCatalogText(fallbackUnit);
  const offerDedupeKey = buildCatalogDedupeKey([normalizedName, null, unitDedupePart]);
  const masterDedupeKey = buildCatalogDedupeKey([normalizedName, null, unitDedupePart]);
  const invoiceRawData = {
    source: "invoice_manual_create",
    invoiceId: id,
    invoiceItemId: itemId,
    quantity,
    unit: unitFromItem,
    priceWithoutVat,
    priceWithVat,
    vatRate,
    lineTotal,
  } satisfies Prisma.InputJsonValue;

  const result = await prisma.$transaction(async (tx) => {
    let documentId = currentDocument?.id;

    if (!documentId) {
      const generatedDocument = await tx.document.create({
        data: {
          enterpriseId,
          supplierId: invoice.supplierId!,
          type: "price_list",
          sourceFormat: "unknown",
          originalFileName: `invoice-${invoice.id}-generated-price`,
          storedFilePath: `generated/invoices/${invoice.id}/items/${item.id}`,
          mimeType: "application/json",
          fileSize: 0,
          status: "parsed",
          isCurrent: true,
          uploadedAt: invoice.invoiceDate ?? new Date(),
        },
        select: {
          id: true,
        },
      });

      documentId = generatedDocument.id;
    }

    const product = await tx.product.create({
      data: {
        enterpriseId,
        supplierId: invoice.supplierId!,
        documentId,
        name: productName,
        unit: fallbackUnit,
        price: effectivePrice,
        sourceRow: 0,
        rawData: invoiceRawData,
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

    const productMaster = await tx.productMaster.upsert({
      where: {
        enterpriseId_dedupeKey: {
          enterpriseId,
          dedupeKey: masterDedupeKey,
        },
      },
      update: {
        unitId: catalogUnit?.id ?? null,
        name: productName,
        normalizedName,
        legacyUnit: unitFromItem,
      },
      create: {
        enterpriseId,
        unitId: catalogUnit?.id ?? null,
        name: productName,
        normalizedName,
        legacyUnit: unitFromItem,
        dedupeKey: masterDedupeKey,
      },
      select: {
        id: true,
      },
    });

    const supplierOffer = await tx.supplierOffer.upsert({
      where: {
        supplierId_dedupeKey: {
          supplierId: invoice.supplierId!,
          dedupeKey: offerDedupeKey,
        },
      },
      update: {
        enterpriseId,
        unitId: catalogUnit?.id ?? null,
        name: productName,
        normalizedName,
        legacyUnit: unitFromItem,
      },
      create: {
        enterpriseId,
        supplierId: invoice.supplierId!,
        unitId: catalogUnit?.id ?? null,
        name: productName,
        normalizedName,
        legacyUnit: unitFromItem,
        dedupeKey: offerDedupeKey,
      },
      select: {
        id: true,
      },
    });

    await tx.productMapping.upsert({
      where: {
        supplierOfferId_productMasterId: {
          supplierOfferId: supplierOffer.id,
          productMasterId: productMaster.id,
        },
      },
      update: {
        enterpriseId,
        confidence: "1",
        matchKey: productMaster.id,
        matchSource: "manual_invoice_create",
        status: "active",
      },
      create: {
        enterpriseId,
        supplierOfferId: supplierOffer.id,
        productMasterId: productMaster.id,
        confidence: "1",
        matchKey: productMaster.id,
        matchSource: "manual_invoice_create",
        status: "active",
      },
    });

    await tx.priceSnapshot.updateMany({
      where: {
        supplierOfferId: supplierOffer.id,
        isCurrent: true,
      },
      data: {
        isCurrent: false,
      },
    });

    await tx.priceSnapshot.create({
      data: {
        enterpriseId,
        supplierId: invoice.supplierId!,
        supplierOfferId: supplierOffer.id,
        documentId,
        legacyProductId: product.id,
        unitId: catalogUnit?.id ?? null,
        legacyUnit: unitFromItem,
        price: effectivePrice,
        sourceRow: 0,
        capturedAt: invoice.invoiceDate ?? new Date(),
        isCurrent: true,
        rawData: invoiceRawData,
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
