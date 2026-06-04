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
};

export type InvoiceProductMatchResult = {
  matchedProductId: string | null;
  status: "matched" | "ambiguous" | "not_found";
  candidates: InvoiceProductCandidate[];
};

function normalize(value: string | null | undefined) {
  return normalizeCatalogText(value)
    .replace(/ё/g, "е")
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

export async function matchInvoiceProduct(params: {
  enterpriseId: string;
  supplierId: string | null;
  productNameRaw: string;
  limit?: number;
}): Promise<InvoiceProductMatchResult> {
  const normalizedQuery = normalize(params.productNameRaw);
  const queryWords = buildSearchWords(params.productNameRaw);

  if (!normalizedQuery || queryWords.length === 0) {
    return { matchedProductId: null, status: "not_found", candidates: [] };
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
      enterpriseId: params.enterpriseId,
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
    take: 150,
  });

  const scored = products
    .map((product) => {
      const productName = normalize(product.name);
      const productWords = getWords(product.name);
      const productArticle = normalize(product.article);
      const productBrand = normalize(product.brand);
      let score = 0;

      if (productName === normalizedQuery) {
        score += 120;
      } else if (productName.includes(normalizedQuery) || normalizedQuery.includes(productName)) {
        score += 70;
      }

      score += scoreWordOverlap(queryWords, productWords);

      if (params.supplierId && product.supplierId === params.supplierId) {
        score += 20;
      }

      if (productArticle && normalizedQuery.includes(productArticle)) {
        score += 35;
      }

      if (productBrand && normalizedQuery.includes(productBrand)) {
        score += 15;
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
        }

        if (ruleText && productName.includes(ruleText)) {
          score += 18;
        }
      }

      return {
        id: product.id,
        name: product.name,
        article: product.article,
        brand: product.brand,
        supplierId: product.supplierId,
        supplierName: product.supplier?.name ?? null,
        score,
      } satisfies InvoiceProductCandidate;
    })
    .filter((candidate) => candidate.score >= 8)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "ru"));

  const candidates = scored.slice(0, params.limit ?? 3);

  if (candidates.length === 0) {
    return { matchedProductId: null, status: "not_found", candidates: [] };
  }

  const best = candidates[0];
  const second = candidates[1] ?? null;
  const isConfident =
    (best.score >= 55 && (!second || best.score - second.score >= 18)) ||
    (best.score >= 18 && (!second || best.score - second.score >= 10)) ||
    (best.score >= 8 && candidates.length === 1);

  return {
    matchedProductId: isConfident ? best.id : null,
    status: isConfident ? "matched" : "ambiguous",
    candidates,
  };
}
