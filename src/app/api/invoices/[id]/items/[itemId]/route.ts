import { jsonUtf8 } from "@/lib/http";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
    itemId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id, itemId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    enterpriseId?: string;
    matchedProductId?: string | null;
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

  const item = await prisma.invoiceItem.findFirst({
    where: {
      id: itemId,
      invoiceDocumentId: id,
    },
    select: {
      id: true,
      quantity: true,
      unit: true,
      priceWithVat: true,
      confidence: true,
    },
  });

  if (!item) {
    return jsonUtf8({ message: "Строка накладной не найдена." }, { status: 404 });
  }

  const matchedProductId =
    body.matchedProductId === null ? null : typeof body.matchedProductId === "string" ? body.matchedProductId.trim() : undefined;

  if (matchedProductId === undefined) {
    return jsonUtf8({ message: "Поле matchedProductId обязательно." }, { status: 400 });
  }

  if (matchedProductId) {
    const product = await prisma.product.findFirst({
      where: {
        id: matchedProductId,
        enterpriseId,
      },
      select: {
        id: true,
      },
    });

    if (!product) {
      return jsonUtf8({ message: "Товар не найден в текущем предприятии." }, { status: 400 });
    }
  }

  const hasStructuredFields = item.quantity !== null && Boolean(item.unit) && item.priceWithVat !== null;

  const updatedItem = await prisma.invoiceItem.update({
    where: {
      id: itemId,
    },
    data: matchedProductId
      ? {
          matchedProductId,
          needsReview: !hasStructuredFields,
          confidence: Math.max(item.confidence ?? 0, 0.9),
        }
      : {
          matchedProductId: null,
          needsReview: true,
          confidence: Math.min(item.confidence ?? 0.5, 0.5),
        },
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
  });

  return jsonUtf8({
    item: {
      id: updatedItem.id,
      matchedProductId: updatedItem.matchedProductId,
      matchedProductName: updatedItem.matchedProduct?.name ?? null,
      matchedProductArticle: updatedItem.matchedProduct?.article ?? null,
      matchedProductBrand: updatedItem.matchedProduct?.brand ?? null,
      quantity: updatedItem.quantity?.toString() ?? null,
      unit: updatedItem.unit,
      priceWithVat: updatedItem.priceWithVat?.toString() ?? null,
      confidence: updatedItem.confidence,
      needsReview: updatedItem.needsReview,
    },
  });
}
