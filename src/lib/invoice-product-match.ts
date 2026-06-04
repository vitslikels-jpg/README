import { normalizeCatalogText } from "@/lib/catalog-model.shared.js";
import { loadProductIdentityRules } from "@/lib/product-identity-rules";
import { prisma } from "@/lib/prisma";

export type InvoiceProductCandidate = {
  id: string;
  name: string;
  article: string | null;
  brand: string | null;
  supplierId: string;
  supplierName: string | null;
  score: number;
  reason: string;
};

export type InvoiceProductMatchResult = {
  matchedProductId: string | null;
  status: "matched" | "ambiguous" | "not_found";
  candidates: InvoiceProductCandidate[];
  confidence: number | null;
  reason: string | null;
};

type ScoredCandidate = InvoiceProductCandidate & {
  importantPackMismatch: boolean;
  coreOverlapRatio: number;
};

function normalize(value: string | null | undefined) {
  return normalizeCatalogText(value)
    .replace(/ё/g, "е")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MATCH_STOP_WORDS = new Set([
  "кг",
  "г",
  "л",
  "мл",
  "шт",
  "уп",
  "упак",
  "пакет",
  "кор",
  "короб",
  "банка",
  "бут",
  "класс",
  "рф",
  "россия",
  "беларусь",
]);

function isUsefulMatchWord(word: string) {
  if (MATCH_STOP_WORDS.has(word)) {
    return false;
  }

  if (/^\d+[a-zа-я]*$/iu.test(word)) {
    return false;
  }

  if (/^\d+[,.]?\d*$/.test(word)) {
    return false;
  }

  return word.length > 2;
}

function getWords(value: string) {
  return normalize(value)
    .split(" ")
    .filter(isUsefulMatchWord);
}

function uniqueWords(words: string[]) {
  return Array.from(new Set(words));
}

function scoreWordOverlap(queryWords: string[], productWords: string[]) {
  const productSet = new Set(productWords);
  let score = 0;

  for (const word of queryWords) {
    if (productSet.has(word)) {
      score += word.length >= 6 ? 8 : 5;
      continue;
    }

    if (word.length >= 5 && productWords.some((productWord) => productWord.includes(word) || word.includes(productWord))) {
      score += 3;
    }
  }

  return score;
}

function buildSearchWords(productNameRaw: string) {
  return uniqueWords(getWords(productNameRaw))
    .sort((left, right) => right.length - left.length)
    .slice(0, 8);
}

type PackFacts = {
  massGrams: number | null;
  volumeMl: number | null;
  pieceCount: number | null;
  packCount: number | null;
  weightRangeGrams: [number, number] | null;
};

function parseNumber(raw: string | null | undefined) {
  if (!raw) {
    return null;
  }

  const value = Number(raw.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

export function extractPackFacts(name: string | null | undefined): PackFacts {
  const normalized = String(name ?? "").toLowerCase().replace(/,/g, ".").replace(/\s+/g, " ");
  let massGrams: number | null = null;
  let volumeMl: number | null = null;
  let pieceCount: number | null = null;
  let packCount: number | null = null;
  let weightRangeGrams: [number, number] | null = null;

  const rangeMatch = normalized.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(кг|г|гр|л|мл)\b/u);
  if (rangeMatch) {
    const left = parseNumber(rangeMatch[1]);
    const right = parseNumber(rangeMatch[2]);
    const unit = rangeMatch[3];

    if (left !== null && right !== null) {
      if (unit === "кг") {
        weightRangeGrams = [left * 1000, right * 1000];
      } else if (unit === "г" || unit === "гр") {
        weightRangeGrams = [left, right];
      } else if (unit === "л") {
        weightRangeGrams = [left * 1000, right * 1000];
      } else if (unit === "мл") {
        weightRangeGrams = [left, right];
      }
    }
  }

  const massMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(кг|г|гр)\b/u);
  if (massMatch) {
    const value = parseNumber(massMatch[1]);
    if (value !== null) {
      massGrams = massMatch[2] === "кг" ? value * 1000 : value;
    }
  }

  const volumeMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(л|мл)\b/u);
  if (volumeMatch) {
    const value = parseNumber(volumeMatch[1]);
    if (value !== null) {
      volumeMl = volumeMatch[2] === "л" ? value * 1000 : value;
    }
  }

  const slashPackMatches = Array.from(normalized.matchAll(/(?:^|\s)\d+\s*\/\s*(\d+(?:\.\d+)?)\s*шт\b/gu));
  if (slashPackMatches.length > 0) {
    const value = parseNumber(slashPackMatches[slashPackMatches.length - 1]?.[1]);
    if (value !== null) {
      packCount = value;
    }
  }

  const pieceMatches = Array.from(normalized.matchAll(/(?:^|[^\p{L}])(\d+(?:\.\d+)?)\s*шт\b/gu));
  if (pieceMatches.length > 0) {
    const value = parseNumber(pieceMatches[pieceMatches.length - 1]?.[1]);
    if (value !== null) {
      pieceCount = value;
    }
  }

  return {
    massGrams,
    volumeMl,
    pieceCount,
    packCount,
    weightRangeGrams,
  };
}

function isCloseNumeric(left: number | null, right: number | null, tolerance = 0.06) {
  if (left === null || right === null) {
    return false;
  }

  const max = Math.max(Math.abs(left), Math.abs(right), 1);
  return Math.abs(left - right) / max <= tolerance;
}

function rangesOverlap(left: [number, number] | null, right: [number, number] | null) {
  if (!left || !right) {
    return false;
  }

  return left[0] <= right[1] && right[0] <= left[1];
}

function getBrandWords(value: string | null | undefined) {
  return getWords(value ?? "").filter((word) => word.length >= 4);
}

function getCoreWords(value: string | null | undefined) {
  return getWords(value ?? "").filter((word) => !/^\d/u.test(word)).slice(0, 12);
}

function scoreCoreOverlap(queryWords: string[], productWords: string[]) {
  const productSet = new Set(productWords);
  const matched = queryWords.filter((word) => productSet.has(word));
  const matchedCount = matched.length;
  const queryCount = queryWords.length;

  if (matchedCount === 0 || queryCount === 0) {
    return { score: 0, matchedCount, ratio: 0 };
  }

  let score = matchedCount * 10;
  const ratio = matchedCount / queryCount;

  if (ratio >= 0.8) {
    score += 24;
  } else if (ratio >= 0.6) {
    score += 14;
  }

  return { score, matchedCount, ratio };
}

function scorePackFacts(queryPack: PackFacts, productPack: PackFacts) {
  let score = 0;
  let importantMismatch = false;
  const reasons: string[] = [];

  if (queryPack.massGrams !== null && productPack.massGrams !== null) {
    if (isCloseNumeric(queryPack.massGrams, productPack.massGrams, 0.05)) {
      score += 28;
      reasons.push("same-mass");
    } else {
      score -= 34;
      importantMismatch = true;
      reasons.push("mass-mismatch");
    }
  }

  if (queryPack.volumeMl !== null && productPack.volumeMl !== null) {
    if (isCloseNumeric(queryPack.volumeMl, productPack.volumeMl, 0.05)) {
      score += 28;
      reasons.push("same-volume");
    } else {
      score -= 34;
      importantMismatch = true;
      reasons.push("volume-mismatch");
    }
  }

  if (queryPack.pieceCount !== null && productPack.pieceCount !== null) {
    if (isCloseNumeric(queryPack.pieceCount, productPack.pieceCount, 0.01)) {
      score += 16;
      reasons.push("same-piece-count");
    } else {
      score -= 18;
      reasons.push("piece-count-mismatch");
    }
  }

  if (queryPack.packCount !== null && productPack.packCount !== null) {
    if (isCloseNumeric(queryPack.packCount, productPack.packCount, 0.01)) {
      score += 20;
      reasons.push("same-pack-count");
    } else {
      score -= 28;
      importantMismatch = true;
      reasons.push("pack-count-mismatch");
    }
  }

  if (queryPack.weightRangeGrams && productPack.weightRangeGrams) {
    if (rangesOverlap(queryPack.weightRangeGrams, productPack.weightRangeGrams)) {
      score += 14;
      reasons.push("range-overlap");
    } else {
      score -= 22;
      importantMismatch = true;
      reasons.push("range-mismatch");
    }
  }

  return { score, importantMismatch, reasons };
}

function sortCandidates(left: InvoiceProductCandidate, right: InvoiceProductCandidate) {
  return right.score - left.score || left.name.localeCompare(right.name, "ru");
}

export async function matchInvoiceProduct(params: {
  enterpriseId: string;
  supplierId: string | null;
  productNameRaw: string;
  limit?: number;
}): Promise<InvoiceProductMatchResult> {
  const normalizedQuery = normalize(params.productNameRaw);
  const queryWords = buildSearchWords(params.productNameRaw);
  const queryCoreWords = getCoreWords(params.productNameRaw);
  const queryPack = extractPackFacts(params.productNameRaw);

  if (!normalizedQuery || queryWords.length === 0) {
    return { matchedProductId: null, status: "not_found", candidates: [], confidence: null, reason: "empty-query" };
  }

  const baseWhere = {
    enterpriseId: params.enterpriseId,
    ...(params.supplierId ? { supplierId: params.supplierId } : {}),
  };

  const exactProducts = await prisma.product.findMany({
    where: {
      ...baseWhere,
    },
    select: {
      id: true,
      name: true,
      article: true,
      brand: true,
      supplierId: true,
      supplier: {
        select: {
          name: true,
        },
      },
    },
  });

  const exactMatches = exactProducts
    .filter((product) => normalize(product.name) === normalizedQuery)
    .map(
      (product) =>
        ({
          id: product.id,
          name: product.name,
          article: product.article,
          brand: product.brand,
          supplierId: product.supplierId,
          supplierName: product.supplier?.name ?? null,
          score: 1_000,
          reason: "exact-name",
        }) satisfies InvoiceProductCandidate,
    )
    .sort(sortCandidates);

  if (exactMatches.length > 0) {
    if (exactMatches.length === 1) {
      console.info("[invoice-product-match]", {
        item: params.productNameRaw.slice(0, 120),
        supplierId: params.supplierId,
        status: "matched",
        reason: "exact-name",
        topCandidates: exactMatches.slice(0, 3).map((candidate) => ({
          id: candidate.id,
          score: candidate.score,
          reason: candidate.reason,
        })),
      });
      return {
        matchedProductId: exactMatches[0].id,
        status: "matched",
        candidates: [],
        confidence: 0.98,
        reason: "exact-name",
      };
    }

    console.info("[invoice-product-match]", {
      item: params.productNameRaw.slice(0, 120),
      supplierId: params.supplierId,
      status: "ambiguous",
      reason: "multiple-exact-name",
      topCandidates: exactMatches.slice(0, 3).map((candidate) => ({
        id: candidate.id,
        score: candidate.score,
        reason: candidate.reason,
      })),
    });
    return {
      matchedProductId: null,
      status: "ambiguous",
      candidates: exactMatches.slice(0, params.limit ?? 3),
      confidence: null,
      reason: "multiple-exact-name",
    };
  }

  const identityRules = await loadProductIdentityRules(params.enterpriseId, params.supplierId ?? "").catch(() => []);
  const matchingRules = identityRules.filter((rule) => {
    const ruleText = normalize(rule.normalizedMatchText || rule.matchText);
    const ruleArticle = normalize(rule.normalizedArticle || rule.article);
    const ruleBrand = normalize(rule.normalizedBrand || rule.brand);

    return Boolean(
      (ruleText && normalizedQuery.includes(ruleText)) ||
        (ruleArticle && normalizedQuery.includes(ruleArticle)) ||
        (ruleBrand && normalizedQuery.includes(ruleBrand)),
    );
  });

  const products = await prisma.product.findMany({
    where: {
      ...baseWhere,
      OR: queryWords.slice(0, 6).map((word) => ({
        name: {
          contains: word,
          mode: "insensitive",
        },
      })),
    },
    select: {
      id: true,
      name: true,
      article: true,
      brand: true,
      supplierId: true,
      supplier: {
        select: {
          name: true,
        },
      },
    },
    take: 200,
  });

  const scored = products
    .map((product) => {
      const productName = normalize(product.name);
      const productWords = getWords(product.name);
      const productCoreWords = getCoreWords(product.name);
      const productArticle = normalize(product.article);
      const productBrand = normalize(product.brand);
      const productPack = extractPackFacts(product.name);
      const coreOverlap = scoreCoreOverlap(queryCoreWords, productCoreWords);
      const packScore = scorePackFacts(queryPack, productPack);
      const productBrandWords = getBrandWords(product.brand);
      const queryBrandMatch = productBrandWords.some((word) => normalizedQuery.includes(word));
      let score = 0;
      const reasons: string[] = [];

      if (productName === normalizedQuery) {
        score += 120;
        reasons.push("exact-name");
      } else if (productName.includes(normalizedQuery) || normalizedQuery.includes(productName)) {
        score += 70;
        reasons.push("contains-name");
      }

      score += scoreWordOverlap(queryWords, productWords);
      if (scoreWordOverlap(queryWords, productWords) > 0) {
        reasons.push("word-overlap");
      }

      score += coreOverlap.score;
      if (coreOverlap.score > 0) {
        reasons.push(`core:${coreOverlap.matchedCount}/${Math.max(queryCoreWords.length, 1)}`);
      }

      if (productArticle && normalizedQuery.includes(productArticle)) {
        score += 35;
        reasons.push("article");
      }

      if (productBrand && normalizedQuery.includes(productBrand)) {
        score += 22;
        reasons.push("brand-match");
      } else if (queryBrandMatch) {
        score += 14;
        reasons.push("brand-word");
      } else if (productBrand && queryCoreWords.length >= 4) {
        score -= 8;
        reasons.push("brand-missing");
      }

      for (const rule of matchingRules) {
        const ruleArticle = normalize(rule.normalizedArticle || rule.article);
        const ruleBrand = normalize(rule.normalizedBrand || rule.brand);
        const ruleText = normalize(rule.normalizedMatchText || rule.matchText);

        if (rule.supplierId && rule.supplierId === product.supplierId) {
          score += 8;
        }

        if (ruleArticle && productArticle && ruleArticle === productArticle) {
          score += 45;
        }

        if (ruleBrand && productBrand && ruleBrand === productBrand) {
          score += 20;
          reasons.push("identity-brand");
        }

        if (ruleText && productName.includes(ruleText)) {
          score += 18;
          reasons.push("identity-text");
        }
      }

      score += packScore.score;
      reasons.push(...packScore.reasons);

      if (queryCoreWords.length > 0 && coreOverlap.ratio < 0.45) {
        score -= 18;
        reasons.push("low-core-overlap");
      }

      if (queryCoreWords.length > 0 && coreOverlap.ratio >= 0.75 && !packScore.importantMismatch) {
        score += 12;
        reasons.push("near-exact-core");
      }

      return {
        id: product.id,
        name: product.name,
        article: product.article,
        brand: product.brand,
        supplierId: product.supplierId,
        supplierName: product.supplier?.name ?? null,
        score,
        reason: reasons.join(", "),
        importantPackMismatch: packScore.importantMismatch,
        coreOverlapRatio: coreOverlap.ratio,
      } satisfies ScoredCandidate;
    })
    .filter((candidate) => candidate.score >= 8)
    .sort(sortCandidates);

  const candidates = scored.slice(0, params.limit ?? 3);

  if (candidates.length === 0) {
    console.info("[invoice-product-match]", {
      item: params.productNameRaw.slice(0, 120),
      supplierId: params.supplierId,
      status: "not_found",
      reason: "no-candidates",
      topCandidates: [],
    });
    return { matchedProductId: null, status: "not_found", candidates: [], confidence: null, reason: "no-candidates" };
  }

  const best = scored[0] as ScoredCandidate;
  const second = (scored[1] as ScoredCandidate | undefined) ?? null;
  const bestScoreGap = second ? best.score - second.score : best.score;
  const isConfident =
    !best.importantPackMismatch &&
    ((best.score >= 95 && (!second || bestScoreGap >= 12)) ||
      (best.score >= 82 && (!second || bestScoreGap >= 18)) ||
      (best.score >= 88 && !second) ||
      (best.coreOverlapRatio !== undefined && best.coreOverlapRatio >= 0.8 && best.score >= 78 && (!second || bestScoreGap >= 20)));

  const reason = isConfident
    ? best.reason.includes("exact-name")
      ? "exact-name"
      : "near-exact-name-pack"
    : best.importantPackMismatch
      ? "pack-mismatch"
      : second && bestScoreGap < 12
        ? "close-candidates"
        : "low-confidence";

  console.info("[invoice-product-match]", {
    item: params.productNameRaw.slice(0, 120),
    supplierId: params.supplierId,
    status: isConfident ? "matched" : candidates.length >= 2 ? "ambiguous" : "not_found",
    reason,
    topCandidates: scored.slice(0, 3).map((candidate) => ({
      id: candidate.id,
      score: candidate.score,
      reason: candidate.reason,
    })),
  });

  return {
    matchedProductId: isConfident ? best.id : null,
    status: isConfident ? "matched" : candidates.length >= 2 ? "ambiguous" : "not_found",
    candidates: isConfident ? [] : candidates.length >= 2 ? candidates : [],
    confidence: isConfident ? (reason === "exact-name" ? 0.98 : 0.92) : null,
    reason,
  };
}
