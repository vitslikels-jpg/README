export type OrderStatus = "draft" | "submitted" | "cancelled";
export type OrderItemSourceType = "legacy" | "catalog";

export type OrderListItem = {
  id: string;
  enterpriseId: string;
  supplierId: string;
  status: OrderStatus;
  comment: string | null;
  submittedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  total: string;
  itemsCount: number;
  supplier: {
    id: string;
    name: string;
    phone: string | null;
    managerName: string | null;
    email: string | null;
    minOrderAmount: string | null;
  };
  items: OrderItem[];
};

export type OrderItem = {
  id: string;
  orderId: string;
  productId: string | null;
  productMasterId: string | null;
  supplierOfferId: string | null;
  priceSnapshotId: string | null;
  sourceType: OrderItemSourceType;
  displayName: string;
  article: string | null;
  brand: string | null;
  supplierName: string | null;
  quantity: string;
  unit: string | null;
  price: string | null;
  lineTotal: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  product: {
    id: string;
    name: string;
    article: string | null;
    brand: string | null;
  } | null;
  productMaster: {
    id: string;
    name: string;
    brand: string | null;
    category: string | null;
  } | null;
  supplierOffer: {
    id: string;
    name: string;
    article: string | null;
    brand: string | null;
    legacyUnit: string | null;
  } | null;
  priceSnapshot: {
    id: string;
    capturedAt: string;
  } | null;
};
