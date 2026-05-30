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
  matchStatus?: OrderOptimizationMatchStatus;
  notes?: string | null;
  sortOrder: number;
};

export type OrderOptimizationParseSource = "regex" | "ai" | "ai_fallback_regex";

const orderOptimizationParseSourceNotePrefix = "[parse-source]";

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

export type SupplierOptimizerPreviewScenarioType = "cheapest" | "cheapest_with_min_orders" | "minimize_suppliers";

export type SupplierOptimizerPreviewUnderMinReason =
  | "no_alternative_candidates"
  | "no_target_supplier_meets_min_order"
  | "partial_transfer_not_allowed"
  | "transfer_would_increase_total_too_much"
  | "unknown";

export type SupplierOptimizerPreviewUnderMinSupplierDto = {
  supplierId: string | null;
  supplierName: string;
  total: string;
  minOrderAmount: string | null;
  missingAmount: string;
  reason: SupplierOptimizerPreviewUnderMinReason;
};

export type SupplierOptimizerPreviewScenarioDiagnosticsDto = {
  underMinSuppliers: SupplierOptimizerPreviewUnderMinSupplierDto[];
  unresolvedItemsCount: number;
  skippedItemsCount: number;
  explanation: string;
};

export type SupplierOptimizerPreviewScenarioDto = {
  type: SupplierOptimizerPreviewScenarioType;
  total: string;
  supplierCount: number;
  allMinOrdersMet: boolean;
  baskets: SmartOrderSupplierBasketDto[];
  diagnostics: SupplierOptimizerPreviewScenarioDiagnosticsDto;
  totalDeltaVsCheapest: string;
  supplierCountDeltaVsCheapest: number;
  minOrdersMetDeltaVsCheapest: number;
};

type OrderOptimizationParseSourceNotePayload = {
  source: OrderOptimizationParseSource;
  confidence?: number | null;
  needsReview?: boolean;
  reviewReason?: string | null;
  brand?: string | null;
  attributes?: string[];
  comment?: string | null;
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

function splitOrderOptimizationNotes(notes: string | null | undefined) {
  return String(notes ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function readOrderOptimizationParseSource(notes: string | null | undefined): OrderOptimizationParseSource {
  const parseSourceLine = splitOrderOptimizationNotes(notes).find((line) => line.startsWith(orderOptimizationParseSourceNotePrefix));

  if (!parseSourceLine) {
    return "regex";
  }

  const payload = parseSourceLine.slice(orderOptimizationParseSourceNotePrefix.length).trim();

  try {
    const parsed = JSON.parse(payload) as Partial<OrderOptimizationParseSourceNotePayload>;
    const source = parsed.source;

    return source === "ai" || source === "ai_fallback_regex" || source === "regex" ? source : "regex";
  } catch {
    return "regex";
  }
}

export function upsertOrderOptimizationParseSourceNote(
  notes: string | null | undefined,
  payload: OrderOptimizationParseSourceNotePayload,
) {
  const noteLines = splitOrderOptimizationNotes(notes).filter(
    (line) => !line.startsWith(orderOptimizationParseSourceNotePrefix),
  );

  noteLines.push(`${orderOptimizationParseSourceNotePrefix} ${JSON.stringify(payload)}`);
  return noteLines.join("\n");
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

function hasUsableOptimizationResult(
  result:
    | (OrderOptimizationResult & {
        selectedSupplier: Pick<Supplier, "id" | "name" | "minOrderAmount"> | null;
        selectedProduct: Pick<
          Product,
          "id" | "name" | "article" | "brand" | "unit" | "unitsPerPack" | "minOrderQuantity" | "orderStep"
        > | null;
      })
    | null
    | undefined,
) {
  return Boolean(
    result?.selectedSupplierId &&
      result.selectedSupplier?.name &&
      result.selectedProductId &&
      result.optimizedLineTotal &&
      result.optimizedLineTotal.gt(0),
  );
}

function compareOptimizationResultsByPrice(
  left: OrderOptimizationWithDetails["items"][number]["results"][number],
  right: OrderOptimizationWithDetails["items"][number]["results"][number],
) {
  if (left.optimizedLineTotal && right.optimizedLineTotal && !left.optimizedLineTotal.eq(right.optimizedLineTotal)) {
    return left.optimizedLineTotal.lt(right.optimizedLineTotal) ? -1 : 1;
  }

  if (left.optimizedLineTotal && !right.optimizedLineTotal) {
    return -1;
  }

  if (!left.optimizedLineTotal && right.optimizedLineTotal) {
    return 1;
  }

  if (left.coverageMode === "no_shortage" && right.coverageMode !== "no_shortage") {
    return -1;
  }

  if (right.coverageMode === "no_shortage" && left.coverageMode !== "no_shortage") {
    return 1;
  }

  if (left.shortage && right.shortage && !left.shortage.eq(right.shortage)) {
    return left.shortage.lt(right.shortage) ? -1 : 1;
  }

  return left.createdAt.getTime() - right.createdAt.getTime();
}

function buildPreviewOptimizationFromAssignments(
  optimization: OrderOptimizationWithDetails,
  assignments: Map<string, string>,
) {
  const items = optimization.items.map((item) => ({
    ...item,
    selectedCandidateId: assignments.get(item.id) ?? null,
  }));
  const baskets = buildSmartOrderSupplierBaskets(items);
  const total = baskets.reduce((sum, basket) => sum.add(new Prisma.Decimal(basket.total)), new Prisma.Decimal(0));

  return {
    baskets,
    total: decimalToMoneyString(total),
    supplierCount: baskets.length,
    allMinOrdersMet: baskets.every((basket) => basket.meetsMinOrder),
  };
}

function buildCheapestAssignments(optimization: OrderOptimizationWithDetails) {
  const assignments = new Map<string, string>();

  for (const item of optimization.items) {
    const bestResult = item.results
      .filter((result) => hasUsableOptimizationResult(result))
      .sort(compareOptimizationResultsByPrice)[0];

    if (bestResult) {
      assignments.set(item.id, bestResult.id);
    }
  }

  return assignments;
}

function buildMinimizeSuppliersAssignments(optimization: OrderOptimizationWithDetails) {
  const assignments = new Map<string, string>();
  const remainingItemIds = new Set(optimization.items.map((item) => item.id));

  while (remainingItemIds.size > 0) {
    const supplierPlans = new Map<
      string,
      {
        supplierId: string;
        supplierName: string;
        minOrderAmount: Prisma.Decimal | null;
        resultIdsByItemId: Map<string, string>;
        total: Prisma.Decimal;
        noShortageCount: number;
      }
    >();

    for (const item of optimization.items) {
      if (!remainingItemIds.has(item.id)) {
        continue;
      }

      const bestResultBySupplier = new Map<string, OrderOptimizationWithDetails["items"][number]["results"][number]>();

      for (const result of item.results) {
        if (!hasUsableOptimizationResult(result) || !result.selectedSupplierId || !result.selectedSupplier?.name) {
          continue;
        }

        const currentBest = bestResultBySupplier.get(result.selectedSupplierId);

        if (!currentBest || compareOptimizationResultsByPrice(result, currentBest) < 0) {
          bestResultBySupplier.set(result.selectedSupplierId, result);
        }
      }

      for (const result of bestResultBySupplier.values()) {
        const plan = supplierPlans.get(result.selectedSupplierId!) ?? {
          supplierId: result.selectedSupplierId!,
          supplierName: result.selectedSupplier!.name,
          minOrderAmount: result.selectedSupplier!.minOrderAmount ?? null,
          resultIdsByItemId: new Map<string, string>(),
          total: new Prisma.Decimal(0),
          noShortageCount: 0,
        };

        plan.resultIdsByItemId.set(item.id, result.id);
        plan.total = plan.total.add(result.optimizedLineTotal as Prisma.Decimal);

        if (result.coverageMode === "no_shortage") {
          plan.noShortageCount += 1;
        }

        supplierPlans.set(result.selectedSupplierId!, plan);
      }
    }

    const bestSupplierPlan = Array.from(supplierPlans.values()).sort((left, right) => {
      if (left.resultIdsByItemId.size !== right.resultIdsByItemId.size) {
        return right.resultIdsByItemId.size - left.resultIdsByItemId.size;
      }

      if (!left.total.eq(right.total)) {
        return left.total.lt(right.total) ? -1 : 1;
      }

      if (left.noShortageCount !== right.noShortageCount) {
        return right.noShortageCount - left.noShortageCount;
      }

      const leftMissingAmount =
        left.minOrderAmount && left.total.lt(left.minOrderAmount) ? left.minOrderAmount.sub(left.total) : new Prisma.Decimal(0);
      const rightMissingAmount =
        right.minOrderAmount && right.total.lt(right.minOrderAmount)
          ? right.minOrderAmount.sub(right.total)
          : new Prisma.Decimal(0);

      if (!leftMissingAmount.eq(rightMissingAmount)) {
        return leftMissingAmount.lt(rightMissingAmount) ? -1 : 1;
      }

      return left.supplierName.localeCompare(right.supplierName, "ru");
    })[0];

    if (!bestSupplierPlan || bestSupplierPlan.resultIdsByItemId.size === 0) {
      break;
    }

    for (const [itemId, resultId] of bestSupplierPlan.resultIdsByItemId.entries()) {
      assignments.set(itemId, resultId);
      remainingItemIds.delete(itemId);
    }
  }

  return assignments;
}

function buildSkippedItemsCount(optimization: OrderOptimizationWithDetails) {
  return optimization.items.filter((item) => item.results.filter((result) => hasUsableOptimizationResult(result)).length === 0).length;
}

function findOptimizationResultById(optimization: OrderOptimizationWithDetails, resultId: string) {
  for (const item of optimization.items) {
    const found = item.results.find((result) => result.id === resultId);

    if (found) {
      return found;
    }
  }

  return null;
}

function getAlternativeCandidatesForBasketItem(params: {
  item: OrderOptimizationWithDetails["items"][number];
  sourceSupplierId: string | null;
  destinationSupplierIds: Set<string>;
}) {
  return params.item.results
    .filter(
      (result) =>
        hasUsableOptimizationResult(result) &&
        result.selectedSupplierId !== params.sourceSupplierId &&
        result.selectedSupplierId &&
        params.destinationSupplierIds.has(result.selectedSupplierId),
    )
    .sort(compareOptimizationResultsByPrice);
}

function buildScenarioDiagnostics(params: {
  optimization: OrderOptimizationWithDetails;
  type: SupplierOptimizerPreviewScenarioType;
  assignments: Map<string, string>;
  baskets: SmartOrderSupplierBasketDto[];
  cheapestTotal: Prisma.Decimal;
  cheapestSupplierCount: number;
  cheapestAllMinOrdersMet: boolean;
  underMinReasons?: Map<string, SupplierOptimizerPreviewUnderMinReason>;
}) {
  const currentTotal = params.baskets.reduce((sum, basket) => sum.add(new Prisma.Decimal(basket.total)), new Prisma.Decimal(0));
  const skippedItemsCount = buildSkippedItemsCount(params.optimization);
  const unresolvedItemsCount = params.optimization.items.length - params.assignments.size;
  const underMinSuppliers = params.baskets
    .filter((basket) => !basket.meetsMinOrder)
    .map((basket) => ({
      supplierId: basket.supplierId,
      supplierName: basket.supplierName,
      total: basket.total,
      minOrderAmount: basket.minOrderAmount,
      missingAmount: basket.missingAmount,
      reason: basket.supplierId ? params.underMinReasons?.get(basket.supplierId) ?? "unknown" : "unknown",
    }));

  const explanation =
    params.type === "cheapest"
      ? "Локально самый дешёвый candidate по каждой позиции без учёта минималок поставщиков."
      : params.type === "minimize_suppliers"
        ? "Жадно выбирает поставщика, который закрывает максимум оставшихся позиций. При равенстве: ниже total, больше no_shortage, меньше missingAmount."
      : underMinSuppliers.length === 0
        ? "Минималки выполнены или under-min корзины удалось убрать полным переносом позиций."
        : "Минималки не выполнены: текущий greedy пытается переносить только корзину целиком в уже подходящих поставщиков.";

  return {
    diagnostics: {
      underMinSuppliers,
      unresolvedItemsCount,
      skippedItemsCount,
      explanation,
    },
    totalDeltaVsCheapest: decimalToMoneyString(currentTotal.sub(params.cheapestTotal)),
    supplierCountDeltaVsCheapest: params.baskets.length - params.cheapestSupplierCount,
    minOrdersMetDeltaVsCheapest:
      Number(params.baskets.every((basket) => basket.meetsMinOrder)) - Number(params.cheapestAllMinOrdersMet),
  };
}

function buildCheapestWithMinOrdersAssignments(optimization: OrderOptimizationWithDetails) {
  const assignments = buildCheapestAssignments(optimization);
  const underMinReasons = new Map<string, SupplierOptimizerPreviewUnderMinReason>();

  while (true) {
    const currentPreview = buildPreviewOptimizationFromAssignments(optimization, assignments);
    const failingBaskets = currentPreview.baskets
      .filter((basket) => !basket.meetsMinOrder && basket.supplierId)
      .sort((left, right) => Number(right.missingAmount) - Number(left.missingAmount));

    if (failingBaskets.length === 0) {
      break;
    }

    let changed = false;

    for (const basket of failingBaskets) {
      const basketItemIds = new Set(basket.items.map((item) => item.itemId));
      const destinationSupplierIds = new Set(
        currentPreview.baskets
          .filter(
            (candidateBasket) =>
              candidateBasket.supplierId &&
              candidateBasket.supplierId !== basket.supplierId &&
              (candidateBasket.meetsMinOrder || !candidateBasket.minOrderAmount),
          )
          .map((candidateBasket) => candidateBasket.supplierId as string),
      );

      if (destinationSupplierIds.size === 0) {
        if (basket.supplierId) {
          underMinReasons.set(basket.supplierId, "no_target_supplier_meets_min_order");
        }
        continue;
      }

      const movePlan = new Map<string, string>();
      let canMoveWholeBasket = true;
      let hasAlternativeForAnyItem = false;
      let transferIncrease = new Prisma.Decimal(0);

      for (const item of optimization.items) {
        if (!basketItemIds.has(item.id)) {
          continue;
        }

        const alternatives = getAlternativeCandidatesForBasketItem({
          item,
          sourceSupplierId: basket.supplierId,
          destinationSupplierIds,
        });
        const alternative = alternatives[0];

        if (alternatives.length > 0) {
          hasAlternativeForAnyItem = true;
        }

        if (!alternative) {
          canMoveWholeBasket = false;
          break;
        }

        const currentResult = item.selectedCandidateId ? findOptimizationResultById(optimization, item.selectedCandidateId) : null;

        if (currentResult?.optimizedLineTotal && alternative.optimizedLineTotal) {
          transferIncrease = transferIncrease.add(alternative.optimizedLineTotal.sub(currentResult.optimizedLineTotal));
        }

        movePlan.set(item.id, alternative.id);
      }

      if (!canMoveWholeBasket || movePlan.size === 0) {
        if (basket.supplierId) {
          underMinReasons.set(
            basket.supplierId,
            hasAlternativeForAnyItem ? "partial_transfer_not_allowed" : "no_alternative_candidates",
          );
        }
        continue;
      }

      const currentBasketMissingAmount = new Prisma.Decimal(basket.missingAmount);

      if (transferIncrease.gt(currentBasketMissingAmount)) {
        if (basket.supplierId) {
          underMinReasons.set(basket.supplierId, "transfer_would_increase_total_too_much");
        }
        continue;
      }

      for (const [itemId, resultId] of movePlan.entries()) {
        assignments.set(itemId, resultId);
      }

      if (basket.supplierId) {
        underMinReasons.delete(basket.supplierId);
      }

      changed = true;
      break;
    }

    if (!changed) {
      break;
    }
  }

  return {
    assignments,
    underMinReasons,
  };
}

export function buildSupplierOptimizerPreview(optimization: OrderOptimizationWithDetails): {
  scenarios: SupplierOptimizerPreviewScenarioDto[];
} {
  const cheapestAssignments = buildCheapestAssignments(optimization);
  const cheapestPreview = buildPreviewOptimizationFromAssignments(optimization, cheapestAssignments);
  const cheapestWithMinOrders = buildCheapestWithMinOrdersAssignments(optimization);
  const cheapestWithMinOrdersPreview = buildPreviewOptimizationFromAssignments(
    optimization,
    cheapestWithMinOrders.assignments,
  );
  const minimizeSuppliersAssignments = buildMinimizeSuppliersAssignments(optimization);
  const minimizeSuppliersPreview = buildPreviewOptimizationFromAssignments(optimization, minimizeSuppliersAssignments);
  const cheapestTotalDecimal = new Prisma.Decimal(cheapestPreview.total);

  return {
    scenarios: [
      {
        type: "cheapest",
        total: cheapestPreview.total,
        supplierCount: cheapestPreview.supplierCount,
        allMinOrdersMet: cheapestPreview.allMinOrdersMet,
        baskets: cheapestPreview.baskets,
        ...buildScenarioDiagnostics({
          optimization,
          type: "cheapest",
          assignments: cheapestAssignments,
          baskets: cheapestPreview.baskets,
          cheapestTotal: cheapestTotalDecimal,
          cheapestSupplierCount: cheapestPreview.supplierCount,
          cheapestAllMinOrdersMet: cheapestPreview.allMinOrdersMet,
        }),
      },
      {
        type: "cheapest_with_min_orders",
        total: cheapestWithMinOrdersPreview.total,
        supplierCount: cheapestWithMinOrdersPreview.supplierCount,
        allMinOrdersMet: cheapestWithMinOrdersPreview.allMinOrdersMet,
        baskets: cheapestWithMinOrdersPreview.baskets,
        ...buildScenarioDiagnostics({
          optimization,
          type: "cheapest_with_min_orders",
          assignments: cheapestWithMinOrders.assignments,
          baskets: cheapestWithMinOrdersPreview.baskets,
          cheapestTotal: cheapestTotalDecimal,
          cheapestSupplierCount: cheapestPreview.supplierCount,
          cheapestAllMinOrdersMet: cheapestPreview.allMinOrdersMet,
          underMinReasons: cheapestWithMinOrders.underMinReasons,
        }),
      },
      {
        type: "minimize_suppliers",
        total: minimizeSuppliersPreview.total,
        supplierCount: minimizeSuppliersPreview.supplierCount,
        allMinOrdersMet: minimizeSuppliersPreview.allMinOrdersMet,
        baskets: minimizeSuppliersPreview.baskets,
        ...buildScenarioDiagnostics({
          optimization,
          type: "minimize_suppliers",
          assignments: minimizeSuppliersAssignments,
          baskets: minimizeSuppliersPreview.baskets,
          cheapestTotal: cheapestTotalDecimal,
          cheapestSupplierCount: cheapestPreview.supplierCount,
          cheapestAllMinOrdersMet: cheapestPreview.allMinOrdersMet,
        }),
      },
    ],
  };
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

export async function rebuildOrderOptimizationItems(
  optimizationId: string,
  enterpriseId?: string,
  options?: {
    parsedItems?: ParsedSourceItem[];
    parseSource?: OrderOptimizationParseSource;
  },
) {
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

  const parsedItems = options?.parsedItems ?? parseOrderOptimizationSourceText(optimization.sourceText);
  const parseSource = options?.parseSource ?? "regex";

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
        matchStatus: item.matchStatus ?? "pending",
        notes: upsertOrderOptimizationParseSourceNote(item.notes, {
          source: parseSource,
        }),
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
        parseSource: readOrderOptimizationParseSource(item.notes),
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
