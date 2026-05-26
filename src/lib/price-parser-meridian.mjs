import { Prisma } from "@prisma/client";

export const MERIDIAN_SUPPLIER_PROFILE_ID = "meridian";

const MERIDIAN_NAME = "меридиан";
const REQUIRED_HEADERS = {
  article: "Артикул",
  name: "НоменклатураПредставление",
  price: "ПРАЙС - ЛИСТ Цена",
  unit: "Ед.",
  brand: "Бренд",
  country: "Страна",
  unitsPerPack: "Шт в коробке",
  minOrderQuantity: "Мин квант",
  preOrder: "Под заказ",
  shipByBoxesOnly: "Отгружать по коробкам",
};

const COUNTRY_ALIASES = new Map([
  ["россия", "Россия"],
  ["рф", "Россия"],
  ["китай", "Китай"],
  ["италия", "Италия"],
  ["вьетнам", "Вьетнам"],
  ["франция", "Франция"],
  ["эквадор", "Эквадор"],
  ["индия", "Индия"],
  ["корея, республика", "Корея, Республика"],
  ["соединенные штаты", "Соединенные Штаты"],
  ["соединенное королевство великобритании", "Соединенное Королевство Великобритании"],
]);
const MERIDIAN_EXCLUDED_NAMES = new Set(["подарок"]);
const MERIDIAN_EXCLUDED_ARTICLES = new Set(["907103"]);

function normalizeComparableText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\u0451/g, "\u0435")
    .replace(/\s+/gu, " ");
}

function normalizeHeader(value) {
  return normalizeComparableText(value).replace(/[^a-z\u0430-\u044f0-9]+/giu, "");
}

function normalizeCellValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value).trim();
}

function parseDecimal(value) {
  const source = normalizeCellValue(value);

  if (!source) {
    return null;
  }

  let normalized = source.replace(/\s+/gu, "").replace(/[^\d,.-]/g, "");
  normalized = normalized.replace(/^[,.]+|[,.]+$/g, "");
  normalized = normalized.replace(/(?!^)-/g, "");

  if (!normalized || normalized === "-" || normalized === ".") {
    return null;
  }

  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";

    normalized = normalized.replaceAll(thousandsSeparator, "");

    if (decimalSeparator === ",") {
      normalized = normalized.replace(",", ".");
    }
  } else if (lastComma !== -1) {
    normalized = normalized.replace(",", ".");
  }

  const numericValue = Number(normalized);

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return new Prisma.Decimal(numericValue);
}

function buildHeaderCandidates(rows, rowIndex, rowSpan = 2) {
  const selectedRows = Array.from({ length: rowSpan }, (_, offset) => rows[rowIndex + offset] ?? []);
  const maxLength = Math.max(...selectedRows.map((row) => row.length), 0);

  return Array.from({ length: maxLength }, (_, index) => {
    const parts = selectedRows
      .map((row) => normalizeCellValue(row[index]))
      .filter(Boolean)
      .filter((part, partIndex, values) => values.indexOf(part) === partIndex);

    return parts.join(" ").trim();
  });
}

function detectHeaderRow(rows) {
  const expectedHeaders = Object.values(REQUIRED_HEADERS).map((header) => normalizeHeader(header));

  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 8); rowIndex += 1) {
    for (const rowSpan of [2, 1, 3]) {
      if (rowIndex + rowSpan - 1 >= rows.length) {
        continue;
      }

      const headers = buildHeaderCandidates(rows, rowIndex, rowSpan);
      const normalizedHeaders = headers.map((header) => normalizeHeader(header));

      if (!expectedHeaders.every((expectedHeader) => normalizedHeaders.includes(expectedHeader))) {
        continue;
      }

      const fieldIndexes = {};

      for (const [field, header] of Object.entries(REQUIRED_HEADERS)) {
        const index = headers.findIndex((candidate) => normalizeHeader(candidate) === normalizeHeader(header));
        if (index !== -1) {
          fieldIndexes[field] = index;
        }
      }

      return {
        headerRowIndex: rowIndex,
        headerRowSpan: rowSpan,
        fieldIndexes,
      };
    }
  }

  return null;
}

function normalizeUnitValue(value) {
  const normalized = normalizeHeader(value);

  if (!normalized) {
    return null;
  }

  if (["шт", "штука", "штуки", "piece", "pieces", "pcs"].includes(normalized)) {
    return "шт";
  }

  if (["кг", "kilogram", "kilograms", "kg"].includes(normalized)) {
    return "кг";
  }

  if (["л", "литр", "литры", "liter", "litre", "liters", "litres", "l"].includes(normalized)) {
    return "л";
  }

  if (["уп", "упаковка", "упаковки", "pack", "package"].includes(normalized)) {
    return "уп";
  }

  return normalizeCellValue(value).toLowerCase();
}

function isTruthyFlag(value) {
  const normalized = normalizeComparableText(value);
  return normalized === "v" || normalized === "true" || normalized === "yes" || normalized === "да" || normalized === "1";
}

function inferUnitsPerPackFromName(name) {
  const compactName = normalizeCellValue(name);
  const unitsToken = String.raw`(?:\u0448\u0442|pcs?|pieces?)`;
  const separatorMatch = compactName.match(
    new RegExp(String.raw`(?:[*xX\u00D7/\u0445\u0425-])\s*(\d+(?:[.,]\d+)?)\s*${unitsToken}(?=\b|[^A-Za-z\u0400-\u04FF]|$)`, "iu"),
  );

  if (!separatorMatch) {
    return null;
  }

  return new Prisma.Decimal(separatorMatch[1].replace(",", "."));
}

function normalizeCountry(value) {
  const source = normalizeCellValue(value);

  if (!source) {
    return null;
  }

  return COUNTRY_ALIASES.get(normalizeComparableText(source)) ?? source;
}

function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanupName(name, brand, country) {
  let nextName = normalizeCellValue(name);

  nextName = nextName.replace(/\s*(?:[*xX\u00D7/\u0445\u0425-])\s*\d+(?:[.,]\d+)?\s*\u0448\u0442(?:[.\s]|$)/giu, " ");

  if (brand) {
    const brandPattern = new RegExp(`(^|\\s|[,(])${escapeRegExp(brand)}(?=\\s|[),]|$)`, "giu");
    nextName = nextName.replace(brandPattern, "$1");
  }

  if (country) {
    const countryPattern = new RegExp(`(^|\\s|[,(])${escapeRegExp(country)}(?=\\s|[),]|$)`, "giu");
    nextName = nextName.replace(countryPattern, "$1");
  }

  return nextName
    .replace(/\s+\/\s+/gu, " / ")
    .replace(/\s+,/gu, ",")
    .replace(/\(\s+/gu, "(")
    .replace(/\s+\)/gu, ")")
    .replace(/\s{2,}/gu, " ")
    .replace(/\s+([,;:])/gu, "$1")
    .replace(/,\s*,/gu, ", ")
    .replace(/[,\s]+$/gu, "")
    .trim();
}

function looksLikeSectionRow(name, article, price, unit) {
  if (article || price || unit) {
    return false;
  }

  const compactName = normalizeCellValue(name);

  if (!compactName) {
    return true;
  }

  if (compactName === compactName.toUpperCase()) {
    return true;
  }

  return compactName.split(/\s+/u).length <= 4;
}

function shouldSkipMeridianProduct(name, article) {
  return MERIDIAN_EXCLUDED_NAMES.has(normalizeComparableText(name)) || MERIDIAN_EXCLUDED_ARTICLES.has(normalizeCellValue(article));
}

function toRawData(headers, row) {
  const rawData = {};

  headers.forEach((header, index) => {
    const key = normalizeCellValue(header) || `column_${index + 1}`;
    rawData[key] = normalizeCellValue(row[index]);
  });

  return rawData;
}

export function isMeridianSupplierName(value) {
  return normalizeComparableText(value).includes(MERIDIAN_NAME);
}

export async function parseMeridianSheetRows(rows) {
  const headerMatch = detectHeaderRow(rows);

  if (!headerMatch) {
    throw new Error("Не удалось определить шапку прайса Меридиан.");
  }

  const headers = buildHeaderCandidates(rows, headerMatch.headerRowIndex, headerMatch.headerRowSpan);
  const products = [];
  let skippedCount = 0;

  for (let rowIndex = headerMatch.headerRowIndex + headerMatch.headerRowSpan; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const rawData = toRawData(headers, row);

    const articleValue = normalizeCellValue(row[headerMatch.fieldIndexes.article]);
    const rawName = normalizeCellValue(row[headerMatch.fieldIndexes.name]);
    const priceValue = normalizeCellValue(row[headerMatch.fieldIndexes.price]);
    const unitValue = normalizeCellValue(row[headerMatch.fieldIndexes.unit]);
    const rawBrand = normalizeCellValue(row[headerMatch.fieldIndexes.brand]);
    const rawCountry = normalizeCellValue(row[headerMatch.fieldIndexes.country]);
    const rawUnitsPerPack = normalizeCellValue(row[headerMatch.fieldIndexes.unitsPerPack]);
    const rawMinOrderQuantity = normalizeCellValue(row[headerMatch.fieldIndexes.minOrderQuantity]);
    const rawShipByBoxesOnly = normalizeCellValue(row[headerMatch.fieldIndexes.shipByBoxesOnly]);

    if (looksLikeSectionRow(rawName, articleValue, priceValue, unitValue) || shouldSkipMeridianProduct(rawName, articleValue)) {
      skippedCount += 1;
      continue;
    }

    const price = parseDecimal(priceValue);
    const unit = normalizeUnitValue(unitValue);

    if (!rawName || (!articleValue && !price && !unit)) {
      skippedCount += 1;
      continue;
    }

    const brand = rawBrand || null;
    const country = normalizeCountry(rawCountry);
    const unitsPerPack = parseDecimal(rawUnitsPerPack) ?? inferUnitsPerPackFromName(rawName);
    const minOrderQuantity = parseDecimal(rawMinOrderQuantity);
    const shipByBoxesOnly = isTruthyFlag(rawShipByBoxesOnly);
    const cleanedName = cleanupName(rawName, brand, rawCountry || country);

    products.push({
      name: cleanedName || rawName,
      article: articleValue || null,
      brand,
      country,
      unit,
      unitsPerPack,
      minOrderQuantity,
      orderStep: shipByBoxesOnly ? unitsPerPack ?? minOrderQuantity : minOrderQuantity,
      allowFractionalOrder: unit === "кг" || unit === "л",
      shipByBoxesOnly,
      price,
      stock: null,
      sourceRow: rowIndex + 1,
      rawData: {
        ...rawData,
        unitsPerPack: unitsPerPack?.toString() ?? "",
        minOrderQuantity: minOrderQuantity?.toString() ?? "",
        orderStep: (shipByBoxesOnly ? unitsPerPack ?? minOrderQuantity : minOrderQuantity)?.toString() ?? "",
        allowFractionalOrder: unit === "кг" || unit === "л" ? "true" : "false",
        shipByBoxesOnly: shipByBoxesOnly ? "true" : "",
        supplierProfile: MERIDIAN_SUPPLIER_PROFILE_ID,
        _missingUnitsPerPack: !rawUnitsPerPack ? "true" : "",
        _warningUnitsPerPack: rawUnitsPerPack && !unitsPerPack ? "true" : "",
      },
    });
  }

  return { products, skippedCount };
}
