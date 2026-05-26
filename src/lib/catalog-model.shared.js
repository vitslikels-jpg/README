export const AUTO_MAPPING_THRESHOLD = 0.75;

export const BASIC_UNITS = [
  {
    code: "pcs",
    name: "Pieces",
    symbol: "pcs",
    kind: "count",
    baseUnitCode: "pcs",
    multiplier: "1",
    aliases: [
      "pcs",
      "pc",
      "piece",
      "pieces",
      "\u0448\u0442",
      "\u0448\u0442.",
      "\u0448\u0442\u0443\u043a\u0430",
      "\u0448\u0442\u0443\u043a\u0438",
      "\u0448\u0442\u0443\u043a",
      "\u0443\u043f",
      "\u0443\u043f.",
      "\u0443\u043f\u0430\u043a",
      "\u0443\u043f\u0430\u043a.",
      "\u0443\u043f\u0430\u043a\u043e\u0432\u043a\u0430",
      "\u0443\u043f\u0430\u043a\u043e\u0432\u043a\u0438",
      "\u043a\u043e\u0440",
      "\u043a\u043e\u0440.",
      "\u043a\u043e\u0440\u043e\u0431",
      "\u043a\u043e\u0440\u043e\u0431.",
      "\u043a\u043e\u0440\u043e\u0431\u043a\u0430",
      "\u043a\u043e\u0440\u043e\u0431\u043a\u0438",
    ],
  },
  {
    code: "kg",
    name: "Kilograms",
    symbol: "kg",
    kind: "weight",
    baseUnitCode: "g",
    multiplier: "1000",
    aliases: [
      "kg",
      "\u043a\u0433",
      "\u043a\u0433.",
      "\u043a\u0438\u043b\u043e\u0433\u0440\u0430\u043c\u043c",
      "\u043a\u0438\u043b\u043e\u0433\u0440\u0430\u043c\u043c\u0430",
      "\u043a\u0438\u043b\u043e\u0433\u0440\u0430\u043c\u043c\u043e\u0432",
      "\u043a\u0438\u043b\u043e\u0433\u0440\u0430\u043c\u043c\u044b",
    ],
  },
  {
    code: "g",
    name: "Grams",
    symbol: "g",
    kind: "weight",
    baseUnitCode: "g",
    multiplier: "1",
    aliases: [
      "g",
      "gr",
      "\u0433\u0440",
      "\u0433\u0440.",
      "\u0433",
      "\u0433.",
      "\u0433\u0440\u0430\u043c\u043c",
      "\u0433\u0440\u0430\u043c\u043c\u0430",
      "\u0433\u0440\u0430\u043c\u043c\u043e\u0432",
      "\u0433\u0440\u0430\u043c\u043c\u044b",
    ],
  },
  {
    code: "l",
    name: "Liters",
    symbol: "l",
    kind: "volume",
    baseUnitCode: "ml",
    multiplier: "1000",
    aliases: [
      "l",
      "lt",
      "\u043b",
      "\u043b.",
      "\u043b\u0438\u0442\u0440",
      "\u043b\u0438\u0442\u0440\u0430",
      "\u043b\u0438\u0442\u0440\u043e\u0432",
      "\u043b\u0438\u0442\u0440\u044b",
    ],
  },
  {
    code: "ml",
    name: "Milliliters",
    symbol: "ml",
    kind: "volume",
    baseUnitCode: "ml",
    multiplier: "1",
    aliases: [
      "ml",
      "\u043c\u043b",
      "\u043c\u043b.",
      "\u043c\u0438\u043b\u043b\u0438\u043b\u0438\u0442\u0440",
      "\u043c\u0438\u043b\u043b\u0438\u043b\u0438\u0442\u0440\u0430",
      "\u043c\u0438\u043b\u043b\u0438\u043b\u0438\u0442\u0440\u043e\u0432",
      "\u043c\u0438\u043b\u043b\u0438\u043b\u0438\u0442\u0440\u044b",
    ],
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
    .replace(/\u0451/g, "\u0435")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCatalogUnit(value) {
  const normalized = normalizeAlias(value);

  if (!normalized) {
    return null;
  }

  const mappedUnit = unitAliasToCode.get(normalized);

  if (mappedUnit) {
    return mappedUnit;
  }

  if (normalized === "\u0443\u043f" || normalized.startsWith("\u0443\u043f\u0430\u043a")) {
    return "pcs";
  }

  return null;
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
