import { Prisma } from "@prisma/client";

type NumericInput = Prisma.Decimal | string | number | null | undefined;

type SanitizeResult = {
  value: Prisma.Decimal | null;
  forcedReview: boolean;
};

const DB_HARD_LIMIT = 10_000_000_000;
const MONEY_SOFT_LIMIT = 10_000_000;
const QUANTITY_SOFT_LIMIT = 100_000;

function toFiniteNumber(value: NumericInput) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value instanceof Prisma.Decimal) {
    const numericValue = value.toNumber();
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  const numericValue =
    typeof value === "number" ? value : Number(String(value).replace(/\s+/g, "").replace(",", "."));

  return Number.isFinite(numericValue) ? numericValue : null;
}

function toDecimal(value: number, scale: number) {
  return new Prisma.Decimal(value).toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP);
}

export function sanitizeMoney(value: NumericInput): SanitizeResult {
  const numericValue = toFiniteNumber(value);

  if (numericValue === null || numericValue < 0 || numericValue >= DB_HARD_LIMIT) {
    return { value: null, forcedReview: true };
  }

  if (numericValue > MONEY_SOFT_LIMIT) {
    return { value: null, forcedReview: true };
  }

  return {
    value: toDecimal(numericValue, 2),
    forcedReview: false,
  };
}

export function sanitizeQuantity(value: NumericInput): SanitizeResult {
  const numericValue = toFiniteNumber(value);

  if (numericValue === null || numericValue < 0 || numericValue >= DB_HARD_LIMIT) {
    return { value: null, forcedReview: true };
  }

  if (numericValue > QUANTITY_SOFT_LIMIT) {
    return { value: null, forcedReview: true };
  }

  return {
    value: toDecimal(numericValue, 3),
    forcedReview: false,
  };
}

export function sanitizeVatRate(value: NumericInput): SanitizeResult {
  const numericValue = toFiniteNumber(value);

  if (numericValue === null || numericValue < 0 || numericValue > 100) {
    return { value: null, forcedReview: true };
  }

  return {
    value: toDecimal(numericValue, 2),
    forcedReview: false,
  };
}
