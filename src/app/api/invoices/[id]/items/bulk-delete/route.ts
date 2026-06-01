import { jsonUtf8 } from "@/lib/http";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type BulkDeleteBody = {
  enterpriseId?: string;
  itemIds?: string[];
};

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
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as BulkDeleteBody;
  const enterpriseId = body.enterpriseId?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Поле enterpriseId обязательно." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  const itemIds = Array.isArray(body.itemIds) ? [...new Set(body.itemIds.map((itemId) => itemId.trim()).filter(Boolean))] : [];

  if (itemIds.length === 0) {
    return jsonUtf8({ message: "Нужно передать itemIds для удаления." }, { status: 400 });
  }

  const invoice = await prisma.invoiceDocument.findFirst({
    where: {
      id,
      enterpriseId,
    },
    select: {
      id: true,
    },
  });

  if (!invoice) {
    return jsonUtf8({ message: "Накладная не найдена." }, { status: 404 });
  }

  const items = await prisma.invoiceItem.findMany({
    where: {
      id: {
        in: itemIds,
      },
      invoiceDocumentId: id,
      invoiceDocument: {
        enterpriseId,
      },
    },
    select: {
      id: true,
    },
  });

  if (items.length !== itemIds.length) {
    return jsonUtf8({ message: "Не все строки принадлежат этой накладной." }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoicePriceChange.deleteMany({
      where: {
        invoiceDocumentId: id,
        invoiceItemId: {
          in: itemIds,
        },
        status: "pending",
      },
    });

    await tx.invoiceItem.deleteMany({
      where: {
        invoiceDocumentId: id,
        id: {
          in: itemIds,
        },
      },
    });
  });

  await recalculateInvoiceStatus(id);

  return jsonUtf8({
    deletedCount: itemIds.length,
  });
}
