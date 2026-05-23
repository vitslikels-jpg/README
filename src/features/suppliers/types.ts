export type Supplier = {
  id: string;
  enterpriseId: string;
  name: string;
  phone: string | null;
  managerName: string | null;
  email: string | null;
  comment: string | null;
  minOrderAmount: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SupplierDocument = {
  id: string;
  enterpriseId: string;
  supplierId: string;
  type: "price_list";
  sourceFormat: "excel" | "pdf" | "word" | "csv" | "image" | "archive" | "unknown";
  originalFileName: string;
  storedFilePath: string;
  mimeType: string;
  fileSize: number;
  status: "uploaded" | "processing" | "parsed" | "parsed_with_errors" | "failed";
  uploadedAt: string;
  createdAt: string;
  updatedAt: string;
  isCurrent: boolean;
  qualityReport: {
    id: string;
    qualityStatus: "good" | "warning" | "bad";
    usabilityStatus: "usable" | "needs_review" | "blocked";
    usabilityReason: string | null;
    manualReviewStatus: "not_reviewed" | "in_review" | "approved" | "rejected";
    manualReviewComment: string | null;
    manualReviewedAt: string | null;
    manualReviewedBy: string | null;
    totalRows: number;
    parsedProductsCount: number;
    rowsWithoutPrice: number;
    rowsWithoutUnit: number;
    rowsWithoutName: number;
    rowsWithoutArticle: number;
    newSupplierOffersCount: number;
    unmappedOffersCount: number;
    autoMappedOffersCount: number;
    lowConfidenceMappingsCount: number;
    manualMappedOffersCount: number;
    currentPriceSnapshotsCount: number;
    warningMessage: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
};

export type SupplierPayload = {
  enterpriseId: string;
  name: string;
  phone: string;
  managerName: string;
  email: string;
  comment: string;
  minOrderAmount: string;
};

export type SupplierFormValues = {
  name: string;
  phone: string;
  managerName: string;
  email: string;
  comment: string;
  minOrderAmount: string;
};
