import { Prisma } from "@prisma/client";
import { normalizeCatalogText, normalizeOptionalString } from "@/lib/catalog-model.shared.js";
import { prisma } from "@/lib/prisma";

export type ProductIdentityRuleInput = {
  article: string | null;
  matchText: string | null;
  brand: string | null;
  country: string | null;
  source?: string;
  confidence?: string | number | null;
};

export type LoadedProductIdentityRule = {
  supplierId: string | null;
  article: string | null;
  normalizedArticle: string | null;
  matchText: string | null;
  normalizedMatchText: string | null;
  brand: string | null;
  normalizedBrand: string | null;
  country: string | null;
  source: string;
  confidence: string | null;
};

function normalizeArticle(value: string | null | undefined) {
  return normalizeCatalogText(value);
}

function normalizeRuleText(value: string | null | undefined) {
  return normalizeCatalogText(value);
}

const BLOCKED_IDENTITY_BRANDS = new Set(["гост", "ту", "сто", "мк"]);

function isAllowedIdentityBrand(brand: string | null) {
  const normalizedBrand = normalizeRuleText(brand);
  return !normalizedBrand || !BLOCKED_IDENTITY_BRANDS.has(normalizedBrand);
}

export async function loadProductIdentityRules(enterpriseId: string, supplierId: string) {
  const rules = await prisma.productIdentityRule.findMany({
    where: {
      enterpriseId,
      OR: [{ supplierId }, { supplierId: null }],
    },
    orderBy: [{ supplierId: "desc" }, { createdAt: "asc" }],
    select: {
      supplierId: true,
      article: true,
      normalizedArticle: true,
      matchText: true,
      normalizedMatchText: true,
      brand: true,
      normalizedBrand: true,
      country: true,
      source: true,
      confidence: true,
    },
  });

  return rules
    .filter((rule) => isAllowedIdentityBrand(rule.normalizedBrand || rule.brand))
    .map((rule) => ({
      ...rule,
      confidence: rule.confidence?.toString() ?? null,
    }));
}

export async function upsertProductIdentityRules(params: {
  enterpriseId: string;
  supplierId?: string | null;
  rules: ProductIdentityRuleInput[];
}) {
  const createdOrUpdated = [];

  for (const input of params.rules) {
    const article = normalizeOptionalString(input.article);
    const matchText = normalizeOptionalString(input.matchText);
    const rawBrand = normalizeOptionalString(input.brand);
    const brand = isAllowedIdentityBrand(rawBrand) ? rawBrand : null;
    const country = normalizeOptionalString(input.country);
    const normalizedArticle = normalizeArticle(article);
    const normalizedMatchText = normalizeRuleText(matchText);
    const normalizedBrand = normalizeRuleText(brand);

    if (!brand && !country) {
      continue;
    }

    if (!normalizedArticle && !normalizedMatchText && !normalizedBrand) {
      continue;
    }

    const existingRule = await prisma.productIdentityRule.findFirst({
      where: {
        enterpriseId: params.enterpriseId,
        supplierId: params.supplierId ?? null,
        normalizedArticle: normalizedArticle || "",
        normalizedMatchText: normalizedMatchText || "",
        normalizedBrand: normalizedBrand || "",
      },
      select: {
        id: true,
      },
    });

    const data = {
      article,
      normalizedArticle: normalizedArticle || "",
      matchText,
      normalizedMatchText: normalizedMatchText || "",
      brand,
      normalizedBrand: normalizedBrand || "",
      country,
      source: input.source ?? "manual",
      confidence: input.confidence == null ? null : new Prisma.Decimal(input.confidence),
    };

    createdOrUpdated.push(
      existingRule
        ? await prisma.productIdentityRule.update({
            where: { id: existingRule.id },
            data,
          })
        : await prisma.productIdentityRule.create({
            data: {
              ...data,
          enterpriseId: params.enterpriseId,
          supplierId: params.supplierId ?? null,
            },
          }),
    );
  }

  return createdOrUpdated;
}
