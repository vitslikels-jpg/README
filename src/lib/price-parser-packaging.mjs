const WEIGHT_WORD_PATTERN = /(?:^|[^a-z\u0400-\u04ff])(?:\u0441\u0440\.?\s*\u0432\u0435\u0441|\u0441\/\u043c\s*\u0432\u0435\u0441|\u0432\u0435\u0441\u043e\u0432\u0430\u044f|\u0432\u0435\u0441\u043e\u0432\u043e\u0439|\u043c\u043e\u043d\u043e\u043b\u0438\u0442)(?=$|[^a-z\u0400-\u04ff])/iu;
const APPROX_WEIGHT_PATTERN = /(?:~|\u2248)\s*\d+(?:[.,]\d+)?\s*(?:\u043a\u0433|kg|\u0433\u0440?\.?|\u0433|g|\u043b|l|\u043c\u043b|ml)(?=$|[^a-z\u0400-\u04ff])/iu;
const PACK_PATTERN =
  /(?:~|\u2248|\u0441\u0440\.?\s*\u0432\u0435\u0441\s*)?\s*(\d+(?:[.,]\d+)?)\s*(\u043a\u0433|kg|\u0433\u0440?\.?|\u0433|g|\u043b|l|\u043b\u0438\u0442\u0440(?:\u0430|\u043e\u0432|\u044b)?|\u043c\u043b|ml)(?=$|[^a-z\u0400-\u04ff])/giu;
const SMALL_GRAM_PATTERN = /(\d+(?:[.,]\d+)?)\s*(?:\u0433\u0440?\.?|\u0433|g)(?=$|[^a-z\u0400-\u04ff])/iu;
const SMALL_ML_PATTERN = /(\d+(?:[.,]\d+)?)\s*(?:\u043c\u043b|ml)(?=$|[^a-z\u0400-\u04ff])/iu;
const SMALL_PIECE_PATTERN = /(\d+(?:[.,]\d+)?)\s*(?:\u0448\u0442|pcs?|pieces?)(?=$|[^a-z\u0400-\u04ff])/iu;
const EXPLICIT_BOX_COUNT_PATTERN =
  /(?:[*xX\u00d7\u0445\u0425]\s*\d+\s*(?:\u0448\u0442|pcs?|pieces?)|\d+\s*(?:\u0448\u0442|pcs?|pieces?)\s*(?:\/|\u0432)?\s*(?:\u043a\u043e\u0440|\u043a\u043e\u0440\u043e\u0431|\u043a\u043e\u0440\u043e\u0431\u043a|box))/iu;

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\u0451/g, "\u0435")
    .replace(/\s+/gu, " ");
}

function rawDataValues(rawData) {
  if (!rawData || typeof rawData !== "object") {
    return [];
  }

  return Object.entries(rawData)
    .map(([, value]) => `${value ?? ""}`)
    .filter((value) => value.trim());
}

function rawDataEntries(rawData) {
  if (!rawData || typeof rawData !== "object") {
    return [];
  }

  return Object.entries(rawData).map(([key, value]) => ({
    key: String(key ?? ""),
    value: String(value ?? ""),
  }));
}

function normalizePackMatch(quantity, unit) {
  const amount = Number(String(quantity).replace(",", "."));

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const normalizedUnit = normalizeText(unit).replace(/\./gu, "");

  if (normalizedUnit === "\u043a\u0433" || normalizedUnit === "kg") {
    return { unit: "\u043a\u0433", unitsPerPack: amount };
  }

  if (normalizedUnit === "\u0433" || normalizedUnit === "\u0433\u0440" || normalizedUnit === "g") {
    return { unit: "\u043a\u0433", unitsPerPack: amount / 1000 };
  }

  if (normalizedUnit === "\u043b" || normalizedUnit === "l" || normalizedUnit.startsWith("\u043b\u0438\u0442\u0440")) {
    return { unit: "\u043b", unitsPerPack: amount };
  }

  if (normalizedUnit === "\u043c\u043b" || normalizedUnit === "ml") {
    return { unit: "\u043b", unitsPerPack: amount / 1000 };
  }

  return null;
}

function findPack(text) {
  const source = normalizeText(text);

  if (!source) {
    return null;
  }

  PACK_PATTERN.lastIndex = 0;

  for (const match of source.matchAll(PACK_PATTERN)) {
    const candidate = normalizePackMatch(match[1], match[2]);

    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function hasSmallConsumerPackagingHint(text) {
  const source = normalizeText(text);

  if (!source) {
    return false;
  }

  const gramMatch = source.match(SMALL_GRAM_PATTERN);

  if (gramMatch) {
    const grams = Number(String(gramMatch[1]).replace(",", "."));

    if (Number.isFinite(grams) && grams > 0 && grams <= 500) {
      return true;
    }
  }

  const mlMatch = source.match(SMALL_ML_PATTERN);

  if (mlMatch) {
    const ml = Number(String(mlMatch[1]).replace(",", "."));

    if (Number.isFinite(ml) && ml > 0 && ml <= 1000) {
      return true;
    }
  }

  const pieceMatch = source.match(SMALL_PIECE_PATTERN);

  if (pieceMatch) {
    const pieces = Number(String(pieceMatch[1]).replace(",", "."));

    if (Number.isFinite(pieces) && pieces > 0 && pieces <= 1) {
      return true;
    }
  }

  return false;
}

function hasExplicitBoxTextHint(text) {
  return EXPLICIT_BOX_COUNT_PATTERN.test(normalizeText(text));
}

function hasExplicitBoxCountHint({ name, packaging, rawData }) {
  const sourceTexts = [name, packaging, ...rawDataValues(rawData)];

  if (sourceTexts.some((text) => hasExplicitBoxTextHint(text))) {
    return true;
  }

  return rawDataEntries(rawData).some(({ key, value }) => {
    const normalizedKey = normalizeText(key);
    const normalizedValue = normalizeText(value);

    if (!normalizedValue) {
      return false;
    }

    return (
      normalizedKey.includes("\u0448\u0442/\u043a\u0440") ||
      normalizedKey.includes("\u0448\u0442\u0432\u043a\u043e\u0440\u043e\u0431\u043a\u0435") ||
      normalizedKey.includes("\u043a\u043e\u043b \u0432\u043e \u0432 \u043a\u043e\u0440\u043e\u0431\u043a\u0435") ||
      normalizedKey.includes("\u043a\u043e\u043b-\u0432\u043e \u0432 \u043a\u043e\u0440\u043e\u0431\u043a\u0435") ||
      normalizedKey.includes("box qty") ||
      normalizedKey.includes("pack size")
    );
  });
}

export function sanitizeUnitsPerPackCandidate({
  unitsPerPack,
  name,
  packaging,
  rawData,
  extractedWeightPack,
  shipByBoxesOnly = false,
} = {}) {
  if (unitsPerPack == null) {
    return null;
  }

  const numericUnitsPerPack = Number(unitsPerPack);

  if (!Number.isFinite(numericUnitsPerPack) || numericUnitsPerPack <= 0) {
    return null;
  }

  if (extractedWeightPack?.isWeighted && ["\u043a\u0433", "\u043b"].includes(extractedWeightPack.unit)) {
    return numericUnitsPerPack;
  }

  const hasSmallConsumerHint =
    hasSmallConsumerPackagingHint(name) ||
    hasSmallConsumerPackagingHint(packaging) ||
    rawDataValues(rawData).some((text) => hasSmallConsumerPackagingHint(text));

  const hasSmallConsumerNameHint =
    hasSmallConsumerPackagingHint(name) ||
    hasSmallConsumerPackagingHint(packaging);

  const hasExplicitBoxTextInVisibleFields =
    hasExplicitBoxTextHint(name) ||
    hasExplicitBoxTextHint(packaging);

  const hasExplicitBoxHint = hasExplicitBoxCountHint({ name, packaging, rawData });

  if (numericUnitsPerPack > 50 && hasSmallConsumerNameHint && !hasExplicitBoxTextInVisibleFields) {
    return null;
  }

  if (numericUnitsPerPack > 50 && !shipByBoxesOnly && !hasExplicitBoxHint) {
    return null;
  }

  if (numericUnitsPerPack > 50 && hasSmallConsumerHint) {
    return null;
  }

  return numericUnitsPerPack;
}

export function extractWeightPackFromNameOrRawData({ name, packaging, rawData } = {}) {
  const sources = [
    { source: "packaging", text: packaging },
    { source: "name", text: name },
    ...rawDataValues(rawData).map((text) => ({ source: "rawData", text })),
  ];

  const combinedText = normalizeText(sources.map((item) => item.text).join(" "));
  const hasWeightWords = WEIGHT_WORD_PATTERN.test(combinedText) || APPROX_WEIGHT_PATTERN.test(combinedText);

  for (const source of sources) {
    const pack = findPack(source.text);

    if (pack) {
      const isWeighted = hasWeightWords;

      if (!isWeighted) {
        continue;
      }

      return {
        ...pack,
        source: source.source,
        isWeighted,
      };
    }
  }

  if (hasWeightWords) {
    return {
      unit: "\u043a\u0433",
      unitsPerPack: null,
      source: "weightWords",
      isWeighted: true,
    };
  }

  return null;
}
