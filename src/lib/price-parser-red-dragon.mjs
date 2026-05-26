import { Prisma } from "@prisma/client";
import { refineParsedProductIdentity } from "./product-identity-refiner.mjs";

export const RED_DRAGON_SUPPLIER_PROFILE_ID = "red-dragon";

const NAME_HEADER = "\u041d\u043e\u043c\u0435\u043d\u043a\u043b\u0430\u0442\u0443\u0440\u0430";
const ARTICLE_HEADER = "\u0410\u0440\u0442\u0438\u043a\u0443\u043b";
const UNITS_PER_PACK_HEADER = "\u0428\u0442\u0443\u043a \u0432 \u043a\u043e\u0440\u043e\u0431\u043a\u0435";
const PRICE_HEADERS = ["\u0426\u0435\u043d\u0430 \u0437\u0430 \u0448\u0442\u0443\u043a\u0443", "\u0426\u0435\u043d\u0430"];
const COUNTRY_HEADERS = ["\u041f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044c"];
const RED_DRAGON_NAME = "\u043a\u0440\u0430\u0441\u043d\u044b\u0439 \u0434\u0440\u0430\u043a\u043e\u043d";

const IGNORED_HEADERS = new Set([
  "\u041a\u0430\u0440\u0442\u0438\u043d\u043a\u0430",
  "\u0421\u0440\u043e\u043a \u0433\u043e\u0434\u043d\u043e\u0441\u0442\u0438",
  "\u0421\u0432\u043e\u0431\u043e\u0434\u043d\u044b\u0439 \u043e\u0441\u0442\u0430\u0442\u043e\u043a",
]);

const REQUIRED_HEADERS = {
  name: NAME_HEADER,
  article: ARTICLE_HEADER,
  unitsPerPack: UNITS_PER_PACK_HEADER,
  price: PRICE_HEADERS,
};

const MAX_RED_DRAGON_AI_ROWS = 25;
const RED_DRAGON_IDENTITY_OVERRIDES = new Map([
  ["4803oz", { brand: "Doldori" }],
  ["5714oz", { brand: "Doldori" }],
  ["1522", { brand: "Spring Home" }],
  ["11811oz", { brand: "zaizai" }],
  ["11807oz", { brand: "zaizai" }],
  ["13865", { brand: "Lotte" }],
  ["1483oz", { brand: "Chugong" }],
  ["11621oz", { brand: "WOOMTREE" }],
  ["11076oz", { brand: "Оттоги" }],
  ["1852oz", { brand: "Haday" }],
  ["3853oz", { brand: "Lotte" }],
  ["10200oz", { brand: "Spearmint Lotte" }],
  ["6925oz", { brand: "Dr. Pepper" }],
  ["12411oz", { brand: "Dr. Pepper" }],
  ["13202кд", { brand: "KOUSYO", country: "ЯПОНИЯ" }],
  ["13212кд", { brand: "KOUSYO", country: "ЯПОНИЯ" }],
  ["8932oz", { brand: "LOTTE", country: "ЮЖНАЯ КОРЕЯ" }],
  ["12266кд", { brand: "SEOJU", country: "ЮЖНАЯ КОРЕЯ" }],
  ["9597oz", { brand: "Arizona", country: "США" }],
  ["12236кд", { brand: "ICD" }],
  ["10942oz", { brand: "Alpenliebe 2 Chew" }],
  ["12119", { brand: "Alpenliebe 2 Chew" }],
  ["10939oz", { brand: "Mentos" }],
  ["12107oz", { brand: "Mentos" }],
  ["10911oz", { brand: "MENTOS" }],
  ["13952", { brand: "SUNTORY", country: "ЯПОНИЯ" }],
  ["14064", { brand: "Марукомэ", country: "ЯПОНИЯ" }],
  ["6678oz", { brand: "BG" }],
  ["3189oz", { brand: "CHAOKOH" }],
  ["13333oz", { brand: "KEKESHI" }],
  ["13098oz", { brand: "Pulmuone" }],
  ["5642oz", { brand: "Coca-Cola" }],
  ["8263oz", { brand: "Dr. Pepper" }],
  ["13964", { brand: "Monster Energy" }],
  ["13875", { brand: "Toxic Waste" }],
  ["3455oz", { brand: "Pepero" }],
  ["13941", { brand: "Oreo" }],
  ["13873", { brand: "Coris" }],
  ["13860", { brand: "Coris" }],
  ["13872", { brand: "Tirol" }],
  ["13736", { brand: "KitKat" }],
  ["11637oz", { brand: "KitKat" }],
  ["11638oz", { brand: "KitKat" }],
  ["11627oz", { brand: "KAMINARY" }],
]);
const RED_DRAGON_NAME_OVERRIDES = [
  {
    match: "соус соевый kaminary original, 1000 мл",
    override: { brand: "KAMINARY" },
  },
];

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

function buildHeaderCandidates(rows, rowIndex, rowSpan = 1) {
  const selectedRows = Array.from({ length: rowSpan }, (_, offset) => rows[rowIndex + offset] ?? []);
  const maxLength = Math.max(...selectedRows.map((row) => row.length), 0);

  return Array.from({ length: maxLength }, (_, columnIndex) => {
    const parts = selectedRows
      .map((row) => normalizeCellValue(row[columnIndex]))
      .filter(Boolean)
      .filter((part, partIndex, values) => values.indexOf(part) === partIndex);

    return parts.join(" ").trim();
  });
}

function detectHeaderRow(rows) {
  let bestMatch = null;
  let bestScore = -1;

  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 12); rowIndex += 1) {
    for (const rowSpan of [1, 2]) {
      if (rowIndex + rowSpan - 1 >= rows.length) {
        continue;
      }

      const headers = buildHeaderCandidates(rows, rowIndex, rowSpan);
      const fieldIndexes = {};
      let score = 0;

      headers.forEach((header, columnIndex) => {
        const normalized = normalizeHeader(header);

        for (const [field, expectedHeaders] of Object.entries(REQUIRED_HEADERS)) {
          if (fieldIndexes[field] !== undefined) {
            continue;
          }

          const headersToMatch = Array.isArray(expectedHeaders) ? expectedHeaders : [expectedHeaders];

          if (headersToMatch.some((expectedHeader) => normalized === normalizeHeader(expectedHeader))) {
            fieldIndexes[field] = columnIndex;
            score += field === "name" || field === "price" ? 3 : 2;
          }
        }

        if (fieldIndexes.country === undefined && COUNTRY_HEADERS.some((header) => normalized === normalizeHeader(header))) {
          fieldIndexes.country = columnIndex;
          score += 1;
        }
      });

      if (fieldIndexes.name === undefined || fieldIndexes.price === undefined) {
        continue;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          headerRowIndex: rowIndex,
          headerRowSpan: rowSpan,
          fieldIndexes,
        };
      }
    }
  }

  return bestMatch;
}

function extractPackagingFromName(name) {
  const source = normalizeCellValue(name);

  if (!source) {
    return null;
  }

  const match = source.match(/(\d+(?:[.,]\d+)?)\s*(\u043a\u0433|\u0433|\u043b|\u043c\u043b|\u0448\u0442)\b/iu);

  if (!match) {
    return null;
  }

  const quantity = parseDecimal(match[1]);
  const unit = normalizeComparableText(match[2]);

  if (!quantity) {
    return null;
  }

  return {
    label: `${match[1]} ${match[2]}`,
    quantity,
    unit,
  };
}

function joinApiUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/u, "")}/${path.replace(/^\/+/u, "")}`;
}

function getAiProvider() {
  const polzaApiKey = process.env.POLZA_AI_API_KEY?.trim();

  if (polzaApiKey) {
    return {
      source: "polza",
      apiKey: polzaApiKey,
      model: process.env.POLZA_AI_MODEL?.trim() || "google/gemini-3.1-flash-lite",
      completionsUrl: joinApiUrl(process.env.POLZA_AI_BASE_URL?.trim() || "https://polza.ai/api/v1", "chat/completions"),
      headers: {},
    };
  }

  const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (!openRouterApiKey) {
    return null;
  }

  return {
    source: "openrouter",
    apiKey: openRouterApiKey,
    model: process.env.OPENROUTER_MODEL?.trim() || "openai/gpt-4o-mini",
    completionsUrl: joinApiUrl(
      process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
      "chat/completions",
    ),
    headers: {
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost",
      "X-Title": "Citadel Prices",
    },
  };
}

function normalizeAiSuggestion(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const suggestion = value;
  const packagingQuantity = parseDecimal(suggestion.packagingQuantity);
  const suggestedUnitsPerPack = parseDecimal(suggestion.suggestedUnitsPerPack);
  const suggestedPrice = parseDecimal(suggestion.suggestedPrice);

  return {
    packagingLabel: normalizeCellValue(suggestion.packagingLabel) || null,
    packagingQuantity,
    packagingUnit: normalizeCellValue(suggestion.packagingUnit) || null,
    suggestedUnitsPerPack,
    suggestedPrice,
    shouldSkipRow: Boolean(suggestion.shouldSkipRow),
    explanation: normalizeCellValue(suggestion.explanation) || null,
  };
}

async function suggestRowWithAi(row) {
  const provider = getAiProvider();

  if (!provider) {
    return null;
  }

  try {
    const response = await fetch(provider.completionsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
        ...provider.headers,
      },
      body: JSON.stringify({
        model: provider.model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You parse supplier price rows for supplier Красный дракон. Return JSON only with fields packagingLabel, packagingQuantity, packagingUnit, suggestedUnitsPerPack, suggestedPrice, shouldSkipRow, explanation. Do not rewrite the original product name. Extract packaging from the product name even if there are typos. packagingUnit must be one of: кг, г, л, мл, шт. suggestedUnitsPerPack and suggestedPrice may be returned only when the source cell is non-empty but malformed. If the source cell is empty, return null for that suggestion. shouldSkipRow=true only if the row is clearly not a product row. explanation should be short Russian text.",
          },
          {
            role: "user",
            content: JSON.stringify(row),
          },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      return null;
    }

    return normalizeAiSuggestion(JSON.parse(content));
  } catch {
    return null;
  }
}

function isEffectivelyEmptyRow(values) {
  return values.every((value) => !normalizeCellValue(value));
}

export function isRedDragonSupplierName(value) {
  return normalizeComparableText(value) === RED_DRAGON_NAME;
}

function applyRedDragonIdentityOverride(article, identity) {
  const override = RED_DRAGON_IDENTITY_OVERRIDES.get(normalizeComparableText(article));

  if (!override) {
    const byName = RED_DRAGON_NAME_OVERRIDES.find(
      (item) => normalizeComparableText(identity.name) === item.match,
    );

    if (!byName) {
      return identity;
    }

    return {
      ...identity,
      brand: byName.override.brand ?? identity.brand,
      country: byName.override.country ?? identity.country,
      source: "red_dragon_override",
      confidence: 1,
      explanation: "Подтвержденное правило для поставщика Красный дракон.",
    };
  }

  return {
    ...identity,
    brand: override.brand ?? identity.brand,
    country: override.country ?? identity.country,
    source: "red_dragon_override",
    confidence: 1,
    explanation: "Подтвержденное правило для поставщика Красный дракон.",
  };
}

export async function parseRedDragonSheetRows(rows) {
  const headerMatch = detectHeaderRow(rows);

  if (!headerMatch) {
    throw new Error(
      "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043d\u0430\u0439\u0442\u0438 \u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043a\u0438 \u043f\u0440\u0430\u0439\u0441\u0430 \"\u041a\u0440\u0430\u0441\u043d\u044b\u0439 \u0434\u0440\u0430\u043a\u043e\u043d\".",
    );
  }

  const headers = buildHeaderCandidates(rows, headerMatch.headerRowIndex, headerMatch.headerRowSpan);
  const products = [];
  let skippedCount = 0;
  let aiRowsUsed = 0;
  let identityAiRowsUsed = 0;
  const maxIdentityAiRows = 40;

  for (let rowIndex = headerMatch.headerRowIndex + headerMatch.headerRowSpan; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];

    if (isEffectivelyEmptyRow(row)) {
      continue;
    }

    const name = normalizeCellValue(row[headerMatch.fieldIndexes.name]);
    const article = normalizeCellValue(row[headerMatch.fieldIndexes.article]);
    const unitsPerPackRaw = normalizeCellValue(row[headerMatch.fieldIndexes.unitsPerPack]);
    const priceRaw = normalizeCellValue(row[headerMatch.fieldIndexes.price]);
    const countryRaw = normalizeCellValue(row[headerMatch.fieldIndexes.country]);

    if (!name || normalizeHeader(name) === normalizeHeader(NAME_HEADER)) {
      skippedCount += 1;
      continue;
    }

    let unitsPerPack = parseDecimal(unitsPerPackRaw);
    let price = parseDecimal(priceRaw);
    let packaging = extractPackagingFromName(name);

    const rawData = {};

    headers.forEach((header, index) => {
      if (!header || IGNORED_HEADERS.has(header)) {
        return;
      }

      rawData[header] = normalizeCellValue(row[index]);
    });

    const shouldAskAi =
      aiRowsUsed < MAX_RED_DRAGON_AI_ROWS &&
      (packaging === null || (unitsPerPack === null && unitsPerPackRaw.length > 0) || (price === null && priceRaw.length > 0));

    if (shouldAskAi) {
      const aiSuggestion = await suggestRowWithAi({
        supplierName: "\u041a\u0440\u0430\u0441\u043d\u044b\u0439 \u0434\u0440\u0430\u043a\u043e\u043d",
        productName: name,
        supplierSku: article || null,
        unitsPerPackRaw: unitsPerPackRaw || null,
        unitPriceRaw: priceRaw || null,
      });

      if (aiSuggestion?.shouldSkipRow) {
        skippedCount += 1;
        continue;
      }

      if (!packaging && aiSuggestion?.packagingLabel && aiSuggestion.packagingQuantity) {
        packaging = {
          label: aiSuggestion.packagingLabel,
          quantity: aiSuggestion.packagingQuantity,
          unit: normalizeComparableText(aiSuggestion.packagingUnit ?? ""),
        };
      }

      if (!unitsPerPack && unitsPerPackRaw.length > 0 && aiSuggestion?.suggestedUnitsPerPack) {
        unitsPerPack = aiSuggestion.suggestedUnitsPerPack;
      }

      if (!price && priceRaw.length > 0 && aiSuggestion?.suggestedPrice) {
        price = aiSuggestion.suggestedPrice;
      }

      if (aiSuggestion) {
        rawData.aiSource = providerSource();
        rawData.aiExplanation = aiSuggestion.explanation ?? "";
        aiRowsUsed += 1;
      }
    }

    if (!unitsPerPack) {
      rawData._warningUnitsPerPack = "true";
    }

    if (packaging) {
      rawData.detectedPackaging = packaging.label;
      rawData.detectedPackagingQuantity = packaging.quantity.toString();
      rawData.detectedPackagingUnit = packaging.unit;
    }

    if (!price) {
      rawData._issueUnitPrice = "true";
    }

    if (!article && !price && !unitsPerPack) {
      skippedCount += 1;
      continue;
    }

    const refinedIdentity = await refineParsedProductIdentity({
      rawName: name,
      parsedName: name,
      brand: null,
      country: null,
      rawBrand: null,
      rawCountry: countryRaw || null,
      supplierName: "\u041a\u0440\u0430\u0441\u043d\u044b\u0439 \u0434\u0440\u0430\u043a\u043e\u043d",
      disableAi: identityAiRowsUsed >= maxIdentityAiRows,
    });
    const finalIdentity = applyRedDragonIdentityOverride(article, refinedIdentity);

    if (refinedIdentity.usedAi) {
      identityAiRowsUsed += 1;
    }

    rawData.identityRefinerSource = finalIdentity.source;
    rawData.identityRefinerConfidence = finalIdentity.confidence?.toString() ?? "";
    rawData.identityRefinerExplanation = finalIdentity.explanation ?? "";

    products.push({
      name,
      article: article || null,
      brand: finalIdentity.brand,
      country: finalIdentity.country,
      unit: "\u0448\u0442",
      unitsPerPack,
      minOrderQuantity: null,
      orderStep: null,
      allowFractionalOrder: false,
      shipByBoxesOnly: false,
      price,
      stock: null,
      sourceRow: rowIndex + 1,
      rawData,
    });
  }

  return { products, skippedCount };
}

function providerSource() {
  if (process.env.POLZA_AI_API_KEY?.trim()) {
    return "polza";
  }

  if (process.env.OPENROUTER_API_KEY?.trim()) {
    return "openrouter";
  }

  return "local";
}
