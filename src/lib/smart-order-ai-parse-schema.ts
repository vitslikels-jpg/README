export const smartOrderAiParseUnitWhitelist = [
  "шт",
  "кг",
  "г",
  "л",
  "мл",
  "уп",
  "пач",
  "кор",
  "бут",
] as const;

export type SmartOrderAiParseUnit = (typeof smartOrderAiParseUnitWhitelist)[number];

export type SmartOrderAiParseRequest = {
  sourceText: string;
};

export type SmartOrderAiParsedItem = {
  originalLine: string;
  parsedName: string | null;
  quantity: string | null;
  unit: SmartOrderAiParseUnit | null;
  requestedSupplierName: string | null;
  brand: string | null;
  attributes: string[];
  comment: string | null;
  confidence: number;
  needsReview: boolean;
  reviewReason: string | null;
};

export type SmartOrderAiParseResponse = {
  items: SmartOrderAiParsedItem[];
};

export const smartOrderAiParseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "originalLine",
          "parsedName",
          "quantity",
          "unit",
          "requestedSupplierName",
          "brand",
          "attributes",
          "comment",
          "confidence",
          "needsReview",
          "reviewReason",
        ],
        properties: {
          originalLine: { type: "string" },
          parsedName: { type: ["string", "null"] },
          quantity: { type: ["string", "null"] },
          unit: {
            anyOf: [
              { type: "null" },
              { type: "string", enum: [...smartOrderAiParseUnitWhitelist] },
            ],
          },
          requestedSupplierName: { type: ["string", "null"] },
          brand: { type: ["string", "null"] },
          attributes: {
            type: "array",
            items: { type: "string" },
          },
          comment: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          needsReview: { type: "boolean" },
          reviewReason: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

const explicitSupplierPrefixes = ["Алиди", "Продстар", "Меридиан", "Восток-Запад"] as const;
const dangerousShortParsedNames = ["сыр", "масло", "рис", "картофель", "курица", "сахар"] as const;
const shorthandAttributeMap = [
  { short: "охл", long: "охлажденный" },
  { short: "зам", long: "замороженный" },
  { short: "с/к", long: "сырокопченый" },
  { short: "в/к", long: "варено-копченый" },
] as const;

function normalizeOptionalText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function normalizeConfidence(value: unknown) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  if (numericValue < 0) {
    return 0;
  }

  if (numericValue > 1) {
    return 1;
  }

  return numericValue;
}

function normalizeUnit(value: unknown) {
  const normalized = normalizeOptionalText(value)?.toLowerCase().replace(/\.$/, "") ?? null;

  if (!normalized) {
    return null;
  }

  return smartOrderAiParseUnitWhitelist.includes(normalized as SmartOrderAiParseUnit)
    ? (normalized as SmartOrderAiParseUnit)
    : null;
}

function normalizeAttributes(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const deduped = new Set<string>();

  for (const item of value) {
    const normalized = normalizeOptionalText(item);

    if (normalized && !/[�]/u.test(normalized)) {
      deduped.add(normalized);
    }
  }

  return Array.from(deduped);
}

function detectExplicitSupplierPrefix(originalLine: string) {
  const normalizedLine = originalLine.trim().toLowerCase();

  for (const supplierName of explicitSupplierPrefixes) {
    if (normalizedLine.startsWith(`${supplierName.toLowerCase()}:`)) {
      return supplierName;
    }
  }

  return null;
}

function extractTrailingQuantityAndUnit(originalLine: string) {
  const match = originalLine.match(/(\d+(?:[.,]\d+)?)\s*(шт|кг|г|л|мл|уп|пач|кор|бут)\s*$/iu);

  if (!match) {
    return { quantity: null, unit: null as SmartOrderAiParseUnit | null };
  }

  return {
    quantity: match[1]?.replace(",", ".") ?? null,
    unit: normalizeUnit(match[2]),
  };
}

function normalizeParsedItem(value: unknown): SmartOrderAiParsedItem {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const originalLine = String(source.originalLine ?? "").trim();
  let unit = normalizeUnit(source.unit);
  const explicitSupplierPrefix = detectExplicitSupplierPrefix(originalLine);
  let requestedSupplierName = normalizeOptionalText(source.requestedSupplierName) ?? explicitSupplierPrefix;
  const confidence = normalizeConfidence(source.confidence);
  const initialNeedsReview = Boolean(source.needsReview);
  let parsedName = normalizeOptionalText(source.parsedName);
  let quantity = normalizeOptionalText(source.quantity);
  let brand = normalizeOptionalText(source.brand);
  let attributes = normalizeAttributes(source.attributes);
  const comment = normalizeOptionalText(source.comment);
  let reviewReason = normalizeOptionalText(source.reviewReason);
  let needsReview = initialNeedsReview;
  const normalizedOriginalLine = originalLine.toLowerCase();
  const trailingQuantityAndUnit = extractTrailingQuantityAndUnit(originalLine);

  if (!quantity && trailingQuantityAndUnit.quantity) {
    quantity = trailingQuantityAndUnit.quantity;
  }

  if (!unit && trailingQuantityAndUnit.unit) {
    unit = trailingQuantityAndUnit.unit;
  }

  if (explicitSupplierPrefix && !requestedSupplierName) {
    requestedSupplierName = explicitSupplierPrefix;
  }

  if (explicitSupplierPrefix && brand === explicitSupplierPrefix) {
    brand = null;
  }

  if (!unit && normalizeOptionalText(source.unit)) {
    needsReview = true;
    reviewReason = reviewReason ?? "Неизвестная единица измерения";
  }

  if (!parsedName) {
    needsReview = true;
    reviewReason = reviewReason ?? "Не удалось выделить название";
  }

  if (attributes.includes("сливочное") && parsedName === "масло") {
    attributes = attributes.filter((attribute) => attribute !== "сливочное");
  }

  const normalizedShorthandAttributes: string[] = [];

  for (const attribute of attributes) {
    const attributeLower = attribute.toLowerCase();
    const shorthand = shorthandAttributeMap.find(
      (item) => attributeLower === item.long || attributeLower === item.short,
    );

    if (shorthand && (normalizedOriginalLine.includes(shorthand.short) || attributeLower === shorthand.long)) {
      normalizedShorthandAttributes.push(shorthand.short);
      continue;
    }

    normalizedShorthandAttributes.push(attribute);
  }

  attributes = Array.from(new Set(normalizedShorthandAttributes));

  for (const shorthand of shorthandAttributeMap) {
    if (normalizedOriginalLine.includes(shorthand.short) && !attributes.includes(shorthand.short)) {
      attributes.push(shorthand.short);
    }
  }

  if (parsedName === "масло" && /\bмасло\s+сливоч/u.test(normalizedOriginalLine)) {
    parsedName = "масло сливочное";
  }

  if (parsedName === "слив" || (parsedName === "сливки" && /\bслив\b/u.test(normalizedOriginalLine))) {
    parsedName = "сливки";
    needsReview = true;
    reviewReason = reviewReason ?? "Сокращение требует проверки";
  }

  if (!quantity || !unit) {
    needsReview = true;
    reviewReason = reviewReason ?? "Неполный разбор количества или единицы";
  }

  if (
    parsedName &&
    dangerousShortParsedNames.includes(parsedName.toLowerCase() as (typeof dangerousShortParsedNames)[number]) &&
    !requestedSupplierName &&
    !brand &&
    !comment &&
    attributes.length === 0 &&
    /^(сыр|масло|рис|картофель|курица|сахар)\s+\d+(?:[.,]\d+)?\s*(шт|кг|г|л|мл|уп|пач|кор|бут)$/iu.test(
      originalLine,
    )
  ) {
    needsReview = true;
    reviewReason = "Общий/опасный запрос требует проверки";
  }

  if (/\b6х6\b/iu.test(originalLine)) {
    needsReview = true;
    reviewReason = reviewReason ?? "Сложная фасовка требует проверки";
  }

  return {
    originalLine,
    parsedName,
    quantity,
    unit,
    requestedSupplierName,
    brand,
    attributes,
    comment,
    confidence,
    needsReview,
    reviewReason,
  };
}

export function validateSmartOrderAiParseResponse(value: unknown): SmartOrderAiParseResponse {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const items = Array.isArray(source.items) ? source.items : [];

  return {
    items: items.map(normalizeParsedItem),
  };
}

export function buildSmartOrderAiParsePrompt(sourceText: string) {
  return [
    "Ты разбираешь пользовательский заказ для Smart Order.",
    "Верни только JSON без markdown и без пояснений вне JSON.",
    "Твоя задача только извлечь структуру из текста.",
    "Не подбирай товар из базы.",
    "Не выбирай поставщика, кроме явно указанного в тексте.",
    "Не считай цену.",
    "Не делай matching.",
    "Если строка начинается с 'Алиди:', 'Продстар:', 'Меридиан:', 'Восток-Запад:' и дальше идут товары, это requestedSupplierName, а не brand.",
    `Единицы разрешены только: ${smartOrderAiParseUnitWhitelist.join(", ")}.`,
    "Если единица неясна, верни unit = null, needsReview = true.",
    "Если количество неясно, верни quantity = null.",
    "Если в строке есть бренд, положи его в brand, а не в parsedName.",
    "Если в строке есть атрибуты типа 82.5%, охл, зам, с/к, 6х6, положи их в attributes.",
    "Если в строке есть комментарий типа 'аналог можно', 'только этот товар', 'срочно', положи его в comment.",
    "Если исходная строка содержит 'масло сливоч...' или явную опечатку 'масло слывоч...' / 'масло слвоч...', не сокращай parsedName до 'масло'. Возвращай parsedName = 'масло сливочное'.",
    "Если parsedName после разбора ровно один из: сыр, масло, рис, картофель, курица, сахар — ставь needsReview = true только для общего короткого запроса без уточнений.",
    "Если есть хотя бы одно уточнение: brand, attributes, comment, requestedSupplierName или дополнительные слова в названии, не ставь needsReview только из-за опасности категории.",
    "Примеры без needsReview: 'сыр Galbani 500 г', 'курица Мираторг охл 10 кг', 'Алиди: рис 5 кг', 'Алиди: сахар 5 кг', 'сыр 2 кг аналог можно'.",
    "Примеры с needsReview: 'сыр 2 кг', 'масло 5 кг', 'рис 5 кг', 'картофель 20 кг', 'курица 10 кг', 'сахар 5 кг'.",
    "Исправляй очевидные опечатки в названии товара, если смысл однозначен.",
    "Примеры опечаток: малако -> молоко, слвочное -> сливочное, слывочное -> сливочное, макороны -> макароны, тросниковый -> тростниковый.",
    "Примеры сокращений: слив -> сливки, с/к -> сырокопченый, в/к -> варено-копченый, охл -> охлажденный, зам -> замороженный.",
    "Примеры разбора:",
    '- "масло сливочное 5 кг" -> parsedName: "масло сливочное", quantity: "5", unit: "кг", comment: null, needsReview: false',
    '- "масло слывочное 5 кг" -> parsedName: "масло сливочное", quantity: "5", unit: "кг", comment: null, needsReview: false',
    '- "масло сливочное только этот товар" -> parsedName: "масло сливочное", quantity: null, unit: null, comment: "только этот товар", needsReview: true',
    '- "масло сливочное 5 кг только этот товар" -> parsedName: "масло сливочное", quantity: "5", unit: "кг", comment: "только этот товар", needsReview: false',
    '- "бекон 3 кг, масло сливочное 5 кг" -> items: [{ parsedName: "бекон" }, { parsedName: "масло сливочное" }]',
    '- "слив 6 л" -> parsedName: "сливки", quantity: "6", unit: "л", needsReview: true, reviewReason: "Сокращение требует проверки"',
    '- "сливки 6х6 1 л" -> parsedName: "сливки", quantity: "1", unit: "л", attributes: ["6х6"], needsReview: true, reviewReason: "Подозрительный атрибут для сливок"',
    '- "Восток-Запад: сыр Galbani 500 г аналог можно" -> parsedName: "сыр", requestedSupplierName: "Восток-Запад", brand: "Galbani", comment: "аналог можно", needsReview: true',
    "Формат ответа: объект { items: SmartOrderAiParsedItem[] }.",
    "",
    "Текст заказа:",
    sourceText,
  ].join("\n");
}
