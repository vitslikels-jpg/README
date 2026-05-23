export const AUTO_MAPPING_THRESHOLD = 0.75;

export const BASIC_UNITS = [
  {
    code: "pcs",
    name: "Pieces",
    symbol: "pcs",
    kind: "count",
    baseUnitCode: "pcs",
    multiplier: "1",
    aliases: ["pcs", "pc", "piece", "pieces", "шт", "шт.", "штука", "штуки", "штук"],
  },
  {
    code: "kg",
    name: "Kilograms",
    symbol: "kg",
    kind: "weight",
    baseUnitCode: "g",
    multiplier: "1000",
    aliases: ["kg", "кг", "кг.", "килограмм", "килограмма", "килограммов", "килограммы"],
  },
  {
    code: "g",
    name: "Grams",
    symbol: "g",
    kind: "weight",
    baseUnitCode: "g",
    multiplier: "1",
    aliases: ["g", "gr", "гр", "гр.", "г", "г.", "грамм", "грамма", "граммов", "граммы"],
  },
  {
    code: "l",
    name: "Liters",
    symbol: "l",
    kind: "volume",
    baseUnitCode: "ml",
    multiplier: "1000",
    aliases: ["l", "lt", "л", "л.", "литр", "литра", "литров", "литры"],
  },
  {
    code: "ml",
    name: "Milliliters",
    symbol: "ml",
    kind: "volume",
    baseUnitCode: "ml",
    multiplier: "1",
    aliases: ["ml", "мл", "мл.", "миллилитр", "миллилитра", "миллилитров", "миллилитры"],
  },
];

const unitAliasToCode = new Map(BASIC_UNITS.flatMap((unit) => unit.aliases.map((alias) => [normalizeAlias(alias), unit.code])));

function normalizeAlias(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
}

export function normalizeOptionalString(value) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

export function normalizeCatalogText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCatalogUnit(value) {
  const normalized = normalizeAlias(value);

  if (!normalized) {
    return null;
  }

  return unitAliasToCode.get(normalized) ?? null;
}

export function buildCatalogDedupeKey(parts) {
  return parts
    .map((part) => normalizeOptionalString(part) ?? "-")
    .join("|");
}

export function calculateAutoMappingConfidence({
  normalizedName,
  normalizedBrand,
  normalizedArticle,
  unitCode,
  groupSize,
  hasCurrentSnapshot,
}) {
  const tokenCount = normalizedName ? normalizedName.split(" ").filter(Boolean).length : 0;
  let score = 0.1;

  if (tokenCount >= 3 || (normalizedName?.length ?? 0) >= 12) {
    score += 0.35;
  } else if (tokenCount >= 2 || (normalizedName?.length ?? 0) >= 7) {
    score += 0.25;
  } else if (normalizedName) {
    score += 0.1;
  }

  if (unitCode) {
    score += 0.15;
  }

  if (normalizedBrand) {
    score += 0.15;
  }

  if (normalizedArticle) {
    score += 0.1;
  }

  if (groupSize > 1) {
    score += 0.1;
  }

  if (hasCurrentSnapshot) {
    score += 0.05;
  }

  return Math.min(0.99, Number(score.toFixed(4)));
}
