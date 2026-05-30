export type OrderOptimizationStatus = "draft" | "processed";
export type OrderOptimizationSelectionMode = "auto" | "manual" | null;
export type OrderOptimizationItemStatus = "autoselected" | "manual" | "review" | "not_found";
export type OrderOptimizationParseSource = "regex" | "ai" | "ai_fallback_regex";

export type OrderOptimizationListItem = {
  id: string;
  enterpriseId: string;
  title: string | null;
  sourceText: string;
  baselineTotal: string | null;
  optimizedTotal: string | null;
  savingsAmount: string | null;
  savingsPercent: string | null;
  status: OrderOptimizationStatus;
  createdAt: string;
  updatedAt: string;
  items: OrderOptimizationItem[];
  results: OrderOptimizationResult[];
  baskets: OrderOptimizationSupplierBasket[];
};

export type OrderOptimizationItem = {
  id: string;
  optimizationId: string;
  sourceLine: string;
  requestedSupplierName: string | null;
  lockSupplier: boolean;
  parsedName: string | null;
  parsedQuantity: string | null;
  parsedUnit: string | null;
  requestedAmount: string | null;
  selectedCandidateId: string | null;
  selectionMode: OrderOptimizationSelectionMode;
  matchStatus: "pending" | "review" | "not_found";
  status: OrderOptimizationItemStatus;
  isProblem: boolean;
  parseSource: OrderOptimizationParseSource;
  notes: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  results: OrderOptimizationResult[];
};

export type OrderOptimizationAiSuggestion = {
  suggestedSupplierName: string | null;
  suggestedName: string | null;
  suggestedQuantity: string | null;
  suggestedUnit: string | null;
  explanation: string;
  source: "polza" | "openrouter" | "local";
};

export type SmartOrderAiParseTestItem = {
  originalLine: string;
  parsedName: string | null;
  quantity: string | null;
  unit: string | null;
  requestedSupplierName: string | null;
  brand: string | null;
  attributes: string[];
  comment: string | null;
  confidence: number;
  needsReview: boolean;
  reviewReason: string | null;
};

export type SmartOrderAiParseTestResponse = {
  source: "polza";
  model: string;
  items: SmartOrderAiParseTestItem[];
};

export type SupplierOptimizerPreviewScenarioType =
  | "cheapest"
  | "cheapest_with_min_orders"
  | "minimize_suppliers";

export type SupplierOptimizerPreviewQualityStatus = "excellent" | "warning" | "poor";

export type SupplierOptimizerPreviewUnderMinReason =
  | "no_alternative_candidates"
  | "no_target_supplier_meets_min_order"
  | "partial_transfer_not_allowed"
  | "transfer_would_increase_total_too_much"
  | "unknown";

export type OrderOptimizationResult = {
  id: string;
  optimizationId: string;
  itemId: string;
  selectedSupplierId: string | null;
  selectedProductId: string | null;
  baselineUnitPrice: string | null;
  optimizedUnitPrice: string | null;
  baselineLineTotal: string | null;
  optimizedLineTotal: string | null;
  coverageMode: string | null;
  coverage: {
    mode: string;
    requiredAmount: string | null;
    packSize: string | null;
    suggestedPacksCount: number | null;
    totalCoveredAmount: string | null;
    overage: string | null;
    shortage: string | null;
  } | null;
  isManualOverride: boolean;
  createdAt: string;
  updatedAt: string;
  selectedSupplier: {
    id: string;
    name: string;
  } | null;
  selectedProduct: {
    id: string;
    name: string;
    article: string | null;
    brand: string | null;
    unit: string | null;
    unitsPerPack: string | null;
    minOrderQuantity: string | null;
    orderStep: string | null;
  } | null;
};

export type OrderOptimizationSupplierBasketItem = {
  itemId: string;
  parsedName: string | null;
  selectedProductName: string | null;
  quantity: string | null;
  unit: string | null;
  optimizedLineTotal: string | null;
};

export type OrderOptimizationSupplierBasket = {
  supplierId: string | null;
  supplierName: string;
  items: OrderOptimizationSupplierBasketItem[];
  itemsCount: number;
  total: string;
  minOrderAmount: string | null;
  meetsMinOrder: boolean;
  missingAmount: string;
};

export type SupplierOptimizerPreviewUnderMinSupplier = {
  supplierId: string | null;
  supplierName: string;
  total: string;
  minOrderAmount: string | null;
  missingAmount: string;
  reason: SupplierOptimizerPreviewUnderMinReason;
};

export type SupplierOptimizerPreviewScenarioDiagnostics = {
  underMinSuppliers: SupplierOptimizerPreviewUnderMinSupplier[];
  unresolvedItemsCount: number;
  skippedItemsCount: number;
  explanation: string;
};

export type SupplierOptimizerPreviewScenario = {
  type: SupplierOptimizerPreviewScenarioType;
  total: string;
  supplierCount: number;
  allMinOrdersMet: boolean;
  baskets: OrderOptimizationSupplierBasket[];
  diagnostics: SupplierOptimizerPreviewScenarioDiagnostics;
  totalDeltaVsCheapest: string;
  supplierCountDeltaVsCheapest: number;
  minOrdersMetDeltaVsCheapest: number;
};

export type SupplierOptimizerPreviewResponse = {
  recommendedScenarioType: SupplierOptimizerPreviewScenarioType;
  recommendationReason: string;
  totalItems: number;
  usableItems: number;
  problemItems: number;
  qualityPercent: number;
  qualityStatus: SupplierOptimizerPreviewQualityStatus;
  scenarios: SupplierOptimizerPreviewScenario[];
};
