import { Prisma } from "@prisma/client";
import { normalizeCatalogText, normalizeOptionalString } from "@/lib/catalog-model.shared.js";
import { prisma } from "@/lib/prisma";

export async function getProductMasterWithSupplierOffers(productMasterId: string, enterpriseId?: string) {
  const productMaster = await prisma.productMaster.findFirst({
    where: {
      id: productMasterId,
      ...(enterpriseId ? { enterpriseId } : {}),
    },
    include: {
      unit: true,
      mappings: {
        where: {
          status: "active",
        },
        orderBy: [{ confidence: "desc" }, { createdAt: "asc" }],
        include: {
          supplierOffer: {
            include: {
              supplier: {
                select: {
                  id: true,
                  name: true,
                  archivedAt: true,
                },
              },
              unit: true,
              priceSnapshots: {
                where: {
                  isCurrent: true,
                },
                orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  if (!productMaster) {
    return null;
  }

  return {
    ...productMaster,
    supplierOffers: productMaster.mappings.map((mapping) => ({
      mapping,
      offer: mapping.supplierOffer,
      currentPriceSnapshot: mapping.supplierOffer.priceSnapshots[0] ?? null,
    })),
  };
}

export async function getCurrentPriceSnapshotForSupplierOffer(supplierOfferId: string) {
  const currentSnapshot = await prisma.priceSnapshot.findFirst({
    where: {
      supplierOfferId,
      isCurrent: true,
    },
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
    include: {
      unit: true,
      document: {
        select: {
          id: true,
          originalFileName: true,
          uploadedAt: true,
          isCurrent: true,
        },
      },
    },
  });

  if (currentSnapshot) {
    return currentSnapshot;
  }

  return prisma.priceSnapshot.findFirst({
    where: {
      supplierOfferId,
    },
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
    include: {
      unit: true,
      document: {
        select: {
          id: true,
          originalFileName: true,
          uploadedAt: true,
          isCurrent: true,
        },
      },
    },
  });
}

function decimalToString(value: { toString: () => string } | null | undefined) {
  return value ? value.toString() : null;
}

function buildMasterDedupeKey(normalizedName: string, normalizedBrand: string | null, unitCode: string | null) {
  return [normalizedName || "-", normalizedBrand || "-", unitCode || "-"].join("|");
}

function serializeCatalogSnapshot(snapshot: {
  id: string;
  price: Prisma.Decimal | null;
  stock: Prisma.Decimal | null;
  sourceRow: number | null;
  capturedAt: Date;
  isCurrent: boolean;
  createdAt: Date;
  updatedAt: Date;
  document?: { id: string; originalFileName: string; uploadedAt: Date; isCurrent: boolean } | null;
} | null) {
  if (!snapshot) {
    return null;
  }

  return {
    id: snapshot.id,
    price: decimalToString(snapshot.price),
    stock: decimalToString(snapshot.stock),
    sourceRow: snapshot.sourceRow,
    capturedAt: snapshot.capturedAt,
    isCurrent: snapshot.isCurrent,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    document: snapshot.document ?? null,
  };
}

function buildOfferFilters(params: {
  enterpriseId: string;
  search?: string;
  supplierId?: string | null;
  unitId?: string | null;
}) {
  const normalizedSearch = normalizeCatalogText(params.search);
  const supplierId = normalizeOptionalString(params.supplierId);
  const unitId = normalizeOptionalString(params.unitId);

  return {
    enterpriseId: params.enterpriseId,
    ...(supplierId ? { supplierId } : {}),
    ...(unitId ? { unitId } : {}),
    ...(normalizedSearch
      ? {
          OR: [
            { normalizedName: { contains: normalizedSearch } },
            { normalizedArticle: { contains: normalizedSearch } },
            { normalizedBrand: { contains: normalizedSearch } },
          ],
        }
      : {}),
  };
}

export async function listCatalogProductMasters(enterpriseId: string, search?: string) {
  const normalizedSearch = normalizeCatalogText(search);

  const productMasters = await prisma.productMaster.findMany({
    where: {
      enterpriseId,
      ...(normalizedSearch
        ? {
            OR: [
              { normalizedName: { contains: normalizedSearch } },
              { normalizedBrand: { contains: normalizedSearch } },
              { category: { contains: search?.trim(), mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      unit: true,
      mappings: {
        where: {
          status: "active",
        },
        orderBy: [{ confidence: "desc" }, { createdAt: "asc" }],
        include: {
          supplierOffer: {
            include: {
              supplier: {
                select: {
                  id: true,
                  name: true,
                  archivedAt: true,
                },
              },
              unit: true,
              priceSnapshots: {
                where: {
                  isCurrent: true,
                },
                orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
                take: 1,
              },
            },
          },
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
  });

  return productMasters.map((productMaster) => {
    const supplierOffers = productMaster.mappings.map((mapping) => {
      const currentSnapshot = mapping.supplierOffer.priceSnapshots[0] ?? null;

      return {
        id: mapping.supplierOffer.id,
        name: mapping.supplierOffer.name,
        normalizedName: mapping.supplierOffer.normalizedName,
        article: mapping.supplierOffer.article,
        brand: mapping.supplierOffer.brand,
        country: mapping.supplierOffer.country,
        legacyUnit: mapping.supplierOffer.legacyUnit,
        unitsPerPack: decimalToString(mapping.supplierOffer.unitsPerPack),
        minOrderQuantity: decimalToString(mapping.supplierOffer.minOrderQuantity),
        orderStep: decimalToString(mapping.supplierOffer.orderStep),
        allowFractionalOrder: mapping.supplierOffer.allowFractionalOrder,
        shipByBoxesOnly: mapping.supplierOffer.shipByBoxesOnly,
        supplier: mapping.supplierOffer.supplier,
        unit: mapping.supplierOffer.unit,
        currentPriceSnapshot: serializeCatalogSnapshot(currentSnapshot),
        mapping: {
          id: mapping.id,
          confidence: decimalToString(mapping.confidence),
          matchSource: mapping.matchSource,
          status: mapping.status,
        },
      };
    });

    const priceValues = supplierOffers
      .map((offer) => offer.currentPriceSnapshot?.price)
      .filter((value): value is string => Boolean(value))
      .map((value) => Number(value))
      .filter(Number.isFinite);

    return {
      id: productMaster.id,
      enterpriseId: productMaster.enterpriseId,
      name: productMaster.name,
      normalizedName: productMaster.normalizedName,
      brand: productMaster.brand,
      normalizedBrand: productMaster.normalizedBrand,
      category: productMaster.category,
      legacyUnit: productMaster.legacyUnit,
      dedupeKey: productMaster.dedupeKey,
      createdAt: productMaster.createdAt,
      updatedAt: productMaster.updatedAt,
      unit: productMaster.unit,
      supplierOffers,
      offersCount: supplierOffers.length,
      minCurrentPrice: priceValues.length ? String(Math.min(...priceValues)) : null,
      maxCurrentPrice: priceValues.length ? String(Math.max(...priceValues)) : null,
    };
  });
}

function areNamesSimilar(left: string, right: string) {
  if (!left || !right) {
    return false;
  }

  return left === right || left.includes(right) || right.includes(left);
}

export async function listCatalogProductsReadModel(params: {
  enterpriseId: string;
  supplierId?: string | null;
  search?: string;
}) {
  const normalizedSearch = normalizeCatalogText(params.search);

  const productMasters = await prisma.productMaster.findMany({
    where: {
      enterpriseId: params.enterpriseId,
      mappings: {
        some: {
          status: "active",
          ...(params.supplierId ? { supplierOffer: { supplierId: params.supplierId } } : {}),
        },
      },
      ...(normalizedSearch
        ? {
            OR: [
              { normalizedName: { contains: normalizedSearch } },
              { normalizedBrand: { contains: normalizedSearch } },
              { category: { contains: params.search?.trim(), mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      unit: true,
      mappings: {
        where: {
          status: "active",
          ...(params.supplierId ? { supplierOffer: { supplierId: params.supplierId } } : {}),
        },
        orderBy: [{ confidence: "desc" }, { createdAt: "asc" }],
        include: {
          supplierOffer: {
            include: {
              supplier: {
                select: {
                  id: true,
                  name: true,
                  archivedAt: true,
                },
              },
              unit: true,
              priceSnapshots: {
                where: {
                  isCurrent: true,
                },
                orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
                take: 1,
                include: {
                  document: {
                    select: {
                      id: true,
                      qualityReport: {
                        select: {
                          qualityStatus: true,
                          usabilityStatus: true,
                          usabilityReason: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
  });

  const unmappedOffers = await listUnmappedSupplierOffers({
    enterpriseId: params.enterpriseId,
  });

  return productMasters.map((productMaster) => {
    const currentOffers = productMaster.mappings.map((mapping) => {
      const currentSnapshot = mapping.supplierOffer.priceSnapshots[0] ?? null;

      return {
        id: mapping.supplierOffer.id,
        name: mapping.supplierOffer.name,
        article: mapping.supplierOffer.article,
        brand: mapping.supplierOffer.brand,
        legacyUnit: mapping.supplierOffer.legacyUnit,
        unitsPerPack: decimalToString(mapping.supplierOffer.unitsPerPack),
        minOrderQuantity: decimalToString(mapping.supplierOffer.minOrderQuantity),
        orderStep: decimalToString(mapping.supplierOffer.orderStep),
        allowFractionalOrder: mapping.supplierOffer.allowFractionalOrder,
        shipByBoxesOnly: mapping.supplierOffer.shipByBoxesOnly,
        supplier: mapping.supplierOffer.supplier,
        unit: mapping.supplierOffer.unit,
        currentPriceSnapshot: currentSnapshot
          ? {
              id: currentSnapshot.id,
              price: decimalToString(currentSnapshot.price),
              stock: decimalToString(currentSnapshot.stock),
              capturedAt: currentSnapshot.capturedAt.toISOString(),
              document: currentSnapshot.document
                ? {
                    id: currentSnapshot.document.id,
                    qualityReport: currentSnapshot.document.qualityReport
                      ? {
                          qualityStatus: currentSnapshot.document.qualityReport.qualityStatus,
                          usabilityStatus: currentSnapshot.document.qualityReport.usabilityStatus,
                          usabilityReason: currentSnapshot.document.qualityReport.usabilityReason,
                        }
                      : null,
                  }
                : null,
            }
          : null,
        mapping: {
          id: mapping.id,
          confidence: decimalToString(mapping.confidence),
          matchSource: mapping.matchSource,
          status: mapping.status,
        },
      };
    });

    const prices = currentOffers
      .map((offer) => offer.currentPriceSnapshot?.price)
      .filter((value): value is string => Boolean(value))
      .map((value) => Number(value))
      .filter(Number.isFinite);

    const bestOffer =
      [...currentOffers]
        .filter((offer) => offer.currentPriceSnapshot?.price)
        .sort(
          (left, right) =>
            Number(left.currentPriceSnapshot?.price ?? Number.POSITIVE_INFINITY) -
            Number(right.currentPriceSnapshot?.price ?? Number.POSITIVE_INFINITY),
        )[0] ?? null;

    const similarUnmappedOffers = unmappedOffers.filter((offer) =>
      areNamesSimilar(productMaster.normalizedName, offer.normalizedName),
    );

    const suppliers = Array.from(
      new Map(currentOffers.map((offer) => [offer.supplier.id, { id: offer.supplier.id, name: offer.supplier.name }])).values(),
    );

    return {
      id: productMaster.id,
      enterpriseId: productMaster.enterpriseId,
      name: productMaster.name,
      normalizedName: productMaster.normalizedName,
      brand: productMaster.brand,
      category: productMaster.category,
      unit: productMaster.unit,
      offersCount: currentOffers.length,
      suppliers,
      minCurrentPrice: prices.length ? String(Math.min(...prices)) : null,
      maxCurrentPrice: prices.length ? String(Math.max(...prices)) : null,
      bestOffer,
      currentOffers,
      hasSimilarUnmappedOffers: similarUnmappedOffers.length > 0,
      similarUnmappedOffersCount: similarUnmappedOffers.length,
    };
  });
}

export async function listUnmappedSupplierOffers(params: {
  enterpriseId: string;
  search?: string;
  supplierId?: string | null;
  unitId?: string | null;
}) {
  const supplierOffers = await prisma.supplierOffer.findMany({
    where: {
      ...buildOfferFilters(params),
      mappings: {
        none: {
          status: "active",
        },
      },
    },
    include: {
      supplier: {
        select: {
          id: true,
          name: true,
          archivedAt: true,
        },
      },
      unit: true,
      priceSnapshots: {
        orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
        take: 5,
      },
    },
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
  });

  return supplierOffers.map((offer) => {
    const latestSnapshot = offer.priceSnapshots[0] ?? null;
    const currentSnapshot = offer.priceSnapshots.find((snapshot) => snapshot.isCurrent) ?? latestSnapshot;

    return {
      id: offer.id,
      enterpriseId: offer.enterpriseId,
      supplierId: offer.supplierId,
      name: offer.name,
      normalizedName: offer.normalizedName,
      article: offer.article,
      brand: offer.brand,
      country: offer.country,
      legacyUnit: offer.legacyUnit,
      unitsPerPack: decimalToString(offer.unitsPerPack),
      minOrderQuantity: decimalToString(offer.minOrderQuantity),
      orderStep: decimalToString(offer.orderStep),
      allowFractionalOrder: offer.allowFractionalOrder,
      shipByBoxesOnly: offer.shipByBoxesOnly,
      supplier: offer.supplier,
      unit: offer.unit,
      currentPriceSnapshot: serializeCatalogSnapshot(currentSnapshot),
      lastSeenAt: latestSnapshot?.capturedAt ?? null,
      mappingStatus: "unmapped" as const,
      activeMapping: null,
    };
  });
}

export async function listMappedSupplierOffers(params: {
  enterpriseId: string;
  search?: string;
  supplierId?: string | null;
  unitId?: string | null;
}) {
  const supplierOffers = await prisma.supplierOffer.findMany({
    where: {
      ...buildOfferFilters(params),
      mappings: {
        some: {
          status: "active",
        },
      },
    },
    include: {
      supplier: {
        select: {
          id: true,
          name: true,
          archivedAt: true,
        },
      },
      unit: true,
      priceSnapshots: {
        orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
        take: 5,
      },
      mappings: {
        where: {
          status: {
            in: ["active", "superseded"],
          },
        },
        orderBy: [{ status: "asc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
        include: {
          productMaster: {
            include: {
              unit: true,
            },
          },
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
  });

  return supplierOffers.map((offer) => {
    const latestSnapshot = offer.priceSnapshots[0] ?? null;
    const currentSnapshot = offer.priceSnapshots.find((snapshot) => snapshot.isCurrent) ?? latestSnapshot;
    const activeMapping = offer.mappings.find((mapping) => mapping.status === "active") ?? null;

    return {
      id: offer.id,
      enterpriseId: offer.enterpriseId,
      supplierId: offer.supplierId,
      name: offer.name,
      normalizedName: offer.normalizedName,
      article: offer.article,
      brand: offer.brand,
      country: offer.country,
      legacyUnit: offer.legacyUnit,
      unitsPerPack: decimalToString(offer.unitsPerPack),
      minOrderQuantity: decimalToString(offer.minOrderQuantity),
      orderStep: decimalToString(offer.orderStep),
      allowFractionalOrder: offer.allowFractionalOrder,
      shipByBoxesOnly: offer.shipByBoxesOnly,
      supplier: offer.supplier,
      unit: offer.unit,
      currentPriceSnapshot: serializeCatalogSnapshot(currentSnapshot),
      lastSeenAt: latestSnapshot?.capturedAt ?? null,
      mappingStatus: "mapped" as const,
      activeMapping: activeMapping
        ? {
            id: activeMapping.id,
            productMasterId: activeMapping.productMasterId,
            confidence: decimalToString(activeMapping.confidence),
            matchSource: activeMapping.matchSource,
            status: activeMapping.status,
            createdAt: activeMapping.createdAt,
            updatedAt: activeMapping.updatedAt,
            productMaster: activeMapping.productMaster
              ? {
                  id: activeMapping.productMaster.id,
                  name: activeMapping.productMaster.name,
                  brand: activeMapping.productMaster.brand,
                  category: activeMapping.productMaster.category,
                  unit: activeMapping.productMaster.unit,
                }
              : null,
          }
        : null,
      mappings: offer.mappings.map((mapping) => ({
        id: mapping.id,
        productMasterId: mapping.productMasterId,
        confidence: decimalToString(mapping.confidence),
        matchSource: mapping.matchSource,
        status: mapping.status,
        createdAt: mapping.createdAt,
        updatedAt: mapping.updatedAt,
        productMaster: mapping.productMaster
          ? {
              id: mapping.productMaster.id,
              name: mapping.productMaster.name,
              brand: mapping.productMaster.brand,
              category: mapping.productMaster.category,
              unit: mapping.productMaster.unit,
            }
          : null,
      })),
    };
  });
}

export async function createProductMaster(params: {
  enterpriseId: string;
  name: string;
  unitId?: string | null;
  brand?: string | null;
  category?: string | null;
}) {
  const name = params.name.trim();
  const brand = normalizeOptionalString(params.brand);
  const category = normalizeOptionalString(params.category);
  const unitId = normalizeOptionalString(params.unitId);

  if (!name) {
    throw new Error("Поле name обязательно.");
  }

  let unitCode: string | null = null;

  if (unitId) {
    const unit = await prisma.unit.findUnique({
      where: { id: unitId },
      select: { id: true, code: true },
    });

    if (!unit) {
      throw new Error("Unit не найден.");
    }

    unitCode = unit.code;
  }

  const normalizedName = normalizeCatalogText(name);
  const normalizedBrand = normalizeCatalogText(brand);
  const dedupeKey = buildMasterDedupeKey(normalizedName, normalizedBrand, unitCode);

  const existingMaster = await prisma.productMaster.findFirst({
    where: {
      enterpriseId: params.enterpriseId,
      dedupeKey,
    },
    include: {
      unit: true,
    },
  });

  if (existingMaster) {
    return {
      created: false,
      productMaster: existingMaster,
    };
  }

  const productMaster = await prisma.productMaster.create({
    data: {
      enterpriseId: params.enterpriseId,
      unitId,
      name,
      normalizedName,
      brand,
      normalizedBrand,
      category,
      dedupeKey,
    },
    include: {
      unit: true,
    },
  });

  return {
    created: true,
    productMaster,
  };
}

export async function createManualProductMapping(params: {
  supplierOfferId: string;
  productMasterId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const supplierOffer = await tx.supplierOffer.findUnique({
      where: { id: params.supplierOfferId },
      select: {
        id: true,
        enterpriseId: true,
      },
    });

    if (!supplierOffer) {
      throw new Error("SupplierOffer не найден.");
    }

    const productMaster = await tx.productMaster.findUnique({
      where: { id: params.productMasterId },
      select: {
        id: true,
        enterpriseId: true,
      },
    });

    if (!productMaster) {
      throw new Error("ProductMaster не найден.");
    }

    if (supplierOffer.enterpriseId !== productMaster.enterpriseId) {
      throw new Error("SupplierOffer и ProductMaster относятся к разным предприятиям.");
    }

    await tx.productMapping.updateMany({
      where: {
        supplierOfferId: supplierOffer.id,
        status: "active",
        NOT: {
          productMasterId: productMaster.id,
          matchSource: "manual",
        },
      },
      data: {
        status: "superseded",
      },
    });

    const mapping = await tx.productMapping.upsert({
      where: {
        supplierOfferId_productMasterId: {
          supplierOfferId: supplierOffer.id,
          productMasterId: productMaster.id,
        },
      },
      update: {
        enterpriseId: supplierOffer.enterpriseId,
        confidence: "1",
        matchKey: productMaster.id,
        matchSource: "manual",
        status: "active",
      },
      create: {
        enterpriseId: supplierOffer.enterpriseId,
        supplierOfferId: supplierOffer.id,
        productMasterId: productMaster.id,
        confidence: "1",
        matchKey: productMaster.id,
        matchSource: "manual",
        status: "active",
      },
    });

    return mapping;
  });
}

export async function revokeManualProductMapping(mappingId: string) {
  return prisma.$transaction(async (tx) => {
    const mapping = await tx.productMapping.findUnique({
      where: { id: mappingId },
      include: {
        supplierOffer: {
          select: {
            id: true,
            enterpriseId: true,
          },
        },
      },
    });

    if (!mapping) {
      throw new Error("Mapping не найден.");
    }

    if (mapping.matchSource !== "manual") {
      throw new Error("Отменять можно только manual mapping.");
    }

    if (mapping.status !== "active") {
      throw new Error("Этот manual mapping уже не активен.");
    }

    await tx.productMapping.update({
      where: { id: mapping.id },
      data: {
        status: "superseded",
      },
    });

    const bestAutoMapping = await tx.productMapping.findFirst({
      where: {
        supplierOfferId: mapping.supplierOfferId,
        status: "superseded",
        matchSource: {
          not: "manual",
        },
      },
      orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
    });

    if (bestAutoMapping) {
      await tx.productMapping.update({
        where: { id: bestAutoMapping.id },
        data: {
          status: "active",
        },
      });
    }

    return {
      revokedMappingId: mapping.id,
      restoredMappingId: bestAutoMapping?.id ?? null,
    };
  });
}
