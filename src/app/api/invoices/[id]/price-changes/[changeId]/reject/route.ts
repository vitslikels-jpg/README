import { jsonUtf8 } from "@/lib/http";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
    changeId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id, changeId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    enterpriseId?: string;
  };
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
    },
  });

  if (!invoice) {
    return jsonUtf8({ message: "Накладная не найдена." }, { status: 404 });
  }

  const priceChange = await prisma.invoicePriceChange.findFirst({
    where: {
      id: changeId,
      invoiceDocumentId: id,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!priceChange) {
    return jsonUtf8({ message: "Изменение цены не найдено." }, { status: 404 });
  }

  if (priceChange.status !== "pending") {
    return jsonUtf8({ message: "Можно отклонить только изменение со статусом pending." }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoicePriceChange.update({
      where: {
        id: changeId,
      },
      data: {
        status: "rejected",
      },
    });

    const pendingPriceChangesCount = await tx.invoicePriceChange.count({
      where: {
        invoiceDocumentId: id,
        status: "pending",
      },
    });

    const reviewItemsCount = await tx.invoiceItem.count({
      where: {
        invoiceDocumentId: id,
        needsReview: true,
      },
    });

    await tx.invoiceDocument.update({
      where: {
        id,
      },
      data: {
        status: pendingPriceChangesCount > 0 || reviewItemsCount > 0 ? "needs_review" : "parsed",
      },
    });
  });

  return jsonUtf8({
    success: true,
  });
}
