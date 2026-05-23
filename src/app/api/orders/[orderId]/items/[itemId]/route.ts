import { jsonUtf8 } from "@/lib/http";
import {
  calculateLineTotal,
  ensureScopedCatalogSelection,
  ensureScopedProduct,
  getCatalogOrderRules,
  getOrderWithDetails,
  parseRequiredPositiveQuantity,
  serializeOrder,
  validateOrderQuantity,
} from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    orderId: string;
    itemId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { orderId, itemId } = await context.params;
  const body = (await request.json()) as {
    enterpriseId?: string;
    quantity?: string | number;
  };

  const enterpriseId = body.enterpriseId?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Поле enterpriseId обязательно." }, { status: 400 });
  }

  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      enterpriseId,
    },
    select: {
      id: true,
      enterpriseId: true,
      supplierId: true,
      status: true,
    },
  });

  if (!order) {
    return jsonUtf8({ message: "Заказ не найден." }, { status: 404 });
  }

  if (order.status !== "draft") {
    return jsonUtf8({ message: "Менять позиции можно только в черновике заказа." }, { status: 400 });
  }

  const item = await prisma.orderItem.findFirst({
    where: {
      id: itemId,
      orderId,
    },
  });

  if (!item) {
    return jsonUtf8({ message: "Позиция заказа не найдена." }, { status: 404 });
  }

  try {
    const quantity = parseRequiredPositiveQuantity(body.quantity);

    if (item.productId) {
      const product = await ensureScopedProduct(order.enterpriseId, order.supplierId, item.productId);

      if (product) {
        validateOrderQuantity(product, quantity);
      }
    } else if (item.supplierOfferId && item.priceSnapshotId) {
      const selection = await ensureScopedCatalogSelection(
        order.enterpriseId,
        order.supplierId,
        item.supplierOfferId,
        item.priceSnapshotId,
        item.productMasterId,
      );

      if (selection) {
        validateOrderQuantity(getCatalogOrderRules(selection.supplierOffer), quantity);
      }
    }

    const lineTotal = calculateLineTotal(quantity, item.price);

    await prisma.orderItem.update({
      where: { id: item.id },
      data: {
        quantity,
        lineTotal,
      },
    });

    await prisma.order.update({
      where: { id: order.id },
      data: { updatedAt: new Date() },
    });

    const fullOrder = await getOrderWithDetails(order.id, enterpriseId);

    if (!fullOrder) {
      return jsonUtf8({ message: "Не удалось получить обновлённый заказ." }, { status: 500 });
    }

    return jsonUtf8(serializeOrder(fullOrder));
  } catch (error) {
    return jsonUtf8(
      { message: error instanceof Error ? error.message : "Не удалось обновить позицию заказа." },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { orderId, itemId } = await context.params;
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      enterpriseId,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!order) {
    return jsonUtf8({ message: "Заказ не найден." }, { status: 404 });
  }

  if (order.status !== "draft") {
    return jsonUtf8({ message: "Удалять позиции можно только из черновика заказа." }, { status: 400 });
  }

  const item = await prisma.orderItem.findFirst({
    where: {
      id: itemId,
      orderId,
    },
    select: {
      id: true,
    },
  });

  if (!item) {
    return jsonUtf8({ message: "Позиция заказа не найдена." }, { status: 404 });
  }

  await prisma.orderItem.delete({
    where: {
      id: itemId,
    },
  });

  await prisma.order.update({
    where: { id: orderId },
    data: { updatedAt: new Date() },
  });

  const fullOrder = await getOrderWithDetails(orderId, enterpriseId);

  if (!fullOrder) {
    return jsonUtf8({ message: "Не удалось получить обновлённый заказ." }, { status: 500 });
  }

  return jsonUtf8(serializeOrder(fullOrder));
}
