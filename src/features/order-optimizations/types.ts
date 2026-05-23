export type OrderOptimizationStatus = "draft" | "processed";
export type OrderOptimizationSelectionMode = "auto" | "manual" | null;
export type OrderOptimizationItemStatus = "autoselected" | "manual" | "review" | "not_found";

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
