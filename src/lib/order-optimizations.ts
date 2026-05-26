import {
  Prisma,
  type OrderOptimizationMatchStatus,
  type OrderOptimization,
  type OrderOptimizationItem,
  type OrderOptimizationResult,
  type OrderOptimizationSelectionMode,
  type Product,
  type Supplier,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

type OrderOptimizationWithDetails = OrderOptimization & {
  items: Array<
    OrderOptimizationItem & {
      results: Array<
        OrderOptimizationResult & {
          selectedSupplier: Pick<Supplier, "id" | "name" | "minOrderAmount"> | null;
          selectedProduct: Pick<
            Product,
            "id" | "name" | "article" | "brand" | "unit" | "unitsPerPack" | "minOrderQuantity" | "orderStep"
          > | null;
        }
      >;
    }
  >;
  results: Array<
    OrderOptimizationResult & {
      selectedSupplier: Pick<Supplier, "id" | "name" | "minOrderAmount"> | null;
      selectedProduct: Pick<
        Product,
        "id" | "name" | "article" | "brand" | "unit" | "unitsPerPack" | "minOrderQuantity" | "orderStep"
      > | null;
    }
  >;
};

type ParsedSourceItem = {
  sourceLine: string;
  requestedSupplierName: string | null;
  parsedName: string;
  parsedQuantity: Prisma.Decimal | null;
  parsedUnit: string | null;
  requestedAmount: Prisma.Decimal | null;
  sortOrder: number;
};

export type SmartOrderSelectedProductDto = {
  id: string;
  name: string;
  article: string | null;
  brand: string | null;
  unit: string | null;
  unitsPerPack: string | null;
  minOrderQuantity: string | null;
  orderStep: string | null;
};

export type SmartOrderSupplierBasketItemDto = {
  itemId: string;
  parsedName: string | null;
  selectedProductName: string | null;
  quantity: string | null;
  unit: string | null;
  optimizedLineTotal: string | null;
};

export type SmartOrderSupplierBasketDto = {
  supplierId: string | null;
  supplierName: string;
  items: SmartOrderSupplierBasketItemDto[];
  itemsCount: number;
  total: string;
  minOrderAmount: string | null;
  meetsMinOrder: boolean;
  missingAmount: string;
};

export const parsedOrderUnits = ["шт", "кг", "г", "л", "мл", "уп", "пач", "кор", "бут"] as const;

export type ParsedOrderUnit = (typeof parsedOrderUnits)[number];

const parsedOrderUnitAliases: Record<ParsedOrderUnit, string[]> = {
  шт: ["шт", "шт.", "штук", "штуки", "штука"],
  кг: ["кг", "кг.", "килограмм", "килограмма", "килограммов", "килограммы", "kg", "кн", "кгг", "kr", "кш"],
  г: ["г", "г.", "гр", "гр.", "грамм", "грамма", "граммов", "граммы"],
  л: ["л", "л.", "литр", "литра", "литров", "литры"],
  мл: ["мл", "мл."],
  уп: ["уп", "уп.", "упаковка", "упаковки", "упаковок"],
  пач: ["пач", "пач.", "пачка", "пачки", "пачек"],
  кор: ["кор", "кор.", "коробка", "коробки", "коробок"],
  бут: ["бут", "бут.", "бутылка", "бутылки", "бутылок"],
};

const unitPattern = Object.values(parsedOrderUnitAliases)
  .flat()
  .sort((left, right) => right.length - left.length)
  .map((unit) => unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

export function normalizeOptionalString(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function decimalToString(value: { toString: () => string } | null | undefined) {
  return value ? value.toString() : null;
}

function decimalToMoneyString(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toString();
}

function buildSmartOrderSelectedProductDto(
  product:
    | Pick<Product, "id" | "name" | "article" | "brand" | "unit" | "unitsPerPack" | "minOrderQuantity" | "orderStep">
    | null
    | undefined,
): SmartOrderSelectedProductDto | null {
  if (!product) {
    return null;
  }

  // TODO: add support for SupplierOffer + PriceSnapshot while keeping this DTO shape unchanged for the UI.
  return {
    id: product.id,
    name: product.name,
    article: product.article,
    brand: product.brand,
    unit: product.unit,
    unitsPerPack: decimalToString(product.unitsPerPack),
    minOrderQuantity: decimalToString(product.minOrderQuantity),
    orderStep: decimalToString(product.orderStep),
  };
}

function buildSmartOrderSupplierBaskets(
  items: Array<
    OrderOptimizationItem & {
      results: Array<
        OrderOptimizationResult & {
          selectedSupplier: Pick<Supplier, "id" | "name" | "minOrderAmount"> | null;
          selectedProduct: Pick<
            Product,
            "id" | "name" | "article" | "brand" | "unit" | "unitsPerPack" | "minOrderQuantity" | "orderStep"
          > | null;
        }
      >;
    }
  >,
): SmartOrderSupplierBasketDto[] {
  const baskets = new Map<
    string,
    {
      supplierId: string | null;
      supplierName: string;
      items: SmartOrderSupplierBasketItemDto[];
      total: Prisma.Decimal;
      minOrderAmount: Prisma.Decimal | null;
    }
  >();

  for (const item of items) {
    if (!item.selectedCandidateId) {
      continue;
    }

    const selectedResult = item.results.find((result) => result.id === item.selectedCandidateId);

    if (!selectedResult?.selectedSupplierId || !selectedResult.selectedSupplier?.name) {
      continue;
    }

    const basketKey = selectedResult.selectedSupplierId;
    const currentBasket = baskets.get(basketKey) ?? {
      supplierId: selectedResult.selectedSupplierId,
      supplierName: selectedResult.selectedSupplier.name,
      items: [],
      total: new Prisma.Decimal(0),
      minOrderAmount: selectedResult.selectedSupplier.minOrderAmount ?? null,
    };

    currentBasket.items.push({
      itemId: item.id,
      parsedName: item.parsedName,
      selectedProductName: selectedResult.selectedProduct?.name ?? null,
      quantity: decimalToString(item.parsedQuantity),
      unit: item.parsedUnit,
      optimizedLineTotal: decimalToString(selectedResult.optimizedLineTotal),
    });

    if (selectedResult.optimizedLineTotal) {
      currentBasket.total = currentBasket.total.add(selectedResult.optimizedLineTotal);
    }

    baskets.set(basketKey, currentBasket);
  }

  return Array.from(baskets.values()).map((basket) => {
    const minOrderAmount = basket.minOrderAmount;
    const meetsMinOrder = !minOrderAmount || basket.total.gte(minOrderAmount);
    const missingAmount = !minOrderAmount || meetsMinOrder ? new Prisma.Decimal(0) : minOrderAmount.sub(basket.total);

    return {
      supplierId: basket.supplierId,
      supplierName: basket.supplierName,
      items: basket.items,
      itemsCount: basket.items.length,
      total: decimalToMoneyString(basket.total),
      minOrderAmount: decimalToString(minOrderAmount),
      meetsMinOrder,
      missingAmount: decimalToMoneyString(missingAmount),
    };
  });
}

function hasUsefulName(value: string | null | undefined) {
  return Boolean(value?.trim());
}

export function isOrderOptimizationItemProblem(
  item: Pick<OrderOptimizationItem, "parsedName" | "parsedQuantity" | "parsedUnit">,
) {
  return !hasUsefulName(item.parsedName) || !item.parsedQuantity || !item.parsedUnit;
}

export function getOrderOptimizationItemStatus(
  item: Pick<OrderOptimizationItem, "selectedCandidateId" | "selectionMode" | "matchStatus">,
) {
  if (item.selectedCandidateId && item.selectionMode === "manual") {
    return "manual";
  }

  if (item.selectedCandidateId && item.selectionMode === "auto") {
    return "autoselected";
  }

  if (item.matchStatus === "not_found") {
    return "not_found";
  }

  return "review";
}

export function normalizeOrderOptimizationUnit(value: unknown) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");

  if (!normalized) {
    return null;
  }

  for (const [unit, aliases] of Object.entries(parsedOrderUnitAliases) as Array<[ParsedOrderUnit, string[]]>) {
    if (aliases.map((alias) => alias.replace(/\.$/, "")).includes(normalized)) {
      return unit;
    }
  }

  return null;
}

export function parseNullablePositiveDecimal(value: unknown, fieldName: string) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = String(value)
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".");
  const numberValue = Number(normalized);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new Error(`Поле ${fieldName} должно быть положительным числом.`);
  }

  return new Prisma.Decimal(normalized);
}

export function calculateRequestedAmount(
  parsedQuantity: Prisma.Decimal | null | undefined,
  parsedUnit: string | null | undefined,
) {
  if (!parsedQuantity || !parsedUnit) {
    return null;
  }

  const normalizedUnit = normalizeOrderOptimizationUnit(parsedUnit);

  if (normalizedUnit === "кг" || normalizedUnit === "л") {
    return parsedQuantity.mul(1000).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
  }

  return parsedQuantity.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
}

export function buildOrderOptimizationTitle(sourceText: string) {
  const firstLine = sourceText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return null;
  }

  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

function parseItemText(itemText: string, requestedSupplierName: string | null, sortOrder: number): ParsedSourceItem {
  const sourceLine = itemText.trim().replace(/\s+/g, " ");
  const quantityMatch = sourceLine.match(new RegExp(`^(.*?)\\s+(\\d+(?:[.,]\\d+)?)\\s*(${unitPattern})$`, "iu"));

  if (!quantityMatch) {
    return {
      sourceLine,
      requestedSupplierName,
      parsedName: sourceLine,
      parsedQuantity: null,
      parsedUnit: null,
      requestedAmount: null,
      sortOrder,
    };
  }

  const parsedName = quantityMatch[1]?.trim() || sourceLine;
  const quantityValue = quantityMatch[2]?.replace(",", ".") ?? "";
  const unitValue = quantityMatch[3] ?? "";
  const numericQuantity = Number(quantityValue);
  const parsedQuantity = Number.isFinite(numericQuantity) ? new Prisma.Decimal(quantityValue) : null;
  const parsedUnit = normalizeOrderOptimizationUnit(unitValue);

  return {
    sourceLine,
    requestedSupplierName,
    parsedName,
    parsedQuantity,
    parsedUnit,
    requestedAmount: calculateRequestedAmount(parsedQuantity, parsedUnit),
    sortOrder,
  };
}

function splitLineIntoItemsWhenSafe(line: string) {
  const commaSeparatedItems = line
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (commaSeparatedItems.length < 2) {
    return [line];
  }

  const everyPartLooksLikeItem = commaSeparatedItems.every((item) =>
    new RegExp(`^.+?\\s+\\d+(?:[.,]\\d+)?\\s*(${unitPattern})$`, "iu").test(item),
  );

  return everyPartLooksLikeItem ? commaSeparatedItems : [line];
}

export function parseOrderOptimizationSourceText(sourceText: string) {
  const parsedItems: ParsedSourceItem[] = [];
  const lines = sourceText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const supplierMatch = line.match(/^([^:]+):\s*(.+)$/u);

    if (supplierMatch) {
      const requestedSupplierName = supplierMatch[1]?.trim() || null;
      const itemsText = supplierMatch[2] ?? "";
      const items = itemsText
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      for (const item of items) {
        parsedItems.push(parseItemText(item, requestedSupplierName, parsedItems.length + 1));
      }

      continue;
    }

    for (const item of splitLineIntoItemsWhenSafe(line)) {
      parsedItems.push(parseItemText(item, null, parsedItems.length + 1));
    }
  }

  return parsedItems;
}

export async function rebuildOrderOptimizationItems(optimizationId: string, enterpriseId?: string) {
  const optimization = await prisma.orderOptimization.findFirst({
    where: {
      id: optimizationId,
      ...(enterpriseId ? { enterpriseId } : {}),
    },
    select: {
      id: true,
      sourceText: true,
    },
  });

  if (!optimization) {
    return null;
  }

  const parsedItems = parseOrderOptimizationSourceText(optimization.sourceText);

  await prisma.$transaction(async (tx) => {
    await tx.orderOptimizationItem.deleteMany({
      where: {
        optimizationId: optimization.id,
      },
    });

    if (parsedItems.length === 0) {
      return;
    }

    await tx.orderOptimizationItem.createMany({
      data: parsedItems.map((item) => ({
        optimizationId: optimization.id,
        sourceLine: item.sourceLine,
        requestedSupplierName: item.requestedSupplierName,
        parsedName: item.parsedName,
        parsedQuantity: item.parsedQuantity?.toString() ?? null,
        parsedUnit: item.parsedUnit,
        requestedAmount: item.requestedAmount?.toString() ?? null,
        selectionMode: null,
        matchStatus: "pending",
        sortOrder: item.sortOrder,
      })),
    });
  });

  return getOrderOptimizationWithDetails(optimization.id, enterpriseId);
}

export function serializeOrderOptimization(optimization: OrderOptimizationWithDetails | OrderOptimization) {
  const maybeDetails = optimization as Partial<OrderOptimizationWithDetails>;
  const baskets = maybeDetails.items ? buildSmartOrderSupplierBaskets(maybeDetails.items) : [];

  return {
    id: optimization.id,
    enterpriseId: optimization.enterpriseId,
    title: optimization.title,
    sourceText: optimization.sourceText,
    baselineTotal: decimalToString(optimization.baselineTotal),
    optimizedTotal: decimalToString(optimization.optimizedTotal),
    savingsAmount: decimalToString(optimization.savingsAmount),
    savingsPercent: decimalToString(optimization.savingsPercent),
    status: optimization.status,
    createdAt: optimization.createdAt,
    updatedAt: optimization.updatedAt,
    items:
      maybeDetails.items?.map((item) => ({
        id: item.id,
        optimizationId: item.optimizationId,
        sourceLine: item.sourceLine,
        requestedSupplierName: item.requestedSupplierName,
        lockSupplier: item.lockSupplier,
        parsedName: item.parsedName,
        parsedQuantity: decimalToString(item.parsedQuantity),
        parsedUnit: item.parsedUnit,
        requestedAmount: decimalToString(item.requestedAmount),
        selectedCandidateId: item.selectedCandidateId,
        selectionMode: (item.selectionMode as OrderOptimizationSelectionMode | null) ?? null,
        matchStatus: item.matchStatus as OrderOptimizationMatchStatus,
        status: getOrderOptimizationItemStatus(item),
        isProblem: isOrderOptimizationItemProblem(item),
        notes: item.notes,
        sortOrder: item.sortOrder,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        results: item.results.map(serializeOrderOptimizationResult),
      })) ?? [],
    results: maybeDetails.results?.map(serializeOrderOptimizationResult) ?? [],
    baskets,
  };
}

export function serializeOrderOptimizationResult(
  result: OrderOptimizationResult & {
    selectedSupplier?: Pick<Supplier, "id" | "name"> | null;
    selectedProduct?: Pick<
      Product,
      "id" | "name" | "article" | "brand" | "unit" | "unitsPerPack" | "minOrderQuantity" | "orderStep"
    > | null;
  },
) {
  return {
    id: result.id,
    optimizationId: result.optimizationId,
    itemId: result.itemId,
    selectedSupplierId: result.selectedSupplierId,
    selectedProductId: result.selectedProductId,
    baselineUnitPrice: decimalToString(result.baselineUnitPrice),
    optimizedUnitPrice: decimalToString(result.optimizedUnitPrice),
    baselineLineTotal: decimalToString(result.baselineLineTotal),
    optimizedLineTotal: decimalToString(result.optimizedLineTotal),
    coverageMode: result.coverageMode,
    coverage:
      result.coverageMode && result.requiredAmount && result.packSize
        ? {
            mode: result.coverageMode,
            requiredAmount: decimalToString(result.requiredAmount),
            packSize: decimalToString(result.packSize),
            suggestedPacksCount: result.suggestedPacksCount,
            totalCoveredAmount: decimalToString(result.totalCoveredAmount),
            overage: decimalToString(result.overage),
            shortage: decimalToString(result.shortage),
          }
        : null,
    isManualOverride: result.isManualOverride,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
    selectedSupplier: result.selectedSupplier ?? null,
    selectedProduct: buildSmartOrderSelectedProductDto(result.selectedProduct),
  };
}

export function getOrderOptimizationWithDetails(optimizationId: string, enterpriseId?: string) {
  return prisma.orderOptimization.findFirst({
    where: {
      id: optimizationId,
      ...(enterpriseId ? { enterpriseId } : {}),
    },
    include: {
      items: {
        include: {
          results: {
            include: {
              selectedSupplier: {
                select: {
                  id: true,
                  name: true,
                  minOrderAmount: true,
                },
              },
              selectedProduct: {
                select: {
                  id: true,
                  name: true,
                  article: true,
                  brand: true,
                  unit: true,
                  unitsPerPack: true,
                  minOrderQuantity: true,
                  orderStep: true,
                },
              },
            },
            orderBy: [{ itemId: "asc" }, { createdAt: "asc" }],
          },
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
      results: {
        include: {
          selectedSupplier: {
            select: {
              id: true,
              name: true,
              minOrderAmount: true,
            },
          },
          selectedProduct: {
            select: {
              id: true,
              name: true,
              article: true,
              brand: true,
              unit: true,
              unitsPerPack: true,
              minOrderQuantity: true,
              orderStep: true,
            },
          },
        },
        orderBy: [{ createdAt: "asc" }],
      },
    },
  });
}
