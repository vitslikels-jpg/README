import { jsonUtf8 } from "@/lib/http";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
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
    include: {
      supplier: {
        select: {
          id: true,
          name: true,
        },
      },
      items: {
        include: {
          matchedProduct: {
            select: {
              id: true,
              name: true,
              article: true,
              brand: true,
            },
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      },
      priceChanges: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              article: true,
              brand: true,
            },
          },
          invoiceItem: {
            select: {
              id: true,
              productNameRaw: true,
            },
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!invoice) {
    return jsonUtf8({ message: "Накладная не найдена." }, { status: 404 });
  }

  return jsonUtf8({
    id: invoice.id,
    status: invoice.status,
    supplierId: invoice.supplierId,
    supplierName: invoice.supplier?.name ?? null,
    detectedSupplierName: invoice.detectedSupplierName,
    confidence: invoice.confidence,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    totalAmount: invoice.totalAmount?.toString() ?? null,
    vatAmount: invoice.vatAmount?.toString() ?? null,
    originalFileName: invoice.originalFileName,
    fileUrl: invoice.fileUrl,
    rawText: invoice.rawText,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
    items: invoice.items.map((item) => ({
      id: item.id,
      productNameRaw: item.productNameRaw,
      matchedProductId: item.matchedProductId,
      matchedProductStatus: item.matchedProductId ? "matched" : item.confidence !== null && item.confidence >= 0.5 ? "ambiguous" : "not_found",
      matchedProductName: item.matchedProduct?.name ?? null,
      matchedProductArticle: item.matchedProduct?.article ?? null,
      matchedProductBrand: item.matchedProduct?.brand ?? null,
      quantity: item.quantity?.toString() ?? null,
      unit: item.unit,
      priceWithoutVat: item.priceWithoutVat?.toString() ?? null,
      priceWithVat: item.priceWithVat?.toString() ?? null,
      vatRate: item.vatRate?.toString() ?? null,
      lineTotal: item.lineTotal?.toString() ?? null,
      confidence: item.confidence,
      needsReview: item.needsReview,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
    priceChanges: invoice.priceChanges.map((change) => ({
      id: change.id,
      invoiceItemId: change.invoiceItemId,
      productId: change.productId,
      productName: change.product?.name ?? change.invoiceItem.productNameRaw,
      oldPrice: change.oldPrice?.toString() ?? null,
      newPrice: change.newPrice.toString(),
      differenceAmount: change.differenceAmount?.toString() ?? null,
      differencePercent: change.differencePercent?.toString() ?? null,
      status: change.status,
      createdAt: change.createdAt,
      approvedAt: change.approvedAt,
    })),
  });
}
