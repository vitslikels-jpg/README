import { Prisma } from "@prisma/client";
import { jsonUtf8 } from "@/lib/http";
import {
  calculateLineTotal,
  ensureScopedCatalogSelection,
  ensureScopedProduct,
  getCatalogSelectionUsability,
  getCatalogOrderRules,
  getNextSortOrder,
  getOrderWithDetails,
  parseRequiredPositiveQuantity,
  serializeOrder,
  validateOrderQuantity,
} from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    orderId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { orderId } = await context.params;
  const body = (await request.json()) as {
    enterpriseId?: string;
    productId?: string;
    productMasterId?: string;
    supplierOfferId?: string;
    priceSnapshotId?: string;
    confirmQualityWarning?: boolean;
    quantity?: string | number;
  };

  const enterpriseId = body.enterpriseId?.trim();
  const productId = body.productId?.trim();
  const productMasterId = body.productMasterId?.trim();
  const supplierOfferId = body.supplierOfferId?.trim();
  const priceSnapshotId = body.priceSnapshotId?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Поле enterpriseId обязательно." }, { status: 400 });
  }

  if (!productId && !(supplierOfferId && priceSnapshotId)) {
    return jsonUtf8(
      { message: "Нужно передать либо productId, либо supplierOfferId вместе с priceSnapshotId." },
      { status: 400 },
    );
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
    return jsonUtf8({ message: "Добавлять товары можно только в черновик заказа." }, { status: 400 });
  }

  try {
    const quantity = parseRequiredPositiveQuantity(body.quantity);

    if (productId) {
      const product = await ensureScopedProduct(order.enterpriseId, order.supplierId, productId);

      if (!product) {
        return jsonUtf8({ message: "Товар не найден у этого поставщика." }, { status: 404 });
      }

      validateOrderQuantity(product, quantity);

      const existingItem = await prisma.orderItem.findFirst({
        where: {
          orderId: order.id,
          productId: product.id,
        },
      });

      if (existingItem) {
        const nextQuantity = existingItem.quantity.add(quantity).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
        validateOrderQuantity(product, nextQuantity);
        const lineTotal = calculateLineTotal(nextQuantity, existingItem.price);

        await prisma.orderItem.update({
          where: {
            id: existingItem.id,
          },
          data: {
            quantity: nextQuantity,
            lineTotal,
          },
        });
      } else {
        const sortOrder = await getNextSortOrder(order.id);
        const lineTotal = calculateLineTotal(quantity, product.price);

        await prisma.orderItem.create({
          data: {
            orderId: order.id,
            productId: product.id,
            quantity,
            unit: product.unit,
            price: product.price,
            lineTotal,
            sortOrder,
          },
        });
      }
    } else {
      const selection = await ensureScopedCatalogSelection(
        order.enterpriseId,
        order.supplierId,
        supplierOfferId as string,
        priceSnapshotId as string,
        productMasterId || null,
      );

      if (!selection) {
        return jsonUtf8(
          { message: "Catalog offer, snapshot или product master не найдены для этого поставщика." },
          { status: 404 },
        );
      }

      const qualityGate = getCatalogSelectionUsability(selection);

      if (qualityGate.manualReviewStatus !== "approved" && qualityGate.usabilityStatus === "blocked") {
        return jsonUtf8(
          { message: qualityGate.usabilityReason || "Этот прайс заблокирован и не должен использоваться для закупки." },
          { status: 409 },
        );
      }

      if (
        qualityGate.manualReviewStatus !== "approved" &&
        qualityGate.usabilityStatus === "needs_review" &&
        body.confirmQualityWarning !== true
      ) {
        return jsonUtf8(
          {
            message:
              qualityGate.usabilityReason || "Этот прайс можно использовать только после явного подтверждения.",
          },
          { status: 409 },
        );
      }

      const orderRules = getCatalogOrderRules(selection.supplierOffer);
      validateOrderQuantity(orderRules, quantity);

      const existingItem = await prisma.orderItem.findFirst({
        where: {
          orderId: order.id,
          supplierOfferId: selection.supplierOffer.id,
          priceSnapshotId: selection.priceSnapshot.id,
          productMasterId: selection.productMaster?.id ?? null,
        },
      });

      if (existingItem) {
        const nextQuantity = existingItem.quantity.add(quantity).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
        validateOrderQuantity(orderRules, nextQuantity);
        const lineTotal = calculateLineTotal(nextQuantity, existingItem.price);

        await prisma.orderItem.update({
          where: {
            id: existingItem.id,
          },
          data: {
            quantity: nextQuantity,
            lineTotal,
          },
        });
      } else {
        const sortOrder = await getNextSortOrder(order.id);
        const lineTotal = calculateLineTotal(quantity, selection.priceSnapshot.price);

        await prisma.orderItem.create({
          data: {
            orderId: order.id,
            productId: null,
            productMasterId: selection.productMaster?.id ?? null,
            supplierOfferId: selection.supplierOffer.id,
            priceSnapshotId: selection.priceSnapshot.id,
            quantity,
            unit: selection.priceSnapshot.unit?.symbol ?? selection.supplierOffer.unit?.symbol ?? selection.supplierOffer.legacyUnit,
            price: selection.priceSnapshot.price,
            lineTotal,
            sortOrder,
          },
        });
      }
    }

    await prisma.order.update({
      where: {
        id: order.id,
      },
      data: {
        updatedAt: new Date(),
      },
    });

    const fullOrder = await getOrderWithDetails(order.id, enterpriseId);

    if (!fullOrder) {
      return jsonUtf8({ message: "Не удалось получить обновлённый заказ." }, { status: 500 });
    }

    return jsonUtf8(serializeOrder(fullOrder), { status: 201 });
  } catch (error) {
    return jsonUtf8(
      { message: error instanceof Error ? error.message : "Не удалось добавить товар в заказ." },
      { status: 400 },
    );
  }
}
