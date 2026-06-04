import { Prisma } from "@prisma/client";

type DecimalLike = Prisma.Decimal | number | string | null | undefined;

type SupplierOfferPriceContext = {
  unitsPerPack?: Prisma.Decimal | null;
  legacyUnit?: string | null;
} | null;

type PriceSnapshotContext = {
  legacyUnit?: string | null;
  supplierOffer?: SupplierOfferPriceContext;
} | null;

type ProductPriceContext = {
  name?: string | null;
  price?: Prisma.Decimal | null;
  unit?: string | null;
  unitsPerPack?: Prisma.Decimal | null;
  rawData?: Prisma.JsonValue | null;
  priceSnapshots?: PriceSnapshotContext[] | null;
};

type InvoicePriceItemContext = {
  productNameRaw: string;
  unit?: string | null;
  priceWithVat?: Prisma.Decimal | null;
};

export type InvoicePriceComparisonResult = {
  canCompare: boolean;
  changed: boolean;
  needsReview: boolean;
  reason: string | null;
  oldPrice: Prisma.Decimal | null;
  newPrice: Prisma.Decimal | null;
  invoicePrice: Prisma.Decimal | null;
  normalized: boolean;
  normalizationMode: "direct" | "invoice_unit_to_pack" | "invoice_pack_to_unit" | null;
  packSize: Prisma.Decimal | null;
};

const ONE = new Prisma.Decimal(1);

function toDecimal(value: DecimalLike) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  try {
    return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  } catch {
    return null;
  }
}

function roundMoney(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2);
}

function roundPackSize(value: Prisma.Decimal) {
  return value.toDecimalPlaces(3);
}

function pricesAreEqual(left: Prisma.Decimal | null, right: Prisma.Decimal | null) {
  if (!left || !right) {
    return false;
  }

  return roundMoney(left).equals(roundMoney(right));
}

function ratioLooksLikePack(left: Prisma.Decimal, right: Prisma.Decimal) {
  if (right.lte(0)) {
    return false;
  }

  const ratio = left.div(right);
  return ratio.gte(new Prisma.Decimal("0.97")) && ratio.lte(new Prisma.Decimal("1.03"));
}

function normalizeUnit(value: string | null | undefined) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "");

  if (!normalized) {
    return null;
  }

  if (["шт", "штука", "штук"].includes(normalized)) {
    return "шт";
  }

  if (["уп", "упак", "упаковка"].includes(normalized)) {
    return "уп";
  }

  if (["кор", "короб", "коробка"].includes(normalized)) {
    return "кор";
  }

  if (["кг", "г", "л", "мл"].includes(normalized)) {
    return normalized;
  }

  return normalized;
}

function readUnitsPerPackFromRawData(rawData: Prisma.JsonValue | null | undefined) {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    return null;
  }

  const candidate = (rawData as Record<string, unknown>).unitsPerPack;

  if (typeof candidate === "string" || typeof candidate === "number") {
    const normalized = String(candidate).replace(",", ".").trim();
    const decimal = toDecimal(normalized);
    return decimal && decimal.gt(0) ? roundPackSize(decimal) : null;
  }

  return null;
}

export function inferPackSizeFromName(name: string | null | undefined) {
  const candidate = String(name ?? "");
  const patterns = [
    /\((\d+(?:[.,]\d+)?)\s*шт\)/iu,
    /(?:^|\s)(?:\d+(?:[.,]\d+)?\s*\/\s*)?(\d+(?:[.,]\d+)?)\s*шт\b/iu,
    /\bx\s*(\d+(?:[.,]\d+)?)\b/iu,
  ];

  for (const pattern of patterns) {
    const match = candidate.match(pattern);

    if (!match?.[1]) {
      continue;
    }

    const decimal = toDecimal(match[1].replace(",", "."));

    if (decimal && decimal.gt(ONE)) {
      return roundPackSize(decimal);
    }
  }

  return null;
}

function getProductPackSize(product: ProductPriceContext) {
  const snapshot = product.priceSnapshots?.[0] ?? null;

  return (
    toDecimal(snapshot?.supplierOffer?.unitsPerPack) ??
    toDecimal(product.unitsPerPack) ??
    readUnitsPerPackFromRawData(product.rawData) ??
    inferPackSizeFromName(product.name) ??
    null
  );
}

function getProductUnit(product: ProductPriceContext) {
  const snapshot = product.priceSnapshots?.[0] ?? null;
  return normalizeUnit(snapshot?.supplierOffer?.legacyUnit ?? snapshot?.legacyUnit ?? product.unit);
}

export function normalizeInvoicePriceForComparison(
  item: InvoicePriceItemContext,
  product: ProductPriceContext,
  _supplierOffer?: SupplierOfferPriceContext,
) {
  const invoicePrice = toDecimal(item.priceWithVat);
  const oldPrice = toDecimal(product.price);
  const packSize = getProductPackSize(product) ?? inferPackSizeFromName(item.productNameRaw);
  const invoiceUnit = normalizeUnit(item.unit);
  const productUnit = getProductUnit(product);

  return {
    invoicePrice: invoicePrice ? roundMoney(invoicePrice) : null,
    oldPrice: oldPrice ? roundMoney(oldPrice) : null,
    invoiceUnit,
    productUnit,
    packSize: packSize && packSize.gt(ONE) ? roundPackSize(packSize) : null,
  };
}

export function comparePricesSafely(
  item: InvoicePriceItemContext,
  product: ProductPriceContext,
  supplierOffer?: SupplierOfferPriceContext,
): InvoicePriceComparisonResult {
  const normalized = normalizeInvoicePriceForComparison(item, product, supplierOffer);
  const invoicePrice = normalized.invoicePrice;
  const oldPrice = normalized.oldPrice;
  const packSize = normalized.packSize;

  if (!invoicePrice) {
    return {
      canCompare: false,
      changed: false,
      needsReview: true,
      reason: "У строки нет цены для сравнения.",
      oldPrice,
      newPrice: null,
      invoicePrice: null,
      normalized: false,
      normalizationMode: null,
      packSize: null,
    };
  }

  if (oldPrice && pricesAreEqual(oldPrice, invoicePrice)) {
    return {
      canCompare: true,
      changed: false,
      needsReview: false,
      reason: null,
      oldPrice,
      newPrice: invoicePrice,
      invoicePrice,
      normalized: false,
      normalizationMode: "direct",
      packSize: null,
    };
  }

  if (packSize && packSize.gt(ONE) && oldPrice) {
    const invoiceAsPackPrice = roundMoney(invoicePrice.mul(packSize));

    if (pricesAreEqual(oldPrice, invoiceAsPackPrice) || ratioLooksLikePack(oldPrice, invoiceAsPackPrice)) {
      return {
        canCompare: true,
        changed: !pricesAreEqual(oldPrice, invoiceAsPackPrice),
        needsReview: false,
        reason: null,
        oldPrice,
        newPrice: invoiceAsPackPrice,
        invoicePrice,
        normalized: true,
        normalizationMode: "invoice_unit_to_pack",
        packSize,
      };
    }

    const invoiceAsUnitPrice = roundMoney(invoicePrice.div(packSize));

    if (pricesAreEqual(oldPrice, invoiceAsUnitPrice) || ratioLooksLikePack(invoicePrice, oldPrice.mul(packSize))) {
      return {
        canCompare: true,
        changed: !pricesAreEqual(oldPrice, invoiceAsUnitPrice),
        needsReview: false,
        reason: null,
        oldPrice,
        newPrice: invoiceAsUnitPrice,
        invoicePrice,
        normalized: true,
        normalizationMode: "invoice_pack_to_unit",
        packSize,
      };
    }
  }

  if (normalized.productUnit && normalized.invoiceUnit && normalized.productUnit !== normalized.invoiceUnit) {
    return {
      canCompare: false,
      changed: false,
      needsReview: true,
      reason: "Нужно проверить единицу цены.",
      oldPrice,
      newPrice: null,
      invoicePrice,
      normalized: false,
      normalizationMode: null,
      packSize,
    };
  }

  return {
    canCompare: true,
    changed: oldPrice ? !pricesAreEqual(oldPrice, invoicePrice) : true,
    needsReview: false,
    reason: null,
    oldPrice,
    newPrice: invoicePrice,
    invoicePrice,
    normalized: false,
    normalizationMode: "direct",
    packSize: null,
  };
}
