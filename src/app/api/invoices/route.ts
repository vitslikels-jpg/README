import { jsonUtf8 } from "@/lib/http";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  try {
    const documents = await prisma.invoiceDocument.findMany({
      where: {
        enterpriseId,
      },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            items: true,
            priceChanges: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const invoiceIds = documents.map((document) => document.id);

    const [pendingPriceChanges, reviewItems] = await Promise.all([
      invoiceIds.length === 0
        ? Promise.resolve([])
        : prisma.invoicePriceChange.groupBy({
            by: ["invoiceDocumentId"],
            where: {
              invoiceDocumentId: { in: invoiceIds },
              status: "pending",
            },
            _count: {
              _all: true,
            },
          }),
      invoiceIds.length === 0
        ? Promise.resolve([])
        : prisma.invoiceItem.groupBy({
            by: ["invoiceDocumentId"],
            where: {
              invoiceDocumentId: { in: invoiceIds },
              needsReview: true,
            },
            _count: {
              _all: true,
            },
          }),
    ]);

    const pendingPriceChangesMap = new Map(
      pendingPriceChanges.map((entry) => [entry.invoiceDocumentId, entry._count._all]),
    );
    const reviewItemsMap = new Map(reviewItems.map((entry) => [entry.invoiceDocumentId, entry._count._all]));

    return jsonUtf8({
      invoices: documents.map((document) => ({
        id: document.id,
        supplierId: document.supplierId,
        supplierName: document.supplier?.name ?? null,
        detectedSupplierName: document.detectedSupplierName,
        status: document.status,
        invoiceNumber: document.invoiceNumber,
        invoiceDate: document.invoiceDate,
        totalAmount: document.totalAmount?.toString() ?? null,
        vatAmount: document.vatAmount?.toString() ?? null,
        originalFileName: document.originalFileName,
        fileUrl: document.fileUrl,
        createdAt: document.createdAt,
        itemsCount: document._count.items,
        priceChangesCount: document._count.priceChanges,
        pendingPriceChangesCount: pendingPriceChangesMap.get(document.id) ?? 0,
        reviewItemsCount: reviewItemsMap.get(document.id) ?? 0,
      })),
    });
  } catch {
    return jsonUtf8({ message: "Не удалось загрузить накладные." }, { status: 500 });
  }
}
