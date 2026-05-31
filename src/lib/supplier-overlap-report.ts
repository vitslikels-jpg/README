import { prisma } from "@/lib/prisma";

export type SupplierOverlapPairDto = {
  supplierA: string;
  supplierB: string;
  commonProductsCount: number;
  commonCategoriesCount: number;
  usableOverlapCount: number;
  overlapPercent: number;
};

export type SupplierOverlapCategoryDto = {
  category: string;
  commonProductsCount: number;
  supplierPairsCount: number;
};

export type SupplierOverlapUniqueProductDto = {
  productMasterId: string;
  productName: string;
  category: string | null;
  supplierName: string;
};

export type SupplierOverlapReportDto = {
  summary: {
    suppliersCount: number;
    supplierPairsCount: number;
    mappedProductsCount: number;
    categoriesCount: number;
    singleSupplierProductsCount: number;
  };
  topOverlapPairs: SupplierOverlapPairDto[];
  lowOverlapPairs: SupplierOverlapPairDto[];
  topCategories: SupplierOverlapCategoryDto[];
  lowCategories: SupplierOverlapCategoryDto[];
  singleSupplierProducts: SupplierOverlapUniqueProductDto[];
};

type SupplierProductEntry = {
  supplierId: string;
  supplierName: string;
  productMasterId: string;
  productName: string;
  category: string | null;
  usable: boolean;
};

function normalizeCategory(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

function compareTopPairs(left: SupplierOverlapPairDto, right: SupplierOverlapPairDto) {
  if (left.commonProductsCount !== right.commonProductsCount) {
    return right.commonProductsCount - left.commonProductsCount;
  }

  if (left.usableOverlapCount !== right.usableOverlapCount) {
    return right.usableOverlapCount - left.usableOverlapCount;
  }

  if (left.overlapPercent !== right.overlapPercent) {
    return right.overlapPercent - left.overlapPercent;
  }

  return `${left.supplierA}:${left.supplierB}`.localeCompare(`${right.supplierA}:${right.supplierB}`, "ru");
}

function compareLowPairs(left: SupplierOverlapPairDto, right: SupplierOverlapPairDto) {
  if (left.commonProductsCount !== right.commonProductsCount) {
    return left.commonProductsCount - right.commonProductsCount;
  }

  if (left.usableOverlapCount !== right.usableOverlapCount) {
    return left.usableOverlapCount - right.usableOverlapCount;
  }

  if (left.overlapPercent !== right.overlapPercent) {
    return left.overlapPercent - right.overlapPercent;
  }

  return `${left.supplierA}:${left.supplierB}`.localeCompare(`${right.supplierA}:${right.supplierB}`, "ru");
}

function compareTopCategories(left: SupplierOverlapCategoryDto, right: SupplierOverlapCategoryDto) {
  if (left.commonProductsCount !== right.commonProductsCount) {
    return right.commonProductsCount - left.commonProductsCount;
  }

  if (left.supplierPairsCount !== right.supplierPairsCount) {
    return right.supplierPairsCount - left.supplierPairsCount;
  }

  return left.category.localeCompare(right.category, "ru");
}

function compareLowCategories(left: SupplierOverlapCategoryDto, right: SupplierOverlapCategoryDto) {
  if (left.commonProductsCount !== right.commonProductsCount) {
    return left.commonProductsCount - right.commonProductsCount;
  }

  if (left.supplierPairsCount !== right.supplierPairsCount) {
    return left.supplierPairsCount - right.supplierPairsCount;
  }

  return left.category.localeCompare(right.category, "ru");
}

export async function buildSupplierOverlapReport(enterpriseId: string): Promise<SupplierOverlapReportDto> {
  const offers = await prisma.supplierOffer.findMany({
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
      mappings: {
        some: {
          status: "active",
          productMasterId: {
            not: null,
          },
        },
      },
    },
    select: {
      supplierId: true,
      supplier: {
        select: {
          name: true,
        },
      },
      priceSnapshots: {
        where: {
          isCurrent: true,
        },
        select: {
          price: true,
        },
      },
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
              category: true,
            },
          },
        },
      },
    },
  });

  const dedupedEntries = new Map<string, SupplierProductEntry>();

  for (const offer of offers) {
    const mapping = offer.mappings[0];

    if (!mapping?.productMasterId || !mapping.productMaster) {
      continue;
    }

    const usable = offer.priceSnapshots.some((snapshot) => snapshot.price && snapshot.price.gt(0));
    const key = `${offer.supplierId}:${mapping.productMasterId}`;
    const current = dedupedEntries.get(key);

    if (!current) {
      dedupedEntries.set(key, {
        supplierId: offer.supplierId,
        supplierName: offer.supplier.name,
        productMasterId: mapping.productMaster.id,
        productName: mapping.productMaster.name,
        category: normalizeCategory(mapping.productMaster.category),
        usable,
      });
      continue;
    }

    if (usable && !current.usable) {
      current.usable = true;
    }
  }

  const entries = Array.from(dedupedEntries.values());
  const supplierMap = new Map<
    string,
    {
      supplierName: string;
      products: Map<string, SupplierProductEntry>;
      categories: Set<string>;
    }
  >();
  const productSupplierMap = new Map<
    string,
    {
      productName: string;
      category: string | null;
      suppliers: Set<string>;
      supplierNames: Set<string>;
    }
  >();

  for (const entry of entries) {
    const supplierRecord = supplierMap.get(entry.supplierId) ?? {
      supplierName: entry.supplierName,
      products: new Map<string, SupplierProductEntry>(),
      categories: new Set<string>(),
    };

    supplierRecord.products.set(entry.productMasterId, entry);

    if (entry.category) {
      supplierRecord.categories.add(entry.category);
    }

    supplierMap.set(entry.supplierId, supplierRecord);

    const productRecord = productSupplierMap.get(entry.productMasterId) ?? {
      productName: entry.productName,
      category: entry.category,
      suppliers: new Set<string>(),
      supplierNames: new Set<string>(),
    };

    productRecord.suppliers.add(entry.supplierId);
    productRecord.supplierNames.add(entry.supplierName);
    productSupplierMap.set(entry.productMasterId, productRecord);
  }

  const suppliers = Array.from(supplierMap.entries()).map(([supplierId, value]) => ({
    supplierId,
    supplierName: value.supplierName,
    products: value.products,
  }));

  const pairResults: SupplierOverlapPairDto[] = [];
  const categoryOverlapMap = new Map<
    string,
    {
      commonProductsCount: number;
      supplierPairs: Set<string>;
    }
  >();

  for (let index = 0; index < suppliers.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < suppliers.length; nextIndex += 1) {
      const left = suppliers[index];
      const right = suppliers[nextIndex];
      const leftProductIds = Array.from(left.products.keys());
      const rightProductIds = new Set(right.products.keys());
      const commonProductIds = leftProductIds.filter((productMasterId) => rightProductIds.has(productMasterId));
      const commonCategories = new Set<string>();
      let usableOverlapCount = 0;

      for (const productMasterId of commonProductIds) {
        const leftEntry = left.products.get(productMasterId)!;
        const rightEntry = right.products.get(productMasterId)!;

        if (leftEntry.usable && rightEntry.usable) {
          usableOverlapCount += 1;
        }

        const category = leftEntry.category ?? rightEntry.category;

        if (category) {
          commonCategories.add(category);

          const pairKey = `${left.supplierId}:${right.supplierId}`;
          const categoryRecord = categoryOverlapMap.get(category) ?? {
            commonProductsCount: 0,
            supplierPairs: new Set<string>(),
          };

          categoryRecord.commonProductsCount += 1;
          categoryRecord.supplierPairs.add(pairKey);
          categoryOverlapMap.set(category, categoryRecord);
        }
      }

      const denominator = Math.min(left.products.size, right.products.size);
      const overlapPercent = denominator > 0 ? roundToTwo((commonProductIds.length / denominator) * 100) : 0;

      pairResults.push({
        supplierA: left.supplierName,
        supplierB: right.supplierName,
        commonProductsCount: commonProductIds.length,
        commonCategoriesCount: commonCategories.size,
        usableOverlapCount,
        overlapPercent,
      });
    }
  }

  const categories = Array.from(categoryOverlapMap.entries()).map(([category, value]) => ({
    category,
    commonProductsCount: value.commonProductsCount,
    supplierPairsCount: value.supplierPairs.size,
  }));

  const singleSupplierProducts = Array.from(productSupplierMap.entries())
    .filter(([, value]) => value.suppliers.size === 1)
    .map(([productMasterId, value]) => ({
      productMasterId,
      productName: value.productName,
      category: value.category,
      supplierName: Array.from(value.supplierNames)[0] ?? "",
    }))
    .sort((left, right) => left.productName.localeCompare(right.productName, "ru"))
    .slice(0, 100);

  return {
    summary: {
      suppliersCount: suppliers.length,
      supplierPairsCount: pairResults.length,
      mappedProductsCount: productSupplierMap.size,
      categoriesCount: categories.length,
      singleSupplierProductsCount: Array.from(productSupplierMap.values()).filter((value) => value.suppliers.size === 1).length,
    },
    topOverlapPairs: [...pairResults].sort(compareTopPairs).slice(0, 20),
    lowOverlapPairs: [...pairResults].sort(compareLowPairs).slice(0, 20),
    topCategories: [...categories].sort(compareTopCategories).slice(0, 20),
    lowCategories: [...categories].sort(compareLowCategories).slice(0, 20),
    singleSupplierProducts,
  };
}
