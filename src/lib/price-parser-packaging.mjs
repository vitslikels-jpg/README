const WEIGHT_WORD_PATTERN = /(?:^|[^a-z\u0400-\u04ff])(?:\u0441\u0440\.?\s*\u0432\u0435\u0441|\u0441\/\u043c\s*\u0432\u0435\u0441|\u0432\u0435\u0441\u043e\u0432\u0430\u044f|\u0432\u0435\u0441\u043e\u0432\u043e\u0439|\u043c\u043e\u043d\u043e\u043b\u0438\u0442)(?=$|[^a-z\u0400-\u04ff])/iu;
const APPROX_WEIGHT_PATTERN = /(?:~|\u2248)\s*\d+(?:[.,]\d+)?\s*(?:\u043a\u0433|kg|\u0433\u0440?\.?|\u0433|g|\u043b|l|\u043c\u043b|ml)(?=$|[^a-z\u0400-\u04ff])/iu;
const PACK_PATTERN =
  /(?:~|\u2248|\u0441\u0440\.?\s*\u0432\u0435\u0441\s*)?\s*(\d+(?:[.,]\d+)?)\s*(\u043a\u0433|kg|\u0433\u0440?\.?|\u0433|g|\u043b|l|\u043b\u0438\u0442\u0440(?:\u0430|\u043e\u0432|\u044b)?|\u043c\u043b|ml)(?=$|[^a-z\u0400-\u04ff])/giu;

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
