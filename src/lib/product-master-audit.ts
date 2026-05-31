import { normalizeCatalogText } from "@/lib/catalog-model.shared.js";
import { prisma } from "@/lib/prisma";

export type ProductMasterAuditExampleDto = {
  productId: string;
  productName: string;
  supplierName: string;
  brand: string | null;
  productMasterId: string | null;
  productMasterName: string | null;
};

export type ProductMasterAuditGroupDto = {
  normalizedName: string;
  productsCount: number;
  suppliersCount: number;
  productMastersCount: number;
  supplierNames: string[];
  masterIds: string[];
  examples: ProductMasterAuditExampleDto[];
};

export type ProductMasterAuditMasterDto = {
  productMasterId: string;
  productMasterName: string;
  brand: string | null;
  groupNormalizedName: string;
  productsCount: number;
  suppliersCount: number;
  supplierNames: string[];
};

export type ProductMasterAuditReportDto = {
  summary: {
    totalProductMasters: number;
    suspectedDuplicateMasters: number;
    duplicatePercent: number;
    totalProducts: number;
    groupsCount: number;
    duplicateGroupsCount: number;
  };
  topDuplicateGroups: ProductMasterAuditGroupDto[];
  likelyDuplicateMasters: ProductMasterAuditMasterDto[];
  exampleGroups: Record<string, ProductMasterAuditGroupDto[]>;
};

type AuditGroupAccumulator = {
  normalizedName: string;
  productIds: Set<string>;
  suppliers: Set<string>;
  masterIds: Set<string>;
  examples: ProductMasterAuditExampleDto[];
  masterStats: Map<
    string,
    {
      productMasterId: string;
      productMasterName: string;
      brand: string | null;
      productIds: Set<string>;
      suppliers: Set<string>;
      supplierNames: Set<string>;
    }
  >;
};

const UNIT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/(\d+(?:[.,]\d+)?)\s*(килограмм(?:а|ов|ы)?|кг\.?)/giu, "$1 кг"],
  [/(\d+(?:[.,]\d+)?)\s*(грамм(?:а|ов|ы)?|гр\.?|г\.?)/giu, "$1 г"],
  [/(\d+(?:[.,]\d+)?)\s*(литр(?:а|ов|ы)?|л\.?)/giu, "$1 л"],
  [/(\d+(?:[.,]\d+)?)\s*(миллилитр(?:а|ов|ы)?|мл\.?)/giu, "$1 мл"],
];

const EXAMPLE_KEYS = [
  "моцарелла",
  "чеддер",
  "бекон",
  "масло сливочное",
  "рис",
  "сахар",
  "картофель",
] as const;

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizePhrase(value: string | null | undefined) {
  return normalizeCatalogText(String(value ?? ""));
}

function stripNormalizedPhrase(source: string, value: string | null | undefined) {
  const normalizedValue = normalizePhrase(value);

  if (!normalizedValue) {
    return source;
  }

  return ` ${source} `.split(` ${normalizedValue} `).join(" ").replace(/\s+/g, " ").trim();
}

function normalizeForAudit(params: {
  name: string;
  brand: string | null | undefined;
  offerBrand: string | null | undefined;
  masterBrand: string | null | undefined;
  supplierName: string;
}) {
  let value = String(params.name ?? "");

  for (const [pattern, replacement] of UNIT_REPLACEMENTS) {
    value = value.replace(pattern, replacement);
  }

  let normalized = normalizeCatalogText(value);
  normalized = stripNormalizedPhrase(normalized, params.brand);
  normalized = stripNormalizedPhrase(normalized, params.offerBrand);
  normalized = stripNormalizedPhrase(normalized, params.masterBrand);
  normalized = stripNormalizedPhrase(normalized, params.supplierName);
  normalized = normalized.replace(/\bооо\b|\bип\b|\booo\b/gu, " ").replace(/\s+/g, " ").trim();

  return normalized || normalizeCatalogText(params.name);
}

function compareGroups(left: ProductMasterAuditGroupDto, right: ProductMasterAuditGroupDto) {
  if (left.productMastersCount !== right.productMastersCount) {
    return right.productMastersCount - left.productMastersCount;
  }

  if (left.suppliersCount !== right.suppliersCount) {
    return right.suppliersCount - left.suppliersCount;
  }

  if (left.productsCount !== right.productsCount) {
    return right.productsCount - left.productsCount;
  }

  return left.normalizedName.localeCompare(right.normalizedName, "ru");
}

function compareMasters(left: ProductMasterAuditMasterDto, right: ProductMasterAuditMasterDto) {
  if (left.suppliersCount !== right.suppliersCount) {
    return right.suppliersCount - left.suppliersCount;
  }

  if (left.productsCount !== right.productsCount) {
    return right.productsCount - left.productsCount;
  }

  return left.productMasterName.localeCompare(right.productMasterName, "ru");
}

export async function buildProductMasterAuditReport(
  enterpriseId: string,
): Promise<ProductMasterAuditReportDto> {
  const [totalProductMasters, products] = await Promise.all([
    prisma.productMaster.count({
      where: {
        enterpriseId,
      },
    }),
    prisma.product.findMany({
      where: {
        enterpriseId,
        supplier: {
          archivedAt: null,
        },
        document: {
          isCurrent: true,
        },
      },
      select: {
        id: true,
        name: true,
        brand: true,
        supplier: {
          select: {
            id: true,
            name: true,
          },
        },
        priceSnapshots: {
          where: {
            isCurrent: true,
          },
          take: 1,
          select: {
            supplierOffer: {
              select: {
                brand: true,
                mappings: {
                  where: {
                    status: "active",
                    productMasterId: {
                      not: null,
                    },
                  },
                  orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
                  take: 1,
                  select: {
                    productMasterId: true,
                    productMaster: {
                      select: {
                        id: true,
                        name: true,
                        brand: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const groups = new Map<string, AuditGroupAccumulator>();

  for (const product of products) {
    const snapshot = product.priceSnapshots[0] ?? null;
    const mapping = snapshot?.supplierOffer.mappings[0] ?? null;
    const productMaster = mapping?.productMaster ?? null;
    const normalizedName = normalizeForAudit({
      name: product.name,
      brand: product.brand,
      offerBrand: snapshot?.supplierOffer.brand,
      masterBrand: productMaster?.brand,
      supplierName: product.supplier.name,
    });

    if (!normalizedName) {
      continue;
    }

    const group: AuditGroupAccumulator = groups.get(normalizedName) ?? {
      normalizedName,
      productIds: new Set<string>(),
      suppliers: new Set<string>(),
      masterIds: new Set<string>(),
      examples: [],
      masterStats: new Map(),
    };

    group.productIds.add(product.id);
    group.suppliers.add(product.supplier.name);

    if (mapping?.productMasterId && productMaster) {
      group.masterIds.add(mapping.productMasterId);

      const masterRecord = group.masterStats.get(mapping.productMasterId) ?? {
        productMasterId: mapping.productMasterId,
        productMasterName: productMaster.name,
        brand: productMaster.brand ?? null,
        productIds: new Set<string>(),
        suppliers: new Set<string>(),
        supplierNames: new Set<string>(),
      };

      masterRecord.productIds.add(product.id);
      masterRecord.suppliers.add(product.supplier.id);
      masterRecord.supplierNames.add(product.supplier.name);
      group.masterStats.set(mapping.productMasterId, masterRecord);
    }

    if (group.examples.length < 5) {
      group.examples.push({
        productId: product.id,
        productName: product.name,
        supplierName: product.supplier.name,
        brand: product.brand ?? null,
        productMasterId: mapping?.productMasterId ?? null,
        productMasterName: productMaster?.name ?? null,
      });
    }

    groups.set(normalizedName, group);
  }

  const allDuplicateGroups = Array.from(groups.values())
    .map<ProductMasterAuditGroupDto>((group) => ({
      normalizedName: group.normalizedName,
      productsCount: group.productIds.size,
      suppliersCount: group.suppliers.size,
      productMastersCount: group.masterIds.size,
      supplierNames: Array.from(group.suppliers).sort((left, right) => left.localeCompare(right, "ru")),
      masterIds: Array.from(group.masterIds).sort((left, right) => left.localeCompare(right, "ru")),
      examples: group.examples,
    }))
    .filter((group) => group.productMastersCount > 1)
    .sort(compareGroups);

  const duplicateMasterIds = new Set<string>();

  for (const group of allDuplicateGroups) {
    for (const masterId of group.masterIds) {
      duplicateMasterIds.add(masterId);
    }
  }

  const topDuplicateGroups = allDuplicateGroups.slice(0, 100);

  const likelyDuplicateMasters = Array.from(groups.values())
    .filter((group) => group.masterIds.size > 1)
    .flatMap((group) =>
      Array.from(group.masterStats.values()).map<ProductMasterAuditMasterDto>((masterRecord) => ({
        productMasterId: masterRecord.productMasterId,
        productMasterName: masterRecord.productMasterName,
        brand: masterRecord.brand,
        groupNormalizedName: group.normalizedName,
        productsCount: masterRecord.productIds.size,
        suppliersCount: masterRecord.suppliers.size,
        supplierNames: Array.from(masterRecord.supplierNames).sort((left, right) => left.localeCompare(right, "ru")),
      })),
    )
    .sort(compareMasters)
    .slice(0, 100);

  const exampleGroups = Object.fromEntries(
    EXAMPLE_KEYS.map((key) => [
      key,
      Array.from(groups.values())
        .filter((group) => group.normalizedName.includes(key))
        .map<ProductMasterAuditGroupDto>((group) => ({
          normalizedName: group.normalizedName,
          productsCount: group.productIds.size,
          suppliersCount: group.suppliers.size,
          productMastersCount: group.masterIds.size,
          supplierNames: Array.from(group.suppliers).sort((left, right) => left.localeCompare(right, "ru")),
          masterIds: Array.from(group.masterIds).sort((left, right) => left.localeCompare(right, "ru")),
          examples: group.examples,
        }))
        .sort(compareGroups)
        .slice(0, 10),
    ]),
  ) as Record<string, ProductMasterAuditGroupDto[]>;

  return {
    summary: {
      totalProductMasters,
      suspectedDuplicateMasters: duplicateMasterIds.size,
      duplicatePercent: totalProductMasters > 0 ? roundToTwo((duplicateMasterIds.size / totalProductMasters) * 100) : 0,
      totalProducts: products.length,
      groupsCount: groups.size,
      duplicateGroupsCount: allDuplicateGroups.length,
    },
    topDuplicateGroups,
    likelyDuplicateMasters,
    exampleGroups,
  };
}
