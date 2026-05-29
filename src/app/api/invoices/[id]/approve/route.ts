import { jsonUtf8 } from "@/lib/http";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
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

  const [reviewItemsCount, pendingPriceChangesCount] = await Promise.all([
    prisma.invoiceItem.count({
      where: {
        invoiceDocumentId: id,
        needsReview: true,
      },
    }),
    prisma.invoicePriceChange.count({
      where: {
        invoiceDocumentId: id,
        status: "pending",
      },
    }),
  ]);

  if (reviewItemsCount > 0 || pendingPriceChangesCount > 0) {
    return jsonUtf8(
      {
        error: "Накладную нельзя подтвердить",
        reviewItemsCount,
        pendingPriceChangesCount,
      },
      { status: 400 },
    );
  }

  const updatedInvoice = await prisma.invoiceDocument.update({
    where: {
      id,
    },
    data: {
      status: "approved",
    },
    select: {
      id: true,
      status: true,
      updatedAt: true,
    },
  });

  return jsonUtf8({
    invoice: updatedInvoice,
  });
}
