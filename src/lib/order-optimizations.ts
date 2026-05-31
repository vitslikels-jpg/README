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
  transferredItemsCount: number;
  closedUnderMinSuppliersCount: number;
  totalIncreasePercent: number;
  transferActions: Array<{
    itemId: string;
    parsedName: string | null;
    fromSupplierName: string;
    toSupplierName: string;
    costDelta: string;
  }>;
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

export type SupplierOptimizerPreviewRecommendationDto = {
  recommendedScenarioType: SupplierOptimizerPreviewScenarioType;
  recommendationReason: string;
};

export type SupplierOptimizerPreviewQualityStatus = "excellent" | "warning" | "poor";

export type SupplierOptimizerPreviewQualityDto = {
  totalItems: number;
  usableItems: number;
  problemItems: number;
  qualityPercent: number;
  qualityStatus: SupplierOptimizerPreviewQualityStatus;
};

export type CandidatePoolHealthProblemLevel = "ok" | "weak" | "poor" | "empty";

export type CandidatePoolHealthItemAlternativeSupplierDto = {
  supplierName: string;
  lineTotal: string | null;
  coverageMode: string | null;
  wouldMeetMinOrder: boolean;
};

export type CandidatePoolHealthItemDto = {
  itemId: string;
  parsedName: string | null;
  sourceLine: string;
  matchStatus: OrderOptimizationMatchStatus;
  selectedCandidateId: string | null;
  candidatesCount: number;
  suppliersCount: number;
  candidatesWithPriceCount: number;
  noShortageCandidatesCount: number;
  selectedSupplierName: string | null;
  cheapestSupplierName: string | null;
  problemLevel: CandidatePoolHealthProblemLevel;
  reasons: string[];
  alternativeSuppliers: CandidatePoolHealthItemAlternativeSupplierDto[];
};

export type CandidatePoolHealthSummaryDto = {
  totalItems: number;
  okItems: number;
  weakItems: number;
  poorItems: number;
  emptyItems: number;
  avgCandidatesPerItem: number;
  avgSuppliersPerItem: number;
  topProblemItems: CandidatePoolHealthItemDto[];
};

export type CandidatePoolHealthReportDto = {
  summary: CandidatePoolHealthSummaryDto;
  items: CandidatePoolHealthItemDto[];
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

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

function getCandidatePoolHealthProblemLevel(
  candidatesCount: number,
  suppliersCount: number,
  candidatesWithPriceCount: number,
  noShortageCandidatesCount: number,
): CandidatePoolHealthProblemLevel {
  if (candidatesCount === 0) {
    return "empty";
  }

  if (suppliersCount === 0 || candidatesWithPriceCount === 0) {
    return "poor";
  }

  if (suppliersCount === 1 || noShortageCandidatesCount === 0) {
    return "weak";
  }

  return "ok";
}

function getCandidatePoolHealthReasons(params: {
  item: OrderOptimizationWithDetails["items"][number];
  candidatesCount: number;
  suppliersCount: number;
  candidatesWithPriceCount: number;
  noShortageCandidatesCount: number;
  selectedSupplierName: string | null;
}) {
  const reasons: string[] = [];

  if (params.item.matchStatus === "not_found") {
    reasons.push("match_not_found");
  }

  if (params.candidatesCount === 0) {
    reasons.push("no_candidates");
    return reasons;
  }

  if (params.suppliersCount === 0) {
    reasons.push("no_suppliers");
  }

  if (params.candidatesWithPriceCount === 0) {
    reasons.push("no_price_candidates");
  }

  if (params.suppliersCount === 1) {
    reasons.push("single_supplier_pool");
  }

  if (params.noShortageCandidatesCount === 0) {
    reasons.push("no_no_shortage_candidates");
  }

  if (!params.item.selectedCandidateId) {
    reasons.push("no_selected_candidate");
  }

  if (!params.selectedSupplierName && params.item.selectedCandidateId) {
    reasons.push("selected_candidate_without_supplier");
  }

  return reasons;
}

function compareCandidatePoolProblemItems(left: CandidatePoolHealthItemDto, right: CandidatePoolHealthItemDto) {
  const problemLevelRank: Record<CandidatePoolHealthProblemLevel, number> = {
    empty: 3,
    poor: 2,
    weak: 1,
    ok: 0,
  };

  if (problemLevelRank[left.problemLevel] !== problemLevelRank[right.problemLevel]) {
    return problemLevelRank[right.problemLevel] - problemLevelRank[left.problemLevel];
  }

  if (left.suppliersCount !== right.suppliersCount) {
    return left.suppliersCount - right.suppliersCount;
  }

  if (left.candidatesCount !== right.candidatesCount) {
    return left.candidatesCount - right.candidatesCount;
  }

  return (left.parsedName ?? "").localeCompare(right.parsedName ?? "", "ru");
}

export function buildCandidatePoolHealthReport(optimization: OrderOptimizationWithDetails): CandidatePoolHealthReportDto {
  const currentBaskets = buildSmartOrderSupplierBaskets(optimization.items);
  const basketBySupplierId = new Map(
    currentBaskets.filter((basket) => basket.supplierId).map((basket) => [basket.supplierId as string, basket]),
  );

  const items = optimization.items.map((item) => {
    const suppliers = new Map<string, string>();
    let candidatesWithPriceCount = 0;
    let noShortageCandidatesCount = 0;

    for (const result of item.results) {
      if (result.selectedSupplierId && result.selectedSupplier?.name) {
        suppliers.set(result.selectedSupplierId, result.selectedSupplier.name);
      }

      if (result.optimizedLineTotal && result.optimizedLineTotal.gt(0)) {
        candidatesWithPriceCount += 1;
      }

      if (result.coverageMode === "no_shortage") {
        noShortageCandidatesCount += 1;
      }
    }

    const selectedResult = item.selectedCandidateId ? item.results.find((result) => result.id === item.selectedCandidateId) ?? null : null;
    const selectedSupplierName = selectedResult?.selectedSupplier?.name ?? null;
    const cheapestResult = item.results
      .filter((result) => hasUsableOptimizationResult(result))
      .sort(compareOptimizationResultsByPrice)[0];
    const cheapestSupplierName = cheapestResult?.selectedSupplier?.name ?? null;
    const alternativeSuppliers = item.results
      .filter(
        (result) =>
          hasUsableOptimizationResult(result) &&
          result.selectedSupplier?.name &&
          (!selectedResult?.selectedSupplierId || result.selectedSupplierId !== selectedResult.selectedSupplierId),
      )
      .sort(compareOptimizationResultsByPrice)
      .map((result) => {
        const supplierBasket = result.selectedSupplierId ? basketBySupplierId.get(result.selectedSupplierId) ?? null : null;
        const basketTotal = supplierBasket ? new Prisma.Decimal(supplierBasket.total) : new Prisma.Decimal(0);
        const candidateLineTotal = result.optimizedLineTotal ?? new Prisma.Decimal(0);
        const nextTotal = basketTotal.add(candidateLineTotal);
        const minOrderAmount = result.selectedSupplier?.minOrderAmount ?? null;

        return {
          supplierName: result.selectedSupplier!.name,
          lineTotal: decimalToString(result.optimizedLineTotal),
          coverageMode: result.coverageMode ?? null,
          wouldMeetMinOrder: !minOrderAmount || nextTotal.gte(minOrderAmount),
        };
      });
    const candidatesCount = item.results.length;
    const suppliersCount = suppliers.size;
    const problemLevel = getCandidatePoolHealthProblemLevel(
      candidatesCount,
      suppliersCount,
      candidatesWithPriceCount,
      noShortageCandidatesCount,
    );
    const reasons = getCandidatePoolHealthReasons({
      item,
      candidatesCount,
      suppliersCount,
      candidatesWithPriceCount,
      noShortageCandidatesCount,
      selectedSupplierName,
    });

    return {
      itemId: item.id,
      parsedName: item.parsedName,
      sourceLine: item.sourceLine,
      matchStatus: item.matchStatus,
      selectedCandidateId: item.selectedCandidateId,
      candidatesCount,
      suppliersCount,
      candidatesWithPriceCount,
      noShortageCandidatesCount,
      selectedSupplierName,
      cheapestSupplierName,
      problemLevel,
      reasons,
      alternativeSuppliers,
    };
  });

  const totalItems = items.length;
  const okItems = items.filter((item) => item.problemLevel === "ok").length;
  const weakItems = items.filter((item) => item.problemLevel === "weak").length;
  const poorItems = items.filter((item) => item.problemLevel === "poor").length;
  const emptyItems = items.filter((item) => item.problemLevel === "empty").length;

  return {
    summary: {
      totalItems,
      okItems,
      weakItems,
      poorItems,
      emptyItems,
      avgCandidatesPerItem: totalItems > 0 ? roundToTwo(items.reduce((sum, item) => sum + item.candidatesCount, 0) / totalItems) : 0,
      avgSuppliersPerItem: totalItems > 0 ? roundToTwo(items.reduce((sum, item) => sum + item.suppliersCount, 0) / totalItems) : 0,
      topProblemItems: [...items]
        .filter((item) => item.problemLevel !== "ok")
        .sort(compareCandidatePoolProblemItems)
        .slice(0, 10),
    },
    items,
  };
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

function getAssignedResultForItem(
  optimization: OrderOptimizationWithDetails,
  assignments: Map<string, string>,
  itemId: string,
) {
  const resultId = assignments.get(itemId);

  return resultId ? findOptimizationResultById(optimization, resultId) : null;
}

function countUnderMinSuppliers(baskets: SmartOrderSupplierBasketDto[]) {
  return baskets.filter((basket) => !basket.meetsMinOrder).length;
}

function countMetMinSuppliers(baskets: SmartOrderSupplierBasketDto[]) {
  return baskets.filter((basket) => basket.meetsMinOrder).length;
}

function calculateTotalIncreasePercent(total: Prisma.Decimal, cheapestTotal: Prisma.Decimal) {
  if (cheapestTotal.lte(0)) {
    return 0;
  }

  return Number(total.sub(cheapestTotal).div(cheapestTotal).mul(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP));
}

function comparePreviewCandidateMetrics(
  left: {
    baskets: SmartOrderSupplierBasketDto[];
    total: Prisma.Decimal;
    totalIncreasePercent: number;
  },
  right: {
    baskets: SmartOrderSupplierBasketDto[];
    total: Prisma.Decimal;
    totalIncreasePercent: number;
  },
) {
  const leftAllMin = Number(left.baskets.every((basket) => basket.meetsMinOrder));
  const rightAllMin = Number(right.baskets.every((basket) => basket.meetsMinOrder));

  if (leftAllMin !== rightAllMin) {
    return leftAllMin > rightAllMin ? 1 : -1;
  }

  const leftMetCount = countMetMinSuppliers(left.baskets);
  const rightMetCount = countMetMinSuppliers(right.baskets);

  if (leftMetCount !== rightMetCount) {
    return leftMetCount > rightMetCount ? 1 : -1;
  }

  const leftUnderMinCount = countUnderMinSuppliers(left.baskets);
  const rightUnderMinCount = countUnderMinSuppliers(right.baskets);

  if (leftUnderMinCount !== rightUnderMinCount) {
    return leftUnderMinCount < rightUnderMinCount ? 1 : -1;
  }

  if (left.baskets.length !== right.baskets.length) {
    return left.baskets.length < right.baskets.length ? 1 : -1;
  }

  if (left.totalIncreasePercent !== right.totalIncreasePercent) {
    return left.totalIncreasePercent < right.totalIncreasePercent ? 1 : -1;
  }

  if (!left.total.eq(right.total)) {
    return left.total.lt(right.total) ? 1 : -1;
  }

  return 0;
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
  transferredItemsCount?: number;
  closedUnderMinSuppliersCount?: number;
  transferActions?: Array<{
    itemId: string;
    parsedName: string | null;
    fromSupplierName: string;
    toSupplierName: string;
    costDelta: string;
  }>;
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
      transferredItemsCount: params.transferredItemsCount ?? 0,
      closedUnderMinSuppliersCount: params.closedUnderMinSuppliersCount ?? 0,
      totalIncreasePercent: calculateTotalIncreasePercent(currentTotal, params.cheapestTotal),
      transferActions: params.transferActions ?? [],
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
  const cheapestPreview = buildPreviewOptimizationFromAssignments(optimization, assignments);
  const cheapestTotal = new Prisma.Decimal(cheapestPreview.total);
  const totalLimit = cheapestTotal.mul(1.2);
  const initialUnderMinSuppliersCount = countUnderMinSuppliers(cheapestPreview.baskets);
  const underMinReasons = new Map<string, SupplierOptimizerPreviewUnderMinReason>();
  const transferActions: Array<{
    itemId: string;
    parsedName: string | null;
    fromSupplierName: string;
    toSupplierName: string;
    costDelta: string;
  }> = [];

  while (true) {
    const currentPreview = buildPreviewOptimizationFromAssignments(optimization, assignments);
    const currentTotal = new Prisma.Decimal(currentPreview.total);
    const currentMetrics = {
      baskets: currentPreview.baskets,
      total: currentTotal,
      totalIncreasePercent: calculateTotalIncreasePercent(currentTotal, cheapestTotal),
    };
    const failingBaskets = currentPreview.baskets
      .filter((basket) => !basket.meetsMinOrder && basket.supplierId)
      .sort((left, right) => Number(right.missingAmount) - Number(left.missingAmount));

    if (failingBaskets.length === 0) {
      break;
    }

    let bestProposal:
      | {
          itemId: string;
          resultId: string;
          sourceSupplierId: string;
          sourceSupplierName: string;
          targetSupplierName: string;
          preview: ReturnType<typeof buildPreviewOptimizationFromAssignments>;
          total: Prisma.Decimal;
          totalIncreasePercent: number;
          costDelta: Prisma.Decimal;
        }
      | null = null;

    for (const basket of failingBaskets) {
      for (const basketItem of basket.items) {
        const item = optimization.items.find((candidateItem) => candidateItem.id === basketItem.itemId);

        if (!item) {
          continue;
        }

        const currentResult = getAssignedResultForItem(optimization, assignments, item.id);

        if (!hasUsableOptimizationResult(currentResult)) {
          continue;
        }

        const assignedCurrentResult = currentResult as NonNullable<typeof currentResult>;
        const currentSupplierId = assignedCurrentResult.selectedSupplierId as string;
        const currentSupplierName = assignedCurrentResult.selectedSupplier!.name;
        const currentLineTotal = assignedCurrentResult.optimizedLineTotal as Prisma.Decimal;

        const alternatives = item.results
          .filter(
            (result) =>
              hasUsableOptimizationResult(result) &&
              result.selectedSupplierId &&
              result.selectedSupplierId !== currentSupplierId,
          )
          .sort(compareOptimizationResultsByPrice);

        if (alternatives.length === 0) {
          underMinReasons.set(basket.supplierId!, "no_alternative_candidates");
          continue;
        }

        let foundWithinLimit = false;

        for (const alternative of alternatives) {
          if (!alternative.optimizedLineTotal || !alternative.selectedSupplier?.name) {
            continue;
          }

          const nextAssignments = new Map(assignments);
          nextAssignments.set(item.id, alternative.id);
          const nextPreview = buildPreviewOptimizationFromAssignments(optimization, nextAssignments);
          const nextTotal = new Prisma.Decimal(nextPreview.total);

          if (nextTotal.gt(totalLimit)) {
            continue;
          }

          foundWithinLimit = true;
          const candidateMetrics = {
            baskets: nextPreview.baskets,
            total: nextTotal,
            totalIncreasePercent: calculateTotalIncreasePercent(nextTotal, cheapestTotal),
          };

          if (comparePreviewCandidateMetrics(candidateMetrics, currentMetrics) <= 0) {
            continue;
          }

          const costDelta = alternative.optimizedLineTotal.sub(currentLineTotal);

          if (
            !bestProposal ||
            comparePreviewCandidateMetrics(candidateMetrics, {
              baskets: bestProposal.preview.baskets,
              total: bestProposal.total,
              totalIncreasePercent: bestProposal.totalIncreasePercent,
            }) > 0 ||
            (comparePreviewCandidateMetrics(candidateMetrics, {
              baskets: bestProposal.preview.baskets,
              total: bestProposal.total,
              totalIncreasePercent: bestProposal.totalIncreasePercent,
            }) === 0 &&
              costDelta.lt(bestProposal.costDelta))
          ) {
            bestProposal = {
              itemId: item.id,
              resultId: alternative.id,
              sourceSupplierId: currentSupplierId,
              sourceSupplierName: currentSupplierName,
              targetSupplierName: alternative.selectedSupplier.name,
              preview: nextPreview,
              total: nextTotal,
              totalIncreasePercent: candidateMetrics.totalIncreasePercent,
              costDelta,
            };
          }
        }

        if (!foundWithinLimit) {
          underMinReasons.set(basket.supplierId!, "transfer_would_increase_total_too_much");
        }
      }
    }

    if (!bestProposal) {
      break;
    }

    assignments.set(bestProposal.itemId, bestProposal.resultId);
    underMinReasons.delete(bestProposal.sourceSupplierId);

    const movedItem = optimization.items.find((item) => item.id === bestProposal.itemId);

    transferActions.push({
      itemId: bestProposal.itemId,
      parsedName: movedItem?.parsedName ?? null,
      fromSupplierName: bestProposal.sourceSupplierName,
      toSupplierName: bestProposal.targetSupplierName,
      costDelta: decimalToMoneyString(bestProposal.costDelta),
    });
  }

  const finalPreview = buildPreviewOptimizationFromAssignments(optimization, assignments);

  for (const basket of finalPreview.baskets.filter((candidateBasket) => !candidateBasket.meetsMinOrder && candidateBasket.supplierId)) {
    if (underMinReasons.has(basket.supplierId!)) {
      continue;
    }

    const basketItemIds = new Set(basket.items.map((item) => item.itemId));
    let hasAlternative = false;
    let hasMoveWithinLimit = false;

    for (const item of optimization.items) {
      if (!basketItemIds.has(item.id)) {
        continue;
      }

      const currentResult = getAssignedResultForItem(optimization, assignments, item.id);

      if (!hasUsableOptimizationResult(currentResult)) {
        continue;
      }

      const assignedCurrentResult = currentResult as NonNullable<typeof currentResult>;

      const alternatives = item.results.filter(
        (result) =>
          hasUsableOptimizationResult(result) &&
          result.selectedSupplierId &&
          result.selectedSupplierId !== assignedCurrentResult.selectedSupplierId,
      );

      if (alternatives.length > 0) {
        hasAlternative = true;
      }

      for (const alternative of alternatives) {
        const nextAssignments = new Map(assignments);
        nextAssignments.set(item.id, alternative.id);
        const nextPreview = buildPreviewOptimizationFromAssignments(optimization, nextAssignments);
        const nextTotal = new Prisma.Decimal(nextPreview.total);

        if (!nextTotal.gt(totalLimit)) {
          hasMoveWithinLimit = true;
          break;
        }
      }

      if (hasMoveWithinLimit) {
        break;
      }
    }

    if (!hasAlternative) {
      underMinReasons.set(basket.supplierId!, "no_alternative_candidates");
    } else if (!hasMoveWithinLimit) {
      underMinReasons.set(basket.supplierId!, "transfer_would_increase_total_too_much");
    } else {
      const hasTargetMeetingMin = finalPreview.baskets.some(
        (candidateBasket) =>
          candidateBasket.supplierId &&
          candidateBasket.supplierId !== basket.supplierId &&
          candidateBasket.meetsMinOrder,
      );

      underMinReasons.set(
        basket.supplierId!,
        hasTargetMeetingMin ? "partial_transfer_not_allowed" : "no_target_supplier_meets_min_order",
      );
    }
  }

  return {
    assignments,
    underMinReasons,
    transferredItemsCount: transferActions.length,
    closedUnderMinSuppliersCount: Math.max(initialUnderMinSuppliersCount - countUnderMinSuppliers(finalPreview.baskets), 0),
    transferActions,
  };
}

export function buildSupplierOptimizerPreview(optimization: OrderOptimizationWithDetails): {
  scenarios: SupplierOptimizerPreviewScenarioDto[];
} & SupplierOptimizerPreviewRecommendationDto &
  SupplierOptimizerPreviewQualityDto {
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
  const totalItems = optimization.items.length;
  const usableItems = optimization.items.reduce((count, item) => {
    const selectedResult = item.selectedCandidateId ? findOptimizationResultById(optimization, item.selectedCandidateId) : null;

    if (
      item.selectedCandidateId &&
      item.matchStatus !== "not_found" &&
      selectedResult?.selectedSupplierId &&
      selectedResult.optimizedLineTotal
    ) {
      return count + 1;
    }

    return count;
  }, 0);
  const problemItems = Math.max(totalItems - usableItems, 0);
  const qualityPercent = totalItems > 0 ? Math.round((usableItems / totalItems) * 100) : 0;
  const qualityStatus: SupplierOptimizerPreviewQualityStatus =
    qualityPercent >= 90 ? "excellent" : qualityPercent >= 70 ? "warning" : "poor";
  const cheapestWithMinOrdersDeltaRatio =
    Number(cheapestWithMinOrdersPreview.total) > 0 && Number(cheapestPreview.total) > 0
      ? (Number(cheapestWithMinOrdersPreview.total) - Number(cheapestPreview.total)) / Number(cheapestPreview.total)
      : Number.POSITIVE_INFINITY;
  const minimizeSuppliersDeltaRatio =
    Number(minimizeSuppliersPreview.total) > 0 && Number(cheapestPreview.total) > 0
      ? (Number(minimizeSuppliersPreview.total) - Number(cheapestPreview.total)) / Number(cheapestPreview.total)
      : Number.POSITIVE_INFINITY;

  let recommendedScenarioType: SupplierOptimizerPreviewScenarioType = "cheapest";
  let recommendationReason = "Самый дешёвый, но есть поставщики ниже минималки";

  if (cheapestPreview.allMinOrdersMet) {
    recommendedScenarioType = "cheapest";
    recommendationReason = "Самый дешёвый вариант, минималки выполнены";
  } else if (cheapestWithMinOrdersPreview.allMinOrdersMet && cheapestWithMinOrdersDeltaRatio <= 0.1) {
    recommendedScenarioType = "cheapest_with_min_orders";
    recommendationReason = "Немного дороже, но выполняет минималки";
  } else if (minimizeSuppliersPreview.allMinOrdersMet && minimizeSuppliersDeltaRatio <= 0.25) {
    recommendedScenarioType = "minimize_suppliers";
    recommendationReason = "Меньше поставщиков, но цена выше";
  }

  return {
    recommendedScenarioType,
    recommendationReason,
    totalItems,
    usableItems,
    problemItems,
    qualityPercent,
    qualityStatus,
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
          transferredItemsCount: cheapestWithMinOrders.transferredItemsCount,
          closedUnderMinSuppliersCount: cheapestWithMinOrders.closedUnderMinSuppliersCount,
          transferActions: cheapestWithMinOrders.transferActions,
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
