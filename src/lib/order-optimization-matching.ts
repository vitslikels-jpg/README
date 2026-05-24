import { Prisma, type OrderOptimizationItem, type Product, type Supplier } from "@prisma/client";
import { getOrderOptimizationWithDetails, normalizeOrderOptimizationUnit } from "@/lib/order-optimizations";
import { prisma } from "@/lib/prisma";

type ProductCandidate = Pick<
  Product,
  | "id"
  | "enterpriseId"
  | "supplierId"
  | "documentId"
  | "name"
  | "article"
  | "brand"
  | "country"
  | "unit"
  | "unitsPerPack"
  | "minOrderQuantity"
  | "orderStep"
  | "allowFractionalOrder"
  | "shipByBoxesOnly"
  | "price"
  | "stock"
  | "sourceRow"
  | "rawData"
  | "createdAt"
  | "updatedAt"
> & {
  supplier: Pick<Supplier, "id" | "name" | "archivedAt">;
};

type ProductForPack = Pick<Product, "unit" | "unitsPerPack" | "minOrderQuantity" | "orderStep" | "rawData">;

type PackagingSource = {
  unit: string | null;
  unitsPerPack: Prisma.Decimal | null | undefined;
  minOrderQuantity: Prisma.Decimal | null | undefined;
  orderStep: Prisma.Decimal | null | undefined;
  rawData: Prisma.JsonValue;
};

type CoverageMode = "nearest_lower" | "no_shortage";

export type OrderOptimizationCoverage = {
  mode: CoverageMode;
  requiredAmount: string | null;
  packSize: string | null;
  suggestedPacksCount: number | null;
  totalCoveredAmount: string | null;
  overage: string | null;
  shortage: string | null;
};

type CandidateCoverage = {
  mode: CoverageMode;
  requiredAmount: Prisma.Decimal;
  packSize: Prisma.Decimal;
  suggestedPacksCount: number;
  totalCoveredAmount: Prisma.Decimal;
  overage: Prisma.Decimal;
  shortage: Prisma.Decimal;
};

type ScoredProductCandidate = {
  product: ProductCandidate;
  score: number;
  matchedTokensCount: number;
  totalTokensCount: number;
  matchedRatio: number;
  firstTokenMatched: boolean;
  supplierMatched: boolean;
  hasUnitSupport: boolean;
  exactPhraseMatch: boolean;
};

type ScoredCatalogCandidate = {
  candidate: CatalogCandidate;
  score: number;
  matchedTokensCount: number;
  totalTokensCount: number;
  matchedRatio: number;
  exactPhraseAtStart: boolean;
  startsWithFirstToken: boolean;
  exactPhraseMatch: boolean;
  negativeAdjustment: number;
};

type CatalogCandidate = {
  supplierOfferId: string;
  supplierId: string;
  supplierName: string;
  supplierArchivedAt: Date | null;
  name: string;
  article: string | null;
  brand: string | null;
  unit: string | null;
  unitsPerPack: Prisma.Decimal | null | undefined;
  minOrderQuantity: Prisma.Decimal | null | undefined;
  orderStep: Prisma.Decimal | null | undefined;
  rawData: unknown;
  currentPriceSnapshot: {
    id: string;
    price: Prisma.Decimal | null;
    rawData: unknown;
    legacyProductId: string | null;
    legacyProduct: ProductCandidate | null;
  } | null;
  productMaster: {
    id: string;
    name: string;
    category: string | null;
  } | null;
  mapping: {
    id: string;
    productMasterId: string | null;
    confidence: Prisma.Decimal | null;
    matchSource: string | null;
  } | null;
};

type CandidateSource = "catalog" | "product_fallback";

type SmartOrderProductSearchResult = {
  candidateSource: CandidateSource;
  candidates: ScoredProductCandidate[];
};

type CandidatePlanRow = Prisma.OrderOptimizationResultCreateInput & {
  item: {
    connect: {
      id: string;
    };
  };
  optimization: {
    connect: {
      id: string;
    };
  };
  selectedSupplier?: {
    connect: {
      id: string;
    };
  };
  selectedProduct?: {
    connect: {
      id: string;
    };
  };
};

type ItemCandidatePlan = {
  itemId: string;
  rows: Array<{
    data: CandidatePlanRow;
    score: number;
    matchedTokensCount: number;
    totalTokensCount: number;
    matchedRatio: number;
    firstTokenMatched: boolean;
    supplierMatched: boolean;
    hasUnitSupport: boolean;
    exactPhraseMatch: boolean;
  }>;
  matchStatus: "review" | "not_found";
  autoSelectedIndex: number | null;
};

const ZERO = new Prisma.Decimal(0);
const ONE = new Prisma.Decimal(1);
const MAX_PRODUCTS_TO_SCORE = 400;
const MAX_RESULTS_PER_ITEM = 8;
const SEARCH_RESULTS_PER_REQUEST = 24;
const SEARCH_RESULTS_PER_SUPPLIER = 4;
const SAFE_CATALOG_PRIMARY_QUERIES = new Set([
  "бекон",
  "сливки",
  "сыр",
  "масло сливочное",
  "молоко",
  "курица",
]);
const DANGEROUS_CATALOG_QUERIES = new Set(["сахар", "картофель", "рис"]);
const CATALOG_NEGATIVE_PREPOSITIONS = new Set([
  "\u0434\u043b\u044f",
  "\u0441\u043e",
  "\u0441",
  "\u0432",
  "\u0438\u0437",
]);
const CATALOG_NEGATIVE_LEAD_WORDS = [
  "\u0441\u043e\u0443\u0441",
  "\u043f\u0430\u0441\u0442\u0430",
  "\u043b\u0430\u043f\u0448\u0430",
  "\u043d\u044c\u043e\u043a\u043a\u0438",
] as const;
const RUSSIAN_TOKEN_ENDINGS = [
  "иями",
  "ями",
  "ами",
  "ого",
  "ему",
  "ому",
  "ыми",
  "ими",
  "ая",
  "яя",
  "ое",
  "ее",
  "ые",
  "ие",
  "ый",
  "ий",
  "ой",
  "ую",
  "юю",
  "ам",
  "ям",
  "ах",
  "ях",
  "ов",
  "ев",
  "ей",
  "ом",
  "ем",
  "ою",
  "ею",
  "ы",
  "и",
  "а",
  "я",
  "о",
  "е",
  "у",
  "ю",
  "ь",
] as const;

function decimalToString(value: Prisma.Decimal | null | undefined) {
  return value ? value.toDecimalPlaces(3).toString() : null;
}

function normalizeSearchText(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSearchTokens(value: string | null | undefined) {
  return normalizeSearchText(value)
    .split(" ")
    .filter((token) => token.length > 1)
    .flatMap((token) => expandSearchToken(token))
    .filter((token, index, array) => array.indexOf(token) === index);
}

function normalizeSearchToken(token: string) {
  let normalized = token.trim().toLowerCase();

  if (!normalized) {
    return normalized;
  }

  const exactRoots: Array<[RegExp, string]> = [
    [/^яйц(?:о|а|у|е|ом|ами|ах)?$/u, "яйц"],
    [/^курин(?:ый|ая|ое|ые|ого|ому|ым|ой|ую|ыми|ых|ом)?$/u, "кур"],
    [/^перепелин(?:ый|ая|ое|ые|ого|ому|ым|ой|ую|ыми|ых|ом)?$/u, "перепел"],
    [/^томат(?:ы|а|ов|ам|ами|ах)?$/u, "томат"],
    [/^томатн(?:ый|ая|ое|ые|ого|ому|ым|ой|ую|ыми|ых|ом)?$/u, "томат"],
    [/^паст(?:а|ы|е|у|ой|ами|ах)?$/u, "паст"],
  ];

  for (const [pattern, replacement] of exactRoots) {
    if (pattern.test(normalized)) {
      return replacement;
    }
  }

  for (const ending of RUSSIAN_TOKEN_ENDINGS) {
    if (normalized.length <= ending.length + 2 || !normalized.endsWith(ending)) {
      continue;
    }

    normalized = normalized.slice(0, -ending.length);
    break;
  }

  return normalized;
}

function expandSearchToken(token: string) {
  const variants = new Set<string>();
  const normalized = token.trim().toLowerCase();

  if (normalized.length <= 1) {
    return [];
  }

  variants.add(normalized);

  const normalizedRoot = normalizeSearchToken(normalized);

  if (normalizedRoot.length > 1) {
    variants.add(normalizedRoot);
  }

  if (normalizedRoot === "яйц") {
    variants.add("кур");
  }

  if (normalizedRoot === "томат") {
    variants.add("паст");
  }

  return Array.from(variants);
}

function buildSearchTokenSet(value: string | null | undefined) {
  return new Set(getSearchTokens(value));
}

function getNormalizedWords(value: string | null | undefined) {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

function getSemanticScoreAdjustment(searchTokens: string[], productTokens: Set<string>) {
  const queryTokens = new Set(searchTokens);
  let score = 0;

  if (queryTokens.has("яйц")) {
    if (productTokens.has("яйц")) {
      score += 24;
    }
    if (productTokens.has("кур")) {
      score += 18;
    }
    if (productTokens.has("перепел")) {
      score -= 4;
    }
    if (productTokens.has("макарон") || productTokens.has("паст")) {
      score -= 90;
    }
  }

  if (queryTokens.has("томат")) {
    if (productTokens.has("томат")) {
      score += 24;
    }
    if (productTokens.has("паст")) {
      score += 28;
    }
    if (productTokens.has("макарон")) {
      score -= 50;
    }
  }

  return score;
}

function getCatalogPhraseScoreAdjustment(params: {
  normalizedQuery: string;
  queryWordRoots: string[];
  candidateName: string;
  candidateWordRoots: string[];
  productMasterName: string;
}) {
  const { normalizedQuery, queryWordRoots, candidateName, candidateWordRoots, productMasterName } = params;

  if (!normalizedQuery) {
    return 0;
  }

  let score = 0;
  const firstQueryRoot = queryWordRoots[0] ?? null;

  if (candidateName.startsWith(normalizedQuery)) {
    score += 140;
  } else if (candidateName.includes(normalizedQuery)) {
    score += 36;
  }

  if (normalizedQuery === "сыр" && candidateName.startsWith("сыр")) {
    score += 220;
  }

  if (normalizedQuery === "масло сливочное" && candidateName.startsWith("масло сливочное")) {
    score += 260;
  }

  if (normalizedQuery === "рис" && candidateName.startsWith("рис ")) {
    score += 180;
  }

  if (normalizedQuery === "курица" && candidateName.startsWith("курица ")) {
    score += 140;
  }

  if (productMasterName.startsWith(normalizedQuery)) {
    score += 28;
  }

  if (firstQueryRoot && candidateWordRoots[0] === firstQueryRoot) {
    score += 18;
  }

  return score;
}

function getCatalogNegativeScoreAdjustment(params: {
  normalizedQuery: string;
  queryWords: string[];
  queryWordRoots: string[];
  candidateName: string;
  candidateWords: string[];
  candidateWordRoots: string[];
}) {
  const { normalizedQuery, queryWords, queryWordRoots, candidateName, candidateWords, candidateWordRoots } = params;

  if (!normalizedQuery || queryWords.length === 0 || queryWords.length > 2) {
    return 0;
  }

  let penalty = 0;
  const seenPenalties = new Set<string>();
  const firstCandidateWord = candidateWords[0] ?? "";
  const singleQueryWord = queryWords.length === 1 ? queryWords[0] : null;
  const singleQueryRoot = queryWordRoots.length === 1 ? queryWordRoots[0] : null;
  const queryLooksLikeOil = queryWordRoots.some((token) => token.startsWith("\u043c\u0430\u0441"));
  const isCheeseQuery = normalizedQuery === "сыр";
  const isButterQuery = normalizedQuery === "масло сливочное";
  const isRiceQuery = normalizedQuery === "рис";
  const isChickenQuery = normalizedQuery === "курица";

  if (CATALOG_NEGATIVE_LEAD_WORDS.includes(firstCandidateWord as (typeof CATALOG_NEGATIVE_LEAD_WORDS)[number])) {
    penalty -= 75;
    seenPenalties.add(`lead:${firstCandidateWord}`);
  }

  if (candidateName.includes("\u0432\u043a\u0443\u0441 ")) {
    penalty -= 35;
  }

  if (candidateName.includes("\u0441\u043e\u0443\u0441 ")) {
    penalty -= 80;
  }

  if (candidateName.includes("\u0441\u044b\u0440\u043e\u0432\u044f\u043b\u0435\u043d")) {
    penalty -= 95;
  }

  if (isCheeseQuery) {
    if (!candidateWords[0]?.startsWith("сыр")) {
      penalty -= 140;
    }

    if (candidateName.includes("сыровялен")) {
      penalty -= 240;
    }

    const cheeseIndex = candidateWords.findIndex((word) => word.startsWith("сыр"));

    if (cheeseIndex > 0) {
      const previousWord = candidateWords[cheeseIndex - 1] ?? "";

      if (["с", "со", "фаршированный", "начинка", "вкус"].includes(previousWord)) {
        penalty -= 260;
      } else {
        penalty -= 120;
      }
    }
  }

  if (isButterQuery) {
    if (candidateName.startsWith("масло сливочное")) {
      penalty += 0;
    } else {
      if (!candidateWords.includes("сливочное")) {
        penalty -= 320;
      }

      if (candidateName.includes("в масле")) {
        penalty -= 260;
      }

      if (candidateName.includes("подсолнечном масле")) {
        penalty -= 280;
      }

      if (candidateName.includes("оливковом масле")) {
        penalty -= 280;
      }

      if (candidateName.includes("томаты вяленые в масле")) {
        penalty -= 320;
      }

      if (candidateName.includes("каперсы в масле")) {
        penalty -= 320;
      }
    }
  }

  if (isRiceQuery) {
    if (candidateName.includes("со вкусом")) {
      penalty -= 140;
    }

    if (candidateName.includes("быстрого приготовления")) {
      penalty -= 180;
    }

    if (candidateName.includes("лапша")) {
      penalty -= 170;
    }

    if (candidateName.includes("паста")) {
      penalty -= 170;
    }

    if (candidateName.includes("из риса")) {
      penalty -= 170;
    }

    if (candidateName.includes("рисовая")) {
      penalty -= 160;
    }
  }

  if (isChickenQuery) {
    if (candidateName.includes("со вкусом")) {
      penalty -= 150;
    }

    if (candidateName.includes("для курицы")) {
      penalty -= 220;
    }

    if (candidateName.includes("заливная")) {
      penalty -= 180;
    }

    if (candidateName.includes("специи")) {
      penalty -= 220;
    }

    if (candidateName.includes("приправа")) {
      penalty -= 220;
    }

    if (candidateName.includes("суповой набор")) {
      penalty -= 180;
    } else if (candidateName.includes("суп")) {
      penalty -= 120;
    }

    if (candidateName.includes("15гр")) {
      penalty -= 150;
    }

    if (candidateName.includes("10шт")) {
      penalty -= 120;
    }

    const hasRealChickenCut = [
      "филе",
      "бедро",
      "окороч",
      "голень",
      "грудк",
      "крыл",
      "тушк",
    ].some((token) => candidateName.includes(token));

    if (hasRealChickenCut) {
      penalty += 90;
    }
  }

  for (let index = 0; index < candidateWordRoots.length; index += 1) {
    const candidateRoot = candidateWordRoots[index];

    if (!queryWordRoots.includes(candidateRoot)) {
      continue;
    }

    const previousWord = candidateWords[index - 1] ?? "";
    const previousTwoWords = candidateWords.slice(Math.max(0, index - 2), index);

    if (CATALOG_NEGATIVE_PREPOSITIONS.has(previousWord)) {
      const key = `prep:${previousWord}:${candidateRoot}`;

      if (!seenPenalties.has(key)) {
        penalty -= 55;
        seenPenalties.add(key);
      }
    }

    if (
      queryLooksLikeOil &&
      previousTwoWords.includes("\u0432") &&
      candidateWords[index] !== queryWords[0] &&
      candidateWords[index] !== queryWords[1]
    ) {
      const key = `oil-context:${index}`;

      if (!seenPenalties.has(key)) {
        penalty -= 70;
        seenPenalties.add(key);
      }
    }
  }

  if (singleQueryWord && singleQueryRoot) {
    for (let index = 0; index < candidateWords.length; index += 1) {
      const candidateWord = candidateWords[index];
      const candidateRoot = candidateWordRoots[index];

      if (!candidateWord.includes(singleQueryWord)) {
        continue;
      }

      if (candidateWord === singleQueryWord || candidateRoot === singleQueryRoot) {
        continue;
      }

      penalty -= 110;
      break;
    }
  }

  return penalty;
}

function convertAmountToUnit(amount: Prisma.Decimal, sourceUnit: string | null, targetUnit: string | null) {
  if (!sourceUnit || !targetUnit) {
    return null;
  }

  if (sourceUnit === targetUnit) {
    return amount;
  }

  if (sourceUnit === "г" && targetUnit === "кг") {
    return amount.div(1000);
  }

  if (sourceUnit === "кг" && targetUnit === "г") {
    return amount.mul(1000);
  }

  if (sourceUnit === "мл" && targetUnit === "л") {
    return amount.div(1000);
  }

  if (sourceUnit === "л" && targetUnit === "мл") {
    return amount.mul(1000);
  }

  return null;
}

function parsePackagingAmount(value: unknown, targetUnit: string | null) {
  if (!targetUnit) {
    return null;
  }

  const text = String(value ?? "");
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(кг|килограмм(?:а|ов|ы)?|г|гр|грамм(?:а|ов|ы)?|л|литр(?:а|ов|ы)?|мл|шт|штук|штуки|штука)/iu);

  if (!match) {
    return null;
  }

  const amount = new Prisma.Decimal(match[1].replace(",", "."));
  const sourceUnit = normalizeOrderOptimizationUnit(match[2]);

  return convertAmountToUnit(amount, sourceUnit, targetUnit);
}

function findRawPackagingAmount(rawData: Prisma.JsonValue, targetUnit: string | null) {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    return null;
  }

  const values = Object.values(rawData);

  for (const value of values) {
    const amount = parsePackagingAmount(value, targetUnit);

    if (amount?.gt(ZERO)) {
      return amount;
    }
  }

  return null;
}

function getPackagingSourceFromProduct(product: ProductForPack): PackagingSource {
  // TODO: add support for SupplierOffer + PriceSnapshot.rawData without changing packaging math.
  return {
    unit: product.unit,
    unitsPerPack: product.unitsPerPack,
    minOrderQuantity: product.minOrderQuantity,
    orderStep: product.orderStep,
    rawData: product.rawData,
  };
}

function getPackSize(product: ProductForPack, item: Pick<OrderOptimizationItem, "parsedUnit">) {
  const packagingSource = getPackagingSourceFromProduct(product);
  const requiredUnit = normalizeOrderOptimizationUnit(item.parsedUnit);
  const productUnit = normalizeOrderOptimizationUnit(packagingSource.unit);
  const rawPackagingAmount = findRawPackagingAmount(packagingSource.rawData, requiredUnit);

  if (rawPackagingAmount?.gt(ZERO)) {
    return rawPackagingAmount;
  }

  if (productUnit === requiredUnit) {
    return packagingSource.unitsPerPack ?? packagingSource.orderStep ?? packagingSource.minOrderQuantity ?? ONE;
  }

  if (requiredUnit === "\u0448\u0442") {
    return packagingSource.unitsPerPack ?? ONE;
  }

  return null;
}

function buildCoverageVariants(requiredAmount: Prisma.Decimal | null, packSize: Prisma.Decimal | null) {
  if (!requiredAmount || requiredAmount.lte(ZERO) || !packSize || packSize.lte(ZERO)) {
    return [];
  }

  const ratio = requiredAmount.div(packSize);
  const lowerPacks = Math.floor(Number(ratio.toString()));
  const upperPacks = Math.ceil(Number(ratio.toString()));
  const packCounts = Array.from(new Set([lowerPacks, Math.max(upperPacks, 1)])).filter((packsCount) => packsCount > 0);

  return packCounts.map<CandidateCoverage>((packsCount) => {
    const totalCoveredAmount = packSize.mul(packsCount);
    const shortage = Prisma.Decimal.max(requiredAmount.sub(totalCoveredAmount), ZERO);
    const overage = Prisma.Decimal.max(totalCoveredAmount.sub(requiredAmount), ZERO);

    return {
      mode: shortage.gt(ZERO) ? "nearest_lower" : "no_shortage",
      requiredAmount,
      packSize,
      suggestedPacksCount: packsCount,
      totalCoveredAmount,
      overage,
      shortage,
    };
  });
}

function serializeCoverage(coverage: CandidateCoverage | null | undefined): OrderOptimizationCoverage | null {
  if (!coverage) {
    return null;
  }

  return {
    mode: coverage.mode,
    requiredAmount: decimalToString(coverage.requiredAmount),
    packSize: decimalToString(coverage.packSize),
    suggestedPacksCount: coverage.suggestedPacksCount,
    totalCoveredAmount: decimalToString(coverage.totalCoveredAmount),
    overage: decimalToString(coverage.overage),
    shortage: decimalToString(coverage.shortage),
  };
}

function isUsefulCoverageVariant(variant: CandidateCoverage, unitPrice: Prisma.Decimal | null | undefined) {
  if (variant.suggestedPacksCount <= 0 || variant.totalCoveredAmount.lte(ZERO)) {
    return false;
  }

  if (unitPrice && unitPrice.mul(variant.suggestedPacksCount).lte(ZERO)) {
    return false;
  }

  return true;
}

export function calculateOrderOptimizationCoverage(params: {
  requiredAmount: Prisma.Decimal | null | undefined;
  requiredUnit: string | null | undefined;
  product: ProductForPack | null | undefined;
  mode?: CoverageMode;
}) {
  if (!params.product || !params.requiredAmount || !params.requiredUnit) {
    return null;
  }

  const packSize = getPackSize(params.product, { parsedUnit: params.requiredUnit });
  const variants = buildCoverageVariants(params.requiredAmount, packSize);
  const wantedMode = params.mode ?? "no_shortage";

  return serializeCoverage(
    variants.find((variant) => variant.mode === wantedMode) ?? variants.find((variant) => variant.mode === "no_shortage") ?? variants[0],
  );
}

function scoreProduct(item: OrderOptimizationItem, product: ProductCandidate) {
  const itemTokens = getSearchTokens(item.parsedName);
  const productTokens = buildSearchTokenSet(`${product.name} ${product.brand ?? ""} ${product.article ?? ""}`);
  const matchedTokens = itemTokens.filter((token) => productTokens.has(token));

  if (matchedTokens.length === 0) {
    return 0;
  }

  const itemUnit = normalizeOrderOptimizationUnit(item.parsedUnit);
  const productUnit = normalizeOrderOptimizationUnit(product.unit);
  const supplierName = normalizeSearchText(product.supplier.name);
  const requestedSupplier = normalizeSearchText(item.requestedSupplierName);
  const packSize = getPackSize(product, item);
  const coverageVariants = buildCoverageVariants(item.parsedQuantity, packSize);
  const noShortageVariant = coverageVariants.find((variant) => variant.mode === "no_shortage");
  const unitScore = itemUnit && (productUnit === itemUnit || packSize) ? 30 : 0;
  const supplierScore = requestedSupplier && supplierName.includes(requestedSupplier) ? 12 : 0;
  const priceScore = product.price ? 3 : 0;
  const coverageScore = noShortageVariant ? Math.max(0, 10 - Number(noShortageVariant.overage.toString())) : 0;

  return matchedTokens.length * 20 + unitScore + supplierScore + priceScore + coverageScore;
}

function getCandidateFit(
  item: OrderOptimizationItem,
  product: ProductCandidate,
  searchText: string | null | undefined = item.parsedName,
): ScoredProductCandidate {
  const itemTokens = getSearchTokens(searchText);
  const productText = normalizeSearchText(`${product.name} ${product.brand ?? ""} ${product.article ?? ""}`);
  const productTokens = buildSearchTokenSet(productText);
  const matchedTokens = itemTokens.filter((token) => productTokens.has(token));
  const itemUnit = normalizeOrderOptimizationUnit(item.parsedUnit);
  const productUnit = normalizeOrderOptimizationUnit(product.unit);
  const supplierName = normalizeSearchText(product.supplier.name);
  const requestedSupplier = normalizeSearchText(item.requestedSupplierName);
  const packSize = getPackSize(product, item);
  const normalizedItemName = normalizeSearchText(searchText);
  const firstItemToken = getSearchTokens(searchText)[0] ?? null;

  return {
    product,
    score:
      scoreProduct(item, product) +
      (matchedTokens.length > 0 ? matchedTokens.length * 8 : 0) +
      getSemanticScoreAdjustment(itemTokens, productTokens) +
      (normalizedItemName && productText.includes(normalizedItemName) ? 12 : 0),
    matchedTokensCount: matchedTokens.length,
    totalTokensCount: itemTokens.length,
    matchedRatio: itemTokens.length > 0 ? matchedTokens.length / itemTokens.length : 0,
    firstTokenMatched: firstItemToken ? productTokens.has(firstItemToken) : false,
    supplierMatched: Boolean(requestedSupplier) ? supplierName.includes(requestedSupplier) : true,
    hasUnitSupport: Boolean(itemUnit && (productUnit === itemUnit || packSize)),
    exactPhraseMatch: Boolean(normalizedItemName && productText.includes(normalizedItemName)),
  };
}

function compareScoredCandidates(left: ScoredProductCandidate, right: ScoredProductCandidate) {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  if (right.matchedRatio !== left.matchedRatio) {
    return right.matchedRatio - left.matchedRatio;
  }

  if (left.exactPhraseMatch !== right.exactPhraseMatch) {
    return left.exactPhraseMatch ? -1 : 1;
  }

  if (left.hasUnitSupport !== right.hasUnitSupport) {
    return left.hasUnitSupport ? -1 : 1;
  }

  if (left.supplierMatched !== right.supplierMatched) {
    return left.supplierMatched ? -1 : 1;
  }

  const leftPrice = left.product.price ? Number(left.product.price.toString()) : Number.POSITIVE_INFINITY;
  const rightPrice = right.product.price ? Number(right.product.price.toString()) : Number.POSITIVE_INFINITY;

  return leftPrice - rightPrice;
}

function diversifyCandidates(candidates: ScoredProductCandidate[], maxResults: number, maxPerSupplier: number) {
  const supplierBuckets = new Map<string, ScoredProductCandidate[]>();

  for (const candidate of candidates) {
    const bucket = supplierBuckets.get(candidate.product.supplierId) ?? [];

    if (bucket.length < maxPerSupplier) {
      bucket.push(candidate);
      supplierBuckets.set(candidate.product.supplierId, bucket);
    }
  }

  const orderedBuckets = Array.from(supplierBuckets.values()).sort((left, right) =>
    compareScoredCandidates(left[0], right[0]),
  );
  const diversified: ScoredProductCandidate[] = [];
  const usedProductIds = new Set<string>();
  let bucketIndex = 0;

  while (diversified.length < maxResults && orderedBuckets.some((bucket) => bucketIndex < bucket.length)) {
    for (const bucket of orderedBuckets) {
      const candidate = bucket[bucketIndex];

      if (!candidate || usedProductIds.has(candidate.product.id)) {
        continue;
      }

      diversified.push(candidate);
      usedProductIds.add(candidate.product.id);

      if (diversified.length >= maxResults) {
        break;
      }
    }

    bucketIndex += 1;
  }

  if (diversified.length >= maxResults) {
    return diversified;
  }

  for (const candidate of candidates) {
    if (usedProductIds.has(candidate.product.id)) {
      continue;
    }

    diversified.push(candidate);
    usedProductIds.add(candidate.product.id);

    if (diversified.length >= maxResults) {
      break;
    }
  }

  return diversified;
}

async function findCandidateProducts(
  item: OrderOptimizationItem,
  enterpriseId: string,
  options?: {
    searchText?: string | null;
    maxProducts?: number;
    maxPerSupplier?: number;
  },
) {
  const searchText = options?.searchText ?? item.parsedName;
  const tokens = getSearchTokens(searchText).slice(0, 6);

  if (tokens.length === 0) {
    return [];
  }

  const products = await prisma.product.findMany({
    where: {
      enterpriseId,
      supplier: {
        archivedAt: null,
      },
      document: {
        isCurrent: true,
      },
      OR: tokens.flatMap((token) => [
        {
          name: {
            contains: token,
            mode: "insensitive",
          },
        },
        {
          article: {
            contains: token,
            mode: "insensitive",
          },
        },
        {
          brand: {
            contains: token,
            mode: "insensitive",
          },
        },
      ]),
    },
    include: {
      supplier: {
        select: {
          id: true,
          name: true,
          archivedAt: true,
        },
      },
    },
    take: MAX_PRODUCTS_TO_SCORE,
  });

  const scoredCandidates = products
    .map((product) => getCandidateFit(item, product, searchText))
    .filter((candidate) => candidate.score > 0)
    .sort(compareScoredCandidates);

  return diversifyCandidates(
    scoredCandidates,
    options?.maxProducts ?? Math.max(4, Math.ceil(MAX_RESULTS_PER_ITEM / 2)),
    options?.maxPerSupplier ?? 2,
  );
}

function getCatalogStrongGarbageSignals(query: string, candidateName: string) {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedName = normalizeSearchText(candidateName);

  if (normalizedQuery === "сыр") {
    return (
      normalizedName.includes("сыровялен") ||
      normalizedName.includes(" с сыром") ||
      normalizedName.includes(" со сливочным сыром") ||
      normalizedName.includes(" фаршированный сыром")
    );
  }

  if (normalizedQuery === "масло сливочное") {
    return (
      normalizedName.includes("в масле") ||
      normalizedName.includes("подсолнечном масле") ||
      normalizedName.includes("оливковом масле")
    );
  }

  if (normalizedQuery === "курица") {
    return (
      normalizedName.includes("для курицы") ||
      normalizedName.includes("специи") ||
      normalizedName.includes("приправа") ||
      normalizedName.includes("суповой набор") ||
      normalizedName.includes(" заливная")
    );
  }

  if (normalizedQuery === "рис") {
    return (
      normalizedName.includes("со вкусом") ||
      normalizedName.includes("быстрого приготовления") ||
      normalizedName.includes("рисовая") ||
      normalizedName.includes("лапша") ||
      normalizedName.includes("паста") ||
      normalizedName.includes("из риса") ||
      normalizedName.includes("готовый в вакууме")
    );
  }

  return false;
}

function isCatalogQueryAllowedAsPrimary(query: string) {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery || DANGEROUS_CATALOG_QUERIES.has(normalizedQuery)) {
    return false;
  }

  return SAFE_CATALOG_PRIMARY_QUERIES.has(normalizedQuery);
}

function isCatalogSearchSafe(query: string, candidates: ScoredCatalogCandidate[]) {
  const normalizedQuery = normalizeSearchText(query);

  if (!isCatalogQueryAllowedAsPrimary(normalizedQuery)) {
    return false;
  }

  if (candidates.length < 3) {
    return false;
  }

  const topOne = candidates[0];
  const topTwo = candidates[1];

  if (!topOne) {
    return false;
  }

  const topOneClearlyStronger =
    !topTwo ||
    topOne.score > topTwo.score ||
    (topOne.exactPhraseAtStart && topTwo.exactPhraseAtStart) ||
    topOne.negativeAdjustment > topTwo.negativeAdjustment;

  if (!topOneClearlyStronger) {
    return false;
  }

  const topFive = candidates.slice(0, 5);

  if (topFive.some((candidate) => getCatalogStrongGarbageSignals(normalizedQuery, candidate.candidate.name))) {
    return false;
  }

  return true;
}

function mapCatalogCandidateToLegacyProduct(candidate: CatalogCandidate): ProductCandidate | null {
  return candidate.currentPriceSnapshot?.legacyProduct ?? null;
}

async function findCatalogCandidateProductsWithScores(
  item: OrderOptimizationItem,
  enterpriseId: string,
  options?: {
    searchText?: string | null;
    maxProducts?: number;
  },
): Promise<ScoredCatalogCandidate[]> {
  const searchText = options?.searchText ?? item.parsedName;
  const requestedMaxProducts = options?.maxProducts ?? MAX_PRODUCTS_TO_SCORE;
  const rawTake = Math.min(Math.max(requestedMaxProducts * 20, 200), 500);
  const tokens = getSearchTokens(searchText).slice(0, 6);

  if (tokens.length === 0) {
    return [];
  }

  const supplierOffers = await prisma.supplierOffer.findMany({
    where: {
      enterpriseId,
      supplier: {
        archivedAt: null,
      },
      priceSnapshots: {
        some: {
          isCurrent: true,
        },
      },
      OR: tokens.flatMap((token) => [
        {
          name: {
            contains: token,
            mode: "insensitive",
          },
        },
        {
          article: {
            contains: token,
            mode: "insensitive",
          },
        },
        {
          brand: {
            contains: token,
            mode: "insensitive",
          },
        },
        {
          mappings: {
            some: {
              status: "active",
              productMaster: {
                normalizedName: {
                  contains: token,
                },
              },
            },
          },
        },
      ]),
    },
    include: {
      supplier: {
        select: {
          id: true,
          name: true,
          archivedAt: true,
        },
      },
      unit: {
        select: {
          symbol: true,
        },
      },
      priceSnapshots: {
        where: {
          isCurrent: true,
        },
        orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: {
          id: true,
          price: true,
          rawData: true,
          legacyProductId: true,
          legacyProduct: {
            select: {
              id: true,
              enterpriseId: true,
              supplierId: true,
              documentId: true,
              name: true,
              article: true,
              brand: true,
              country: true,
              unit: true,
              unitsPerPack: true,
              minOrderQuantity: true,
              orderStep: true,
              allowFractionalOrder: true,
              shipByBoxesOnly: true,
              price: true,
              stock: true,
              sourceRow: true,
              rawData: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      },
      mappings: {
        where: {
          status: "active",
        },
        orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: {
          id: true,
          productMasterId: true,
          confidence: true,
          matchSource: true,
          productMaster: {
            select: {
              id: true,
              name: true,
              category: true,
            },
          },
        },
      },
    },
    take: rawTake,
  });

  // TODO: next step - enable catalog search as primary and Product search as fallback.
  const candidates = supplierOffers.map((offer) => {
    const currentPriceSnapshot = offer.priceSnapshots[0] ?? null;
    const activeMapping = offer.mappings[0] ?? null;

    return {
      supplierOfferId: offer.id,
      supplierId: offer.supplierId,
      supplierName: offer.supplier.name,
      supplierArchivedAt: offer.supplier.archivedAt,
      name: offer.name,
      article: offer.article,
      brand: offer.brand,
      unit: offer.unit?.symbol ?? offer.legacyUnit ?? null,
      unitsPerPack: offer.unitsPerPack,
      minOrderQuantity: offer.minOrderQuantity,
      orderStep: offer.orderStep,
      rawData: currentPriceSnapshot?.rawData ?? Prisma.JsonNull,
      currentPriceSnapshot: currentPriceSnapshot
        ? {
            id: currentPriceSnapshot.id,
            price: currentPriceSnapshot.price,
            rawData: currentPriceSnapshot.rawData,
            legacyProductId: currentPriceSnapshot.legacyProductId,
            legacyProduct: currentPriceSnapshot.legacyProduct
              ? {
                  ...currentPriceSnapshot.legacyProduct,
                  supplier: {
                    id: offer.supplier.id,
                    name: offer.supplier.name,
                    archivedAt: offer.supplier.archivedAt,
                  },
                }
              : null,
          }
        : null,
      productMaster: activeMapping?.productMaster
        ? {
            id: activeMapping.productMaster.id,
            name: activeMapping.productMaster.name,
            category: activeMapping.productMaster.category,
          }
        : null,
      mapping: activeMapping
        ? {
            id: activeMapping.id,
            productMasterId: activeMapping.productMasterId,
            confidence: activeMapping.confidence,
            matchSource: activeMapping.matchSource,
          }
        : null,
    };
  });

  const normalizedQuery = normalizeSearchText(searchText);
  const queryWords = getNormalizedWords(searchText);
  const queryWordRoots = queryWords.map((word) => normalizeSearchToken(word)).filter((word) => word.length > 1);
  const queryTokens = getSearchTokens(searchText);

  const scoredCandidates = candidates
    .map<ScoredCatalogCandidate>((candidate) => {
      const candidateName = normalizeSearchText(candidate.name);
      const productMasterName = normalizeSearchText(candidate.productMaster?.name ?? "");
      const candidateWords = getNormalizedWords(candidate.name);
      const candidateWordRoots = candidateWords
        .map((word) => normalizeSearchToken(word))
        .filter((word) => word.length > 1);
      const candidateTokens = buildSearchTokenSet(
        `${candidate.name} ${candidate.productMaster?.name ?? ""} ${candidate.brand ?? ""} ${candidate.article ?? ""}`,
      );
      const matchedTokens = queryTokens.filter((token) => candidateTokens.has(token));
      const exactPhraseAtStart = Boolean(normalizedQuery && candidateName.startsWith(normalizedQuery));
      const startsWithFirstToken = Boolean(queryWordRoots[0] && candidateWordRoots[0] === queryWordRoots[0]);
      const exactPhraseMatch = Boolean(normalizedQuery && candidateName.includes(normalizedQuery));
      const exactWordMatches = queryWordRoots.filter((token) => candidateWordRoots.includes(token));
      const negativeAdjustment = getCatalogNegativeScoreAdjustment({
        normalizedQuery,
        queryWords,
        queryWordRoots,
        candidateName,
        candidateWords,
        candidateWordRoots,
      });
      const score =
        matchedTokens.length * 22 +
        exactWordMatches.length * 18 +
        (candidate.currentPriceSnapshot?.price ? 3 : 0) +
        getSemanticScoreAdjustment(queryTokens, candidateTokens) +
        getCatalogPhraseScoreAdjustment({
          normalizedQuery,
          queryWordRoots,
          candidateName,
          candidateWordRoots,
          productMasterName,
        }) +
        negativeAdjustment;

      return {
        candidate,
        score,
        matchedTokensCount: matchedTokens.length,
        totalTokensCount: queryTokens.length,
        matchedRatio: queryTokens.length > 0 ? matchedTokens.length / queryTokens.length : 0,
        exactPhraseAtStart,
        startsWithFirstToken,
        exactPhraseMatch,
        negativeAdjustment,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (left.exactPhraseAtStart !== right.exactPhraseAtStart) {
        return left.exactPhraseAtStart ? -1 : 1;
      }

      if (left.startsWithFirstToken !== right.startsWithFirstToken) {
        return left.startsWithFirstToken ? -1 : 1;
      }

      if (right.matchedRatio !== left.matchedRatio) {
        return right.matchedRatio - left.matchedRatio;
      }

      if (left.exactPhraseMatch !== right.exactPhraseMatch) {
        return left.exactPhraseMatch ? -1 : 1;
      }

      const leftPrice = left.candidate.currentPriceSnapshot?.price
        ? Number(left.candidate.currentPriceSnapshot.price.toString())
        : Number.POSITIVE_INFINITY;
      const rightPrice = right.candidate.currentPriceSnapshot?.price
        ? Number(right.candidate.currentPriceSnapshot.price.toString())
        : Number.POSITIVE_INFINITY;

      return leftPrice - rightPrice;
    });

  return scoredCandidates.slice(0, requestedMaxProducts);
}

export async function findCatalogCandidateProducts(
  item: OrderOptimizationItem,
  enterpriseId: string,
  options?: {
    searchText?: string | null;
    maxProducts?: number;
  },
): Promise<CatalogCandidate[]> {
  const scoredCandidates = await findCatalogCandidateProductsWithScores(item, enterpriseId, options);
  return scoredCandidates.map((candidate) => candidate.candidate);
}

export async function findPreferredSmartOrderProductCandidates(
  item: OrderOptimizationItem,
  enterpriseId: string,
  options?: {
    searchText?: string | null;
    maxProducts?: number;
    maxPerSupplier?: number;
  },
): Promise<SmartOrderProductSearchResult> {
  const searchText = options?.searchText ?? item.parsedName ?? "";
  const normalizedQuery = normalizeSearchText(searchText);

  if (isCatalogQueryAllowedAsPrimary(normalizedQuery)) {
    const catalogCandidates = await findCatalogCandidateProductsWithScores(item, enterpriseId, {
      searchText,
      maxProducts: options?.maxProducts ?? MAX_PRODUCTS_TO_SCORE,
    });

    if (isCatalogSearchSafe(normalizedQuery, catalogCandidates)) {
      const mappedCandidates = catalogCandidates
        .map((candidate) => {
          const legacyProduct = mapCatalogCandidateToLegacyProduct(candidate.candidate);

          if (!legacyProduct) {
            return null;
          }

          const mappedCandidate: ScoredProductCandidate = {
            product: legacyProduct,
            score: candidate.score,
            matchedTokensCount: candidate.matchedTokensCount,
            totalTokensCount: candidate.totalTokensCount,
            matchedRatio: candidate.matchedRatio,
            firstTokenMatched: candidate.startsWithFirstToken,
            supplierMatched: true,
            hasUnitSupport: true,
            exactPhraseMatch: candidate.exactPhraseMatch,
          };

          return mappedCandidate;
        })
        .filter((candidate): candidate is ScoredProductCandidate => Boolean(candidate));

      if (mappedCandidates.length >= 3) {
        console.info("[smart-order] candidateSource=catalog query=%s count=%d", normalizedQuery, mappedCandidates.length);

        return {
          candidateSource: "catalog",
          candidates: mappedCandidates.slice(0, options?.maxProducts ?? mappedCandidates.length),
        };
      }
    }
  }

  const fallbackCandidates = await findCandidateProducts(item, enterpriseId, options);
  console.info("[smart-order] candidateSource=product_fallback query=%s count=%d", normalizedQuery, fallbackCandidates.length);

  return {
    candidateSource: "product_fallback",
    candidates: fallbackCandidates,
  };
}

function buildCandidateRows(
  optimizationId: string,
  item: OrderOptimizationItem,
  candidates: ScoredProductCandidate[],
  maxRows: number,
): ItemCandidatePlan["rows"] {
  const rows: ItemCandidatePlan["rows"] = [];
  const canEstimateCoverage = Boolean(item.parsedQuantity && item.parsedUnit);

  for (const candidate of candidates) {
    const packSize = getPackSize(candidate.product, item);
    const variants = canEstimateCoverage ? buildCoverageVariants(item.parsedQuantity, packSize) : [];
    const selectedVariants = variants
      .filter((variant) => isUsefulCoverageVariant(variant, candidate.product.price))
      .sort((left, right) => {
        if (left.mode === "no_shortage" && right.mode !== "no_shortage") {
          return -1;
        }

        if (right.mode === "no_shortage" && left.mode !== "no_shortage") {
          return 1;
        }

        return Number(left.overage.sub(right.overage).toString());
      })
      .slice(0, 2);

    if (selectedVariants.length === 0) {
      rows.push({
        data: {
          optimization: {
            connect: {
              id: optimizationId,
            },
          },
          item: {
            connect: {
              id: item.id,
            },
          },
          selectedSupplier: {
            connect: {
              id: candidate.product.supplierId,
            },
          },
          selectedProduct: {
            connect: {
              id: candidate.product.id,
            },
          },
          optimizedUnitPrice: candidate.product.price,
          optimizedLineTotal: null,
          coverageMode: null,
          isManualOverride: false,
        },
        score: candidate.score,
        matchedTokensCount: candidate.matchedTokensCount,
        totalTokensCount: candidate.totalTokensCount,
        matchedRatio: candidate.matchedRatio,
        firstTokenMatched: candidate.firstTokenMatched,
        supplierMatched: candidate.supplierMatched,
        hasUnitSupport: candidate.hasUnitSupport,
        exactPhraseMatch: candidate.exactPhraseMatch,
      });

      if (rows.length >= maxRows) {
        return rows;
      }

      continue;
    }

    for (const variant of selectedVariants) {
      const unitPrice = candidate.product.price;
      const lineTotal = unitPrice ? unitPrice.mul(variant.suggestedPacksCount).toDecimalPlaces(2) : null;

      rows.push({
        data: {
          optimization: {
            connect: {
              id: optimizationId,
            },
          },
          item: {
            connect: {
              id: item.id,
            },
          },
          selectedSupplier: {
            connect: {
              id: candidate.product.supplierId,
            },
          },
          selectedProduct: {
            connect: {
              id: candidate.product.id,
            },
          },
          optimizedUnitPrice: unitPrice,
          optimizedLineTotal: lineTotal,
          coverageMode: variant.mode,
          requiredAmount: variant.requiredAmount,
          packSize: variant.packSize,
          suggestedPacksCount: variant.suggestedPacksCount,
          totalCoveredAmount: variant.totalCoveredAmount,
          overage: variant.overage,
          shortage: variant.shortage,
          isManualOverride: false,
        },
        score: candidate.score,
        matchedTokensCount: candidate.matchedTokensCount,
        totalTokensCount: candidate.totalTokensCount,
        matchedRatio: candidate.matchedRatio,
        firstTokenMatched: candidate.firstTokenMatched,
        supplierMatched: candidate.supplierMatched,
        hasUnitSupport: candidate.hasUnitSupport,
        exactPhraseMatch: candidate.exactPhraseMatch,
      });

      if (rows.length >= maxRows) {
        return rows;
      }
    }
  }

  return rows;
}

function compareCandidateRows(
  left: {
    mode: CoverageMode | null;
    shortage: Prisma.Decimal | null;
    overage: Prisma.Decimal | null;
    optimizedLineTotal: Prisma.Decimal | null;
  },
  right: {
    mode: CoverageMode | null;
    shortage: Prisma.Decimal | null;
    overage: Prisma.Decimal | null;
    optimizedLineTotal: Prisma.Decimal | null;
  },
) {
  const leftHasCoverage = Boolean(left.mode && left.shortage && left.overage);
  const rightHasCoverage = Boolean(right.mode && right.shortage && right.overage);

  if (leftHasCoverage && !rightHasCoverage) {
    return -1;
  }

  if (!leftHasCoverage && rightHasCoverage) {
    return 1;
  }

  if (!leftHasCoverage && !rightHasCoverage) {
    if (left.optimizedLineTotal && right.optimizedLineTotal && !left.optimizedLineTotal.eq(right.optimizedLineTotal)) {
      return left.optimizedLineTotal.lt(right.optimizedLineTotal) ? -1 : 1;
    }

    if (left.optimizedLineTotal && !right.optimizedLineTotal) {
      return -1;
    }

    if (!left.optimizedLineTotal && right.optimizedLineTotal) {
      return 1;
    }

    return 0;
  }

  const leftOverage = left.overage as Prisma.Decimal;
  const rightOverage = right.overage as Prisma.Decimal;
  const leftShortage = left.shortage as Prisma.Decimal;
  const rightShortage = right.shortage as Prisma.Decimal;

  if (left.mode === "no_shortage" && right.mode !== "no_shortage") {
    return -1;
  }

  if (right.mode === "no_shortage" && left.mode !== "no_shortage") {
    return 1;
  }

  if (left.mode === "no_shortage" && right.mode === "no_shortage") {
    if (left.optimizedLineTotal && right.optimizedLineTotal && !left.optimizedLineTotal.eq(right.optimizedLineTotal)) {
      return left.optimizedLineTotal.lt(right.optimizedLineTotal) ? -1 : 1;
    }

    if (!leftOverage.eq(rightOverage)) {
      return leftOverage.lt(rightOverage) ? -1 : 1;
    }

    return 0;
  }

  if (!leftShortage.eq(rightShortage)) {
    return leftShortage.lt(rightShortage) ? -1 : 1;
  }

  if (left.optimizedLineTotal && right.optimizedLineTotal && !left.optimizedLineTotal.eq(right.optimizedLineTotal)) {
    return left.optimizedLineTotal.lt(right.optimizedLineTotal) ? -1 : 1;
  }

  if (!leftOverage.eq(rightOverage)) {
    return leftOverage.lt(rightOverage) ? -1 : 1;
  }

  return 0;
}

function isStrongAutoCandidate(
  bestRow: ItemCandidatePlan["rows"][number],
  secondRow: ItemCandidatePlan["rows"][number] | undefined,
) {
  const enoughTokens =
    bestRow.totalTokensCount <= 1
      ? bestRow.matchedTokensCount >= 1
      : bestRow.matchedRatio >= 0.6 || bestRow.exactPhraseMatch;

  if (!enoughTokens || !bestRow.hasUnitSupport || !bestRow.supplierMatched) {
    return false;
  }

  if (!bestRow.firstTokenMatched) {
    return false;
  }

  if (bestRow.score < 45) {
    return false;
  }

  void secondRow;
  return true;
}

function chooseAutoSelectedIndex(rows: ItemCandidatePlan["rows"]) {
  if (rows.length === 0) {
    return null;
  }

  const sorted = rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const byCandidate = compareCandidateRows(
        {
          mode: (left.row.data.coverageMode as CoverageMode | null) ?? null,
          shortage: (left.row.data.shortage as Prisma.Decimal | null) ?? null,
          overage: (left.row.data.overage as Prisma.Decimal | null) ?? null,
          optimizedLineTotal: (left.row.data.optimizedLineTotal as Prisma.Decimal | null) ?? null,
        },
        {
          mode: (right.row.data.coverageMode as CoverageMode | null) ?? null,
          shortage: (right.row.data.shortage as Prisma.Decimal | null) ?? null,
          overage: (right.row.data.overage as Prisma.Decimal | null) ?? null,
          optimizedLineTotal: (right.row.data.optimizedLineTotal as Prisma.Decimal | null) ?? null,
        },
      );

      if (byCandidate !== 0) {
        return byCandidate;
      }

      return right.row.score - left.row.score;
    });

  const best = sorted[0];
  const second = sorted[1];

  return isStrongAutoCandidate(best.row, second?.row) ? best.index : null;
}

export async function rebuildOrderOptimizationCandidates(optimizationId: string, enterpriseId: string) {
  const optimization = await prisma.orderOptimization.findFirst({
    where: {
      id: optimizationId,
      enterpriseId,
    },
    include: {
      items: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  if (!optimization) {
    return null;
  }

  const candidatePlans: ItemCandidatePlan[] = [];

  for (const item of optimization.items) {
    if (!item.parsedName || !item.parsedQuantity || !item.parsedUnit) {
      candidatePlans.push({
        itemId: item.id,
        rows: [],
        matchStatus: "review",
        autoSelectedIndex: null,
      });
      continue;
    }

    const { candidates } = await findPreferredSmartOrderProductCandidates(item, enterpriseId);
    const rows = buildCandidateRows(optimizationId, item, candidates, MAX_RESULTS_PER_ITEM);

    candidatePlans.push({
      itemId: item.id,
      rows,
      matchStatus: rows.length > 0 ? "review" : "not_found",
      autoSelectedIndex: chooseAutoSelectedIndex(rows),
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.orderOptimizationItem.updateMany({
      where: {
        optimizationId,
      },
      data: {
        selectedCandidateId: null,
        selectionMode: null,
        matchStatus: "review",
      },
    });

    await tx.orderOptimizationResult.deleteMany({
      where: {
        optimizationId,
      },
    });

    for (const plan of candidatePlans) {
      const createdRows = [];

      for (const row of plan.rows) {
        createdRows.push(
          await tx.orderOptimizationResult.create({
            data: row.data,
          }),
        );
      }

      const autoSelectedResult = plan.autoSelectedIndex !== null ? createdRows[plan.autoSelectedIndex] : null;

      await tx.orderOptimizationItem.update({
        where: {
          id: plan.itemId,
        },
        data: {
          selectedCandidateId: autoSelectedResult?.id ?? null,
          selectionMode: autoSelectedResult ? "auto" : null,
          matchStatus: plan.matchStatus,
        },
      });
    }
  });

  return getOrderOptimizationWithDetails(optimizationId, enterpriseId);
}

export async function searchOrderOptimizationItemCandidates(params: {
  optimizationId: string;
  itemId: string;
  enterpriseId: string;
  query: string;
}) {
  const item = await prisma.orderOptimizationItem.findFirst({
    where: {
      id: params.itemId,
      optimizationId: params.optimizationId,
      optimization: {
        enterpriseId: params.enterpriseId,
      },
    },
  });

  if (!item) {
    return null;
  }

  const { candidates } = await findPreferredSmartOrderProductCandidates(item, params.enterpriseId, {
    searchText: params.query,
    maxProducts: SEARCH_RESULTS_PER_REQUEST,
    maxPerSupplier: SEARCH_RESULTS_PER_SUPPLIER,
  });
  const rows = buildCandidateRows(params.optimizationId, item, candidates, SEARCH_RESULTS_PER_REQUEST);

  if (rows.length === 0) {
    return [];
  }

  const existingResults = await prisma.orderOptimizationResult.findMany({
    where: {
      optimizationId: params.optimizationId,
      itemId: params.itemId,
    },
    select: {
      id: true,
      selectedProductId: true,
      coverageMode: true,
      suggestedPacksCount: true,
    },
  });
  const existingKeys = new Map(
    existingResults.map((result) => [
      `${result.selectedProductId ?? "none"}:${result.coverageMode ?? "none"}:${result.suggestedPacksCount ?? "none"}`,
      result.id,
    ]),
  );

  for (const row of rows) {
    const key = `${row.data.selectedProduct?.connect.id ?? "none"}:${row.data.coverageMode ?? "none"}:${row.data.suggestedPacksCount ?? "none"}`;

    if (existingKeys.has(key)) {
      continue;
    }

    const createdResult = await prisma.orderOptimizationResult.create({
      data: row.data,
      select: {
        id: true,
      },
    });

    existingKeys.set(key, createdResult.id);
  }

  const freshResults = await prisma.orderOptimizationResult.findMany({
    where: {
      id: {
        in: rows
          .map(
            (row) =>
              existingKeys.get(
                `${row.data.selectedProduct?.connect.id ?? "none"}:${row.data.coverageMode ?? "none"}:${row.data.suggestedPacksCount ?? "none"}`,
              ) ?? null,
          )
          .filter((value): value is string => Boolean(value)),
      },
    },
    include: {
      selectedSupplier: {
        select: {
          id: true,
          name: true,
        },
      },
      selectedProduct: {
        select: {
          id: true,
          name: true,
          article: true,
          brand: true,
          unit: true,
          unitsPerPack: true,
          minOrderQuantity: true,
          orderStep: true,
        },
      },
    },
  });

  const resultsById = new Map(freshResults.map((result) => [result.id, result]));

  return rows
    .map((row) =>
      resultsById.get(
        existingKeys.get(
          `${row.data.selectedProduct?.connect.id ?? "none"}:${row.data.coverageMode ?? "none"}:${row.data.suggestedPacksCount ?? "none"}`,
        ) ?? "",
      ) ?? null,
    )
    .filter((result): result is (typeof freshResults)[number] => Boolean(result));
}

export function getCoverageLabel(mode: CoverageMode) {
  return mode === "no_shortage" ? "Не меньше потребности" : "Ближайшее меньше";
}
