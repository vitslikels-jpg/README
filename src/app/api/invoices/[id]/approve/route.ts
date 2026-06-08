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

  const [items, pendingPriceChanges] = await Promise.all([
    prisma.invoiceItem.findMany({
      where: {
        invoiceDocumentId: id,
      },
      select: {
        id: true,
        productNameRaw: true,
        matchedProductId: true,
        quantity: true,
        unit: true,
        priceWithVat: true,
      },
    }),
    prisma.invoicePriceChange.findMany({
      where: {
        invoiceDocumentId: id,
        status: "pending",
      },
      select: {
        id: true,
        invoiceItemId: true,
      },
    }),
  ]);

  const blockingItems = items.filter((item) => !item.matchedProductId || item.quantity === null || !item.unit || item.priceWithVat === null);
  const reviewItemsCount = blockingItems.length;
  const pendingPriceChangesCount = pendingPriceChanges.length;

  if (reviewItemsCount > 0 || pendingPriceChangesCount > 0) {
    return jsonUtf8(
      {
        error: "Накладную нельзя подтвердить",
        reviewItemsCount,
        pendingPriceChangesCount,
        blockingItems: blockingItems.map((item) => ({
          id: item.id,
          productNameRaw: item.productNameRaw,
          matchedProductId: item.matchedProductId,
          quantity: item.quantity?.toString() ?? null,
          unit: item.unit,
          priceWithVat: item.priceWithVat?.toString() ?? null,
        })),
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
