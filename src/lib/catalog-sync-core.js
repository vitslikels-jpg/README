import {
  AUTO_MAPPING_THRESHOLD,
  buildCatalogDedupeKey,
  calculateAutoMappingConfidence,
  normalizeCatalogText,
  normalizeCatalogUnit,
  normalizeOptionalString,
} from "./catalog-model.shared.js";

function sortProducts(products) {
  return [...products].sort((left, right) => {
    const leftCurrent = left.document?.isCurrent ? 1 : 0;
    const rightCurrent = right.document?.isCurrent ? 1 : 0;

    if (leftCurrent !== rightCurrent) {
      return rightCurrent - leftCurrent;
    }

    const leftTime = new Date(left.document?.uploadedAt ?? left.createdAt).getTime();
    const rightTime = new Date(right.document?.uploadedAt ?? right.createdAt).getTime();
    return rightTime - leftTime;
  });
}

function buildOfferPayload(product, unitId, normalizedName, normalizedArticle, normalizedBrand, unitCode) {
  return {
    enterpriseId: product.enterpriseId,
    supplierId: product.supplierId,
    unitId,
    name: product.name,
    normalizedName,
    article: normalizeOptionalString(product.article),
    normalizedArticle,
    brand: normalizeOptionalString(product.brand),
    normalizedBrand,
    country: normalizeOptionalString(product.country),
    legacyUnit: normalizeOptionalString(product.unit),
    dedupeKey: buildCatalogDedupeKey([normalizedName, normalizedArticle, unitCode ?? normalizeCatalogText(product.unit)]),
    unitsPerPack: product.unitsPerPack?.toString() ?? null,
    minOrderQuantity: product.minOrderQuantity?.toString() ?? null,
    orderStep: product.orderStep?.toString() ?? null,
    allowFractionalOrder: product.allowFractionalOrder,
    shipByBoxesOnly: product.shipByBoxesOnly,
  };
}

function buildMasterPayload(product, unitId, normalizedName, normalizedBrand, unitCode) {
  return {
    enterpriseId: product.enterpriseId,
    unitId,
    name: product.name,
    normalizedName,
    brand: normalizeOptionalString(product.brand),
    normalizedBrand,
    legacyUnit: normalizeOptionalString(product.unit),
    dedupeKey: buildCatalogDedupeKey([normalizedName, normalizedBrand, unitCode ?? normalizeCatalogText(product.unit)]),
  };
}

function isManualMapping(mapping) {
  return typeof mapping.matchSource === "string" && mapping.matchSource.startsWith("manual");
}

async function applyMapping({
  prisma,
  supplierOffer,
  productMaster,
  enterpriseId,
  confidence,
  matchKey,
  syncSource,
  counters,
}) {
  const activeMappings = await prisma.productMapping.findMany({
    where: {
      supplierOfferId: supplierOffer.id,
      status: "active",
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  const manualMapping = activeMappings.find(isManualMapping);

  if (manualMapping) {
    counters.productMappingsSkipped += 1;
    counters.manualMappingsPreserved += 1;
    return;
  }

  const existingSameMaster = activeMappings.find((mapping) => mapping.productMasterId === productMaster.id);

  if (existingSameMaster) {
    const existingConfidence = Number(existingSameMaster.confidence?.toString() ?? "0");

    if (confidence > existingConfidence) {
      await prisma.productMapping.update({
        where: { id: existingSameMaster.id },
        data: {
          confidence: confidence.toFixed(4),
          matchKey,
          matchSource: syncSource,
          status: "active",
        },
      });
    }

    counters.productMappingsCreatedOrUpdated += 1;
    return;
  }

  const bestActiveAuto = activeMappings[0] ?? null;
  const bestActiveConfidence = Number(bestActiveAuto?.confidence?.toString() ?? "0");

  if (bestActiveAuto && confidence <= bestActiveConfidence) {
    counters.productMappingsSkipped += 1;
    return;
  }

  if (bestActiveAuto) {
    await prisma.productMapping.update({
      where: { id: bestActiveAuto.id },
      data: {
        status: "superseded",
      },
    });
  }

  await prisma.productMapping.upsert({
    where: {
      supplierOfferId_productMasterId: {
        supplierOfferId: supplierOffer.id,
        productMasterId: productMaster.id,
      },
    },
    update: {
      enterpriseId,
      confidence: confidence.toFixed(4),
      matchKey,
      matchSource: syncSource,
      status: "active",
    },
    create: {
      enterpriseId,
      supplierOfferId: supplierOffer.id,
      productMasterId: productMaster.id,
      confidence: confidence.toFixed(4),
      matchKey,
      matchSource: syncSource,
      status: "active",
    },
  });

  counters.productMappingsCreatedOrUpdated += 1;
}

function createCounters(syncSource) {
  return {
    syncSource,
    groupsProcessed: 0,
    productsProcessed: 0,
    supplierOffersCreatedOrUpdated: 0,
    supplierOffersCreated: 0,
    priceSnapshotsCreatedOrUpdated: 0,
    priceSnapshotsCreated: 0,
    productMastersCreatedOrUpdated: 0,
    productMastersCreated: 0,
    productMappingsCreatedOrUpdated: 0,
    productMappingsSkipped: 0,
    manualMappingsPreserved: 0,
  };
}

export async function syncCatalogForLegacyProducts({
  prisma,
  legacyProducts,
  syncSource,
}) {
  const counters = createCounters(syncSource);

  if (!legacyProducts.length) {
    return counters;
  }

  const units = await prisma.unit.findMany({
    select: {
      id: true,
      code: true,
    },
  });
  const unitsByCode = new Map(units.map((unit) => [unit.code, unit.id]));

  if (unitsByCode.size === 0) {
    throw new Error("Catalog units are not initialized. Run npm run catalog:seed-units first.");
  }

  const groupedByOffer = new Map();

  for (const product of legacyProducts) {
    const normalizedName = normalizeCatalogText(product.name);
    const normalizedArticle = normalizeCatalogText(product.article);
    const normalizedBrand = normalizeCatalogText(product.brand);
    const unitCode = normalizeCatalogUnit(product.unit);
    const offerKey = buildCatalogDedupeKey([
      normalizedName,
      normalizedArticle,
      unitCode ?? normalizeCatalogText(product.unit),
    ]);
    const groupKey = `${product.supplierId}::${offerKey}`;
    const existing = groupedByOffer.get(groupKey) ?? {
      supplierId: product.supplierId,
      enterpriseId: product.enterpriseId,
      normalizedName,
      normalizedArticle,
      normalizedBrand,
      unitCode,
      products: [],
    };

    existing.products.push(product);
    groupedByOffer.set(groupKey, existing);
  }

  for (const group of groupedByOffer.values()) {
    counters.groupsProcessed += 1;
    counters.productsProcessed += group.products.length;

    const sortedProducts = sortProducts(group.products);
    const representative = sortedProducts[0];
    const unitId = group.unitCode ? (unitsByCode.get(group.unitCode) ?? null) : null;

    const offerPayload = buildOfferPayload(
      representative,
      unitId,
      group.normalizedName,
      group.normalizedArticle,
      group.normalizedBrand,
      group.unitCode,
    );

    const existingSupplierOffer = await prisma.supplierOffer.findUnique({
      where: {
        supplierId_dedupeKey: {
          supplierId: representative.supplierId,
          dedupeKey: offerPayload.dedupeKey,
        },
      },
      select: { id: true },
    });
    const supplierOffer = await prisma.supplierOffer.upsert({
      where: {
        supplierId_dedupeKey: {
          supplierId: representative.supplierId,
          dedupeKey: offerPayload.dedupeKey,
        },
      },
      update: offerPayload,
      create: offerPayload,
    });
    counters.supplierOffersCreatedOrUpdated += 1;
    if (!existingSupplierOffer) {
      counters.supplierOffersCreated += 1;
    }

    const shouldMarkCurrent = sortedProducts.some((product) => product.document?.isCurrent);

    if (shouldMarkCurrent) {
      await prisma.priceSnapshot.updateMany({
        where: {
          supplierOfferId: supplierOffer.id,
          isCurrent: true,
        },
        data: {
          isCurrent: false,
        },
      });
    }

    for (const product of sortedProducts) {
      const shouldBeCurrent = Boolean(product.document?.isCurrent);

      const existingSnapshot = await prisma.priceSnapshot.findUnique({
        where: {
          legacyProductId: product.id,
        },
        select: { id: true },
      });
      await prisma.priceSnapshot.upsert({
        where: {
          legacyProductId: product.id,
        },
        update: {
          enterpriseId: product.enterpriseId,
          supplierId: product.supplierId,
          supplierOfferId: supplierOffer.id,
          documentId: product.documentId,
          unitId,
          legacyUnit: normalizeOptionalString(product.unit),
          price: product.price?.toString() ?? null,
          stock: product.stock?.toString() ?? null,
          sourceRow: product.sourceRow,
          capturedAt: product.document?.uploadedAt ?? product.createdAt,
          isCurrent: shouldBeCurrent,
          rawData: product.rawData ?? null,
        },
        create: {
          enterpriseId: product.enterpriseId,
          supplierId: product.supplierId,
          supplierOfferId: supplierOffer.id,
          documentId: product.documentId,
          legacyProductId: product.id,
          unitId,
          legacyUnit: normalizeOptionalString(product.unit),
          price: product.price?.toString() ?? null,
          stock: product.stock?.toString() ?? null,
          sourceRow: product.sourceRow,
          capturedAt: product.document?.uploadedAt ?? product.createdAt,
          isCurrent: shouldBeCurrent,
          rawData: product.rawData ?? null,
        },
      });
      counters.priceSnapshotsCreatedOrUpdated += 1;
      if (!existingSnapshot) {
        counters.priceSnapshotsCreated += 1;
      }
    }

    const confidence = calculateAutoMappingConfidence({
      normalizedName: group.normalizedName,
      normalizedBrand: group.normalizedBrand,
      normalizedArticle: group.normalizedArticle,
      unitCode: group.unitCode,
      groupSize: sortedProducts.length,
      hasCurrentSnapshot: shouldMarkCurrent,
    });

    if (confidence < AUTO_MAPPING_THRESHOLD) {
      counters.productMappingsSkipped += 1;
      continue;
    }

    const masterPayload = buildMasterPayload(
      representative,
      unitId,
      group.normalizedName,
      group.normalizedBrand,
      group.unitCode,
    );

    const existingProductMaster = await prisma.productMaster.findUnique({
      where: {
        enterpriseId_dedupeKey: {
          enterpriseId: representative.enterpriseId,
          dedupeKey: masterPayload.dedupeKey,
        },
      },
      select: { id: true },
    });
    const productMaster = await prisma.productMaster.upsert({
      where: {
        enterpriseId_dedupeKey: {
          enterpriseId: representative.enterpriseId,
          dedupeKey: masterPayload.dedupeKey,
        },
      },
      update: masterPayload,
      create: masterPayload,
    });
    counters.productMastersCreatedOrUpdated += 1;
    if (!existingProductMaster) {
      counters.productMastersCreated += 1;
    }

    await applyMapping({
      prisma,
      supplierOffer,
      productMaster,
      enterpriseId: representative.enterpriseId,
      confidence,
      matchKey: masterPayload.dedupeKey,
      syncSource,
      counters,
    });
  }

  return counters;
}

export async function syncCatalogForDocument({
  prisma,
  documentId,
  syncSource = "parse_auto",
}) {
  await prisma.priceSnapshot.deleteMany({
    where: {
      documentId,
    },
  });

  const legacyProducts = await prisma.product.findMany({
    where: {
      documentId,
    },
    include: {
      document: {
        select: {
          id: true,
          isCurrent: true,
          uploadedAt: true,
        },
      },
    },
    orderBy: [{ supplierId: "asc" }, { createdAt: "asc" }],
  });

  return syncCatalogForLegacyProducts({
    prisma,
    legacyProducts,
    syncSource,
  });
}
