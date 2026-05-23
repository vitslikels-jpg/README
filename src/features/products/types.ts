export type ProductListItem = {
  id: string;
  enterpriseId: string;
  supplierId: string;
  documentId: string;
  name: string;
  article: string | null;
  brand: string | null;
  country: string | null;
  unit: string | null;
  unitsPerPack: string | null;
  minOrderQuantity: string | null;
  orderStep: string | null;
  allowFractionalOrder: boolean;
  shipByBoxesOnly: boolean;
  price: string | null;
  stock: string | null;
  sourceRow: number;
  rawData?: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
  supplier?: {
    id: string;
    name: string;
    phone?: string | null;
    managerName?: string | null;
    email?: string | null;
    minOrderAmount?: string | null;
  };
  document?: {
    id: string;
    originalFileName: string;
    uploadedAt: string;
    status: "uploaded" | "processing" | "parsed" | "parsed_with_errors" | "failed";
    isCurrent: boolean;
  };
};

export type CatalogProductOffer = {
  id: string;
  name: string;
  article: string | null;
  brand: string | null;
  legacyUnit: string | null;
  unitsPerPack: string | null;
  minOrderQuantity: string | null;
  orderStep: string | null;
  allowFractionalOrder: boolean;
  shipByBoxesOnly: boolean;
  supplier: {
    id: string;
    name: string;
    archivedAt: string | null;
  };
  unit: {
    id: string;
    code: string;
    name: string;
    symbol: string;
  } | null;
  currentPriceSnapshot: {
    id: string;
    price: string | null;
    stock: string | null;
    capturedAt: string;
    document: {
      id: string;
      qualityReport: {
        qualityStatus: "good" | "warning" | "bad";
        usabilityStatus: "usable" | "needs_review" | "blocked";
        usabilityReason: string | null;
      } | null;
    } | null;
  } | null;
  mapping: {
    id: string;
    confidence: string | null;
    matchSource: string | null;
    status: string;
  };
};

export type CatalogProductListItem = {
  id: string;
  enterpriseId: string;
  name: string;
  normalizedName: string;
  brand: string | null;
  category: string | null;
  unit: {
    id: string;
    code: string;
    name: string;
    symbol: string;
  } | null;
  offersCount: number;
  suppliers: Array<{
    id: string;
    name: string;
  }>;
  minCurrentPrice: string | null;
  maxCurrentPrice: string | null;
  bestOffer: CatalogProductOffer | null;
  currentOffers: CatalogProductOffer[];
  hasSimilarUnmappedOffers: boolean;
  similarUnmappedOffersCount: number;
};
