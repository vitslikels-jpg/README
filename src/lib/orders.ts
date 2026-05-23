import {
  Prisma,
  type Order,
  type OrderItem,
  type PriceSnapshot,
  type Product,
  type ProductMaster,
  type Supplier,
  type SupplierOffer,
  type Unit,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

type LegacyProductOrderRules = Pick<
  Product,
  | "id"
  | "enterpriseId"
  | "supplierId"
  | "name"
  | "article"
  | "unit"
  | "price"
  | "unitsPerPack"
  | "minOrderQuantity"
  | "orderStep"
  | "allowFractionalOrder"
  | "shipByBoxesOnly"
>;

type CatalogOfferOrderRules = Pick<
  SupplierOffer,
  | "id"
  | "enterpriseId"
  | "supplierId"
  | "name"
  | "article"
  | "legacyUnit"
  | "unitsPerPack"
  | "minOrderQuantity"
  | "orderStep"
  | "allowFractionalOrder"
  | "shipByBoxesOnly"
> & {
  unit: Pick<Unit, "id" | "code" | "name" | "symbol"> | null;
};

type CommonOrderRules = {
  unit: string | null;
  unitsPerPack: Prisma.Decimal | null | undefined;
  minOrderQuantity: Prisma.Decimal | null | undefined;
  orderStep: Prisma.Decimal | null | undefined;
  allowFractionalOrder: boolean;
  shipByBoxesOnly: boolean;
};

type OrderItemWithDetails = OrderItem & {
  product: null | Pick<Product, "id" | "name" | "article" | "brand">;
  productMaster: null | Pick<ProductMaster, "id" | "name" | "brand" | "category">;
  supplierOffer: null | Pick<SupplierOffer, "id" | "name" | "article" | "brand" | "legacyUnit">;
  priceSnapshot: null | Pick<PriceSnapshot, "id" | "capturedAt">;
};

type OrderWithDetails = Order & {
  supplier: Pick<Supplier, "id" | "name" | "phone" | "managerName" | "email" | "minOrderAmount">;
  items: OrderItemWithDetails[];
};

const QUANTITY_SCALE = 3;
const QUANTITY_EPSILON = 0.0005;
const ZERO = new Prisma.Decimal(0);
const DRAFT_ORDER_UNIQUE_INDEX = "order_one_draft_per_supplier";

function isUniqueDraftOrderConflict(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return true;
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return error.message.includes("23505") || error.message.includes(DRAFT_ORDER_UNIQUE_INDEX);
  }

  if (error instanceof Error) {
    return error.message.includes(DRAFT_ORDER_UNIQUE_INDEX);
  }

  return false;
}

export function normalizeOptionalString(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

export function parseDecimalInput(value: unknown, fieldName: string) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".");

  if (!normalized) {
    return null;
  }

  const numericValue = Number(normalized);

  if (!Number.isFinite(numericValue)) {
    throw new Error(`Поле ${fieldName} должно быть числом.`);
  }

  return new Prisma.Decimal(numericValue);
}

export function parseRequiredPositiveQuantity(value: unknown) {
  const quantity = parseDecimalInput(value, "quantity");

  if (!quantity || quantity.lte(ZERO)) {
    throw new Error("Количество должно быть больше нуля.");
  }

  return quantity.toDecimalPlaces(QUANTITY_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

function decimalToNumber(value: Prisma.Decimal | null | undefined) {
  return value ? Number(value.toString()) : null;
}

function hasFraction(value: Prisma.Decimal) {
  return !value.equals(value.floor());
}

function isStepAligned(quantity: Prisma.Decimal, start: Prisma.Decimal, step: Prisma.Decimal) {
  const quantityNumber = Number(quantity.toString());
  const startNumber = Number(start.toString());
  const stepNumber = Number(step.toString());
  const ratio = (quantityNumber - startNumber) / stepNumber;
  const roundedRatio = Math.round(ratio);
  return Math.abs(ratio - roundedRatio) <= QUANTITY_EPSILON;
}

export function getEffectiveMinimumQuantity(product: CommonOrderRules) {
  return product.minOrderQuantity ?? (product.shipByBoxesOnly ? product.unitsPerPack : null) ?? product.orderStep ?? null;
}

export function getEffectiveOrderStep(product: CommonOrderRules) {
  if (product.shipByBoxesOnly && product.unitsPerPack) {
    return product.unitsPerPack;
  }

  return product.orderStep;
}

export function validateOrderQuantity(product: CommonOrderRules, quantity: Prisma.Decimal) {
  if (!product.allowFractionalOrder && hasFraction(quantity)) {
    throw new Error("Для этого товара можно указывать только целое количество.");
  }

  const minimumQuantity = getEffectiveMinimumQuantity(product);

  if (minimumQuantity && quantity.lt(minimumQuantity)) {
    const unitLabel = product.unit ? ` ${product.unit}` : "";
    throw new Error(`Минимальный заказ для этого товара: ${minimumQuantity.toString()}${unitLabel}.`);
  }

  const orderStep = getEffectiveOrderStep(product);

  if (product.shipByBoxesOnly && orderStep) {
    const baseQuantity = minimumQuantity ?? orderStep;

    if (!isStepAligned(quantity, baseQuantity, orderStep)) {
      const unitLabel = product.unit ? ` ${product.unit}` : "";
      throw new Error(`Этот товар отгружается коробками. Количество должно идти шагом ${orderStep.toString()}${unitLabel}.`);
    }

    return;
  }

  if (!orderStep) {
    return;
  }

  const baseQuantity = minimumQuantity ?? orderStep;

  if (!isStepAligned(quantity, baseQuantity, orderStep)) {
    const unitLabel = product.unit ? ` ${product.unit}` : "";
    throw new Error(`Количество должно идти шагом ${orderStep.toString()}${unitLabel}.`);
  }
}

export function calculateLineTotal(quantity: Prisma.Decimal, price: Prisma.Decimal | null) {
  if (!price) {
    return new Prisma.Decimal(0).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  return quantity.mul(price).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function getCatalogOrderRules(selection: CatalogOfferOrderRules): CommonOrderRules {
  return {
    unit: selection.unit?.symbol ?? selection.legacyUnit ?? null,
    unitsPerPack: selection.unitsPerPack,
    minOrderQuantity: selection.minOrderQuantity,
    orderStep: selection.orderStep,
    allowFractionalOrder: selection.allowFractionalOrder,
    shipByBoxesOnly: selection.shipByBoxesOnly,
  };
}

export async function ensureEnterpriseExists(enterpriseId: string) {
  return prisma.enterprise.findUnique({
    where: { id: enterpriseId },
    select: { id: true },
  });
}

export async function ensureScopedSupplier(enterpriseId: string, supplierId: string) {
  return prisma.supplier.findFirst({
    where: { id: supplierId, enterpriseId },
    select: {
      id: true,
      enterpriseId: true,
      name: true,
      phone: true,
      managerName: true,
      email: true,
      minOrderAmount: true,
    },
  });
}

export async function ensureScopedProduct(enterpriseId: string, supplierId: string, productId: string) {
  return prisma.product.findFirst({
    where: {
      id: productId,
      enterpriseId,
      supplierId,
    },
    select: {
      id: true,
      enterpriseId: true,
      supplierId: true,
      name: true,
      article: true,
      unit: true,
      price: true,
      unitsPerPack: true,
      minOrderQuantity: true,
      orderStep: true,
      allowFractionalOrder: true,
      shipByBoxesOnly: true,
    },
  });
}

export async function ensureScopedCatalogSelection(
  enterpriseId: string,
  supplierId: string,
  supplierOfferId: string,
  priceSnapshotId: string,
  productMasterId?: string | null,
) {
  const supplierOffer = await prisma.supplierOffer.findFirst({
    where: {
      id: supplierOfferId,
      enterpriseId,
      supplierId,
    },
    include: {
      unit: {
        select: {
          id: true,
          code: true,
          name: true,
          symbol: true,
        },
      },
    },
  });

  if (!supplierOffer) {
    return null;
  }

  const priceSnapshot = await prisma.priceSnapshot.findFirst({
    where: {
      id: priceSnapshotId,
      enterpriseId,
      supplierId,
      supplierOfferId,
    },
    select: {
      id: true,
      supplierOfferId: true,
      price: true,
      stock: true,
      capturedAt: true,
      unit: {
        select: {
          id: true,
          code: true,
          name: true,
          symbol: true,
        },
      },
      document: {
        select: {
          id: true,
          qualityReport: {
            select: {
              qualityStatus: true,
              usabilityStatus: true,
              usabilityReason: true,
              manualReviewStatus: true,
            },
          },
        },
      },
    },
  });

  if (!priceSnapshot) {
    return null;
  }

  let productMaster: Pick<ProductMaster, "id" | "enterpriseId" | "name" | "brand" | "category"> | null = null;

  if (productMasterId) {
    productMaster = await prisma.productMaster.findFirst({
      where: {
        id: productMasterId,
        enterpriseId,
      },
      select: {
        id: true,
        enterpriseId: true,
        name: true,
        brand: true,
        category: true,
      },
    });

    if (!productMaster) {
      return null;
    }
  }

  return {
    supplierOffer,
    priceSnapshot,
    productMaster,
  };
}

export function getCatalogSelectionUsability(selection: Awaited<ReturnType<typeof ensureScopedCatalogSelection>>) {
  const usabilityStatus = selection?.priceSnapshot.document?.qualityReport?.usabilityStatus ?? "needs_review";
  const usabilityReason =
    selection?.priceSnapshot.document?.qualityReport?.usabilityReason ??
    "Для этого прайса нет quality-report. Использовать без проверки нельзя.";

  const manualReviewStatus =
    selection?.priceSnapshot.document?.qualityReport?.manualReviewStatus ?? "not_reviewed";

  return {
    usabilityStatus,
    usabilityReason,
    manualReviewStatus,
  };
}

export async function findDraftOrder(enterpriseId: string, supplierId: string) {
  return prisma.order.findFirst({
    where: {
      enterpriseId,
      supplierId,
      status: "draft",
    },
    orderBy: {
      updatedAt: "desc",
    },
  });
}

export async function getOrderWithDetails(orderId: string, enterpriseId: string) {
  return prisma.order.findFirst({
    where: {
      id: orderId,
      enterpriseId,
    },
    include: {
      supplier: {
        select: {
          id: true,
          name: true,
          phone: true,
          managerName: true,
          email: true,
          minOrderAmount: true,
        },
      },
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              article: true,
              brand: true,
            },
          },
          productMaster: {
            select: {
              id: true,
              name: true,
              brand: true,
              category: true,
            },
          },
          supplierOffer: {
            select: {
              id: true,
              name: true,
              article: true,
              brand: true,
              legacyUnit: true,
            },
          },
          priceSnapshot: {
            select: {
              id: true,
              capturedAt: true,
            },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });
}

export function serializeOrder(order: OrderWithDetails) {
  const total = order.items.reduce((sum, item) => sum.add(item.lineTotal), new Prisma.Decimal(0));

  return {
    id: order.id,
    enterpriseId: order.enterpriseId,
    supplierId: order.supplierId,
    status: order.status,
    comment: order.comment,
    submittedAt: order.submittedAt,
    cancelledAt: order.cancelledAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    total: total.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    itemsCount: order.items.length,
    supplier: order.supplier,
    items: order.items.map((item) => {
      const isCatalogItem = Boolean(item.productMasterId || item.supplierOfferId || item.priceSnapshotId);
      const displayName = isCatalogItem
        ? item.productMaster?.name ?? item.supplierOffer?.name ?? "Catalog item"
        : item.product?.name ?? "Товар удалён из текущего прайса";
      const article = isCatalogItem ? item.supplierOffer?.article ?? null : item.product?.article ?? null;
      const brand = isCatalogItem
        ? item.productMaster?.brand ?? item.supplierOffer?.brand ?? null
        : item.product?.brand ?? null;

      return {
        id: item.id,
        orderId: item.orderId,
        productId: item.productId,
        productMasterId: item.productMasterId,
        supplierOfferId: item.supplierOfferId,
        priceSnapshotId: item.priceSnapshotId,
        sourceType: isCatalogItem ? "catalog" : "legacy",
        displayName,
        article,
        brand,
        supplierName: order.supplier.name,
        quantity: item.quantity,
        unit: item.unit,
        price: item.price,
        lineTotal: item.lineTotal,
        sortOrder: item.sortOrder,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        product: item.product,
        productMaster: item.productMaster,
        supplierOffer: item.supplierOffer,
        priceSnapshot: item.priceSnapshot,
      };
    }),
  };
}

export function buildProductOrderMeta(product: LegacyProductOrderRules) {
  return {
    unit: product.unit,
    unitsPerPack: decimalToNumber(product.unitsPerPack),
    minOrderQuantity: decimalToNumber(product.minOrderQuantity),
    orderStep: decimalToNumber(product.orderStep),
    allowFractionalOrder: product.allowFractionalOrder,
    shipByBoxesOnly: product.shipByBoxesOnly,
    effectiveMinimumQuantity: decimalToNumber(getEffectiveMinimumQuantity(product)),
    effectiveOrderStep: decimalToNumber(getEffectiveOrderStep(product)),
  };
}

export async function getOrCreateDraftOrder(params: {
  enterpriseId: string;
  supplierId: string;
  comment?: string | null;
}) {
  const existingOrder = await findDraftOrder(params.enterpriseId, params.supplierId);

  if (existingOrder) {
    return existingOrder;
  }

  try {
    return await prisma.order.create({
      data: {
        enterpriseId: params.enterpriseId,
        supplierId: params.supplierId,
        status: "draft",
        comment: params.comment ?? null,
      },
    });
  } catch (error) {
    if (!isUniqueDraftOrderConflict(error)) {
      throw error;
    }

    const draftOrder = await findDraftOrder(params.enterpriseId, params.supplierId);

    if (!draftOrder) {
      throw error;
    }

    return draftOrder;
  }
}

export async function getNextSortOrder(orderId: string) {
  const lastItem = await prisma.orderItem.findFirst({
    where: { orderId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  return (lastItem?.sortOrder ?? 0) + 1;
}
