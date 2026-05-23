import { DocumentQualityStatus, DocumentUsabilityStatus, Prisma } from "@prisma/client";

import { AUTO_MAPPING_THRESHOLD } from "@/lib/catalog-model.shared.js";
import { prisma } from "@/lib/prisma";

const BAD_MISSING_PRICE_RATIO = 0.2;
const BAD_MISSING_UNIT_RATIO = 0.2;
const WARNING_UNMAPPED_RATIO = 0.15;
const LOW_CONFIDENCE_WARNING_THRESHOLD = 0.75;

const buildWarningMessage = (params: {
  rowsWithoutPrice: number;
  rowsWithoutUnit: number;
  unmappedOffersCount: number;
  lowConfidenceMappingsCount: number;
}) => {
  const messages: string[] = [];

  if (params.rowsWithoutPrice > 0) {
    messages.push(`Нет цены у ${params.rowsWithoutPrice} строк`);
  }

  if (params.rowsWithoutUnit > 0) {
    messages.push(`Нет единицы измерения у ${params.rowsWithoutUnit} строк`);
  }

  if (params.unmappedOffersCount > 0) {
    messages.push(`Есть несопоставленные предложения: ${params.unmappedOffersCount}`);
  }

  if (params.lowConfidenceMappingsCount > 0) {
    messages.push(`Есть авто-сопоставления с низкой уверенностью: ${params.lowConfidenceMappingsCount}`);
  }

  return messages.length > 0 ? messages.join(". ") : null;
};

const resolveUsabilityStatus = (status: DocumentQualityStatus): DocumentUsabilityStatus => {
  switch (status) {
    case "good":
      return "usable";
    case "warning":
      return "needs_review";
    case "bad":
    default:
      return "blocked";
  }
};

const buildUsabilityReason = (status: DocumentQualityStatus, warningMessage: string | null) => {
  if (status === "bad") {
    return warningMessage ?? "Качество прайса плохое, не использовать для закупки.";
  }

  if (status === "warning") {
    return warningMessage ?? "Прайс можно использовать только после проверки.";
  }

  return "Качество прайса нормальное, можно использовать для закупки.";
};

const resolveQualityStatus = (params: {
  totalRows: number;
  rowsWithoutPrice: number;
  rowsWithoutUnit: number;
  unmappedOffersCount: number;
  lowConfidenceMappingsCount: number;
}) => {
  const rowsBase = Math.max(params.totalRows, 1);

  if (params.rowsWithoutPrice / rowsBase > BAD_MISSING_PRICE_RATIO) {
    return DocumentQualityStatus.bad;
  }

  if (params.rowsWithoutUnit / rowsBase > BAD_MISSING_UNIT_RATIO) {
    return DocumentQualityStatus.bad;
  }

  if (params.unmappedOffersCount / rowsBase > WARNING_UNMAPPED_RATIO) {
    return DocumentQualityStatus.warning;
  }

  if (params.lowConfidenceMappingsCount > 0) {
    return DocumentQualityStatus.warning;
  }

  return DocumentQualityStatus.good;
};

export const upsertDocumentQualityReport = async (documentId: string) => {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      enterpriseId: true,
      supplierId: true,
      qualityReport: {
        select: {
          manualReviewStatus: true,
          manualReviewComment: true,
          manualReviewedAt: true,
          manualReviewedBy: true,
        },
      },
    },
  });

  if (!document) {
    throw new Error(`Document ${documentId} not found for quality report`);
  }

  const productMetrics = await buildParsedProductMetrics(documentId);
  const currentPriceSnapshotsCount = await prisma.priceSnapshot.count({
    where: { documentId, isCurrent: true },
  });

  const supplierOffers = await prisma.supplierOffer.findMany({
    where: {
      enterpriseId: document.enterpriseId,
      supplierId: document.supplierId,
      priceSnapshots: {
        some: {
          documentId,
        },
      },
    },
    select: {
      id: true,
      priceSnapshots: {
        select: {
          documentId: true,
        },
      },
      mappings: {
        select: {
          id: true,
          status: true,
          matchSource: true,
          confidence: true,
        },
      },
    },
  });

  const newSupplierOffersCount = supplierOffers.filter((offer) =>
    offer.priceSnapshots.every((snapshot) => snapshot.documentId === documentId),
  ).length;
  const unmappedOffersCount = supplierOffers.filter((offer) =>
    offer.mappings.every((mapping) => mapping.status !== "active"),
  ).length;
  const activeMappings = supplierOffers.flatMap((offer) =>
    offer.mappings.filter((mapping) => mapping.status === "active"),
  );
  const autoMappedOffersCount = activeMappings.filter((mapping) => mapping.matchSource !== "manual").length;
  const lowConfidenceMappingsCount = activeMappings.filter(
    (mapping) =>
      mapping.matchSource !== "manual" &&
      Number(mapping.confidence) < LOW_CONFIDENCE_WARNING_THRESHOLD,
  ).length;
  const manualMappedOffersCount = activeMappings.filter((mapping) => mapping.matchSource === "manual").length;

  const qualityStatus = resolveQualityStatus({
    totalRows: productMetrics.totalRows,
    rowsWithoutPrice: productMetrics.rowsWithoutPrice,
    rowsWithoutUnit: productMetrics.rowsWithoutUnit,
    unmappedOffersCount,
    lowConfidenceMappingsCount,
  });

  const warningMessage = buildWarningMessage({
    rowsWithoutPrice: productMetrics.rowsWithoutPrice,
    rowsWithoutUnit: productMetrics.rowsWithoutUnit,
    unmappedOffersCount,
    lowConfidenceMappingsCount,
  });

  const usabilityStatus = resolveUsabilityStatus(qualityStatus);
  const usabilityReason = buildUsabilityReason(qualityStatus, warningMessage);

  return prisma.documentQualityReport.upsert({
    where: { documentId },
    update: {
      totalRows: productMetrics.totalRows,
      parsedProductsCount: productMetrics.parsedProductsCount,
      rowsWithoutPrice: productMetrics.rowsWithoutPrice,
      rowsWithoutUnit: productMetrics.rowsWithoutUnit,
      rowsWithoutName: productMetrics.rowsWithoutName,
      rowsWithoutArticle: productMetrics.rowsWithoutArticle,
      newSupplierOffersCount,
      unmappedOffersCount,
      autoMappedOffersCount,
      lowConfidenceMappingsCount,
      manualMappedOffersCount,
      currentPriceSnapshotsCount,
      qualityStatus,
      warningMessage,
      usabilityStatus,
      usabilityReason,
    },
    create: {
      documentId,
      totalRows: productMetrics.totalRows,
      parsedProductsCount: productMetrics.parsedProductsCount,
      rowsWithoutPrice: productMetrics.rowsWithoutPrice,
      rowsWithoutUnit: productMetrics.rowsWithoutUnit,
      rowsWithoutName: productMetrics.rowsWithoutName,
      rowsWithoutArticle: productMetrics.rowsWithoutArticle,
      newSupplierOffersCount,
      unmappedOffersCount,
      autoMappedOffersCount,
      lowConfidenceMappingsCount,
      manualMappedOffersCount,
      currentPriceSnapshotsCount,
      qualityStatus,
      warningMessage,
      usabilityStatus,
      usabilityReason,
      manualReviewStatus: document.qualityReport?.manualReviewStatus ?? "not_reviewed",
      manualReviewComment: document.qualityReport?.manualReviewComment ?? null,
      manualReviewedAt: document.qualityReport?.manualReviewedAt ?? null,
      manualReviewedBy: document.qualityReport?.manualReviewedBy ?? null,
    },
  });
};

export const buildParsedProductMetrics = async (documentId: string) => {
  const products = await prisma.product.findMany({
    where: { documentId },
    select: {
      id: true,
      name: true,
      article: true,
      price: true,
      unit: true,
    },
  });

  const rowsWithoutPrice = products.filter((product) => product.price === null).length;
  const rowsWithoutUnit = products.filter((product) => !product.unit?.trim()).length;
  const rowsWithoutName = products.filter((product) => !product.name.trim()).length;
  const rowsWithoutArticle = products.filter((product) => !product.article?.trim()).length;

  return {
    totalRows: products.length,
    parsedProductsCount: products.length,
    rowsWithoutPrice,
    rowsWithoutUnit,
    rowsWithoutName,
    rowsWithoutArticle,
  };
};

const formatDecimal = (value: Prisma.Decimal | null | undefined) => (value ? value.toString() : null);

export const listDocumentQualityIssues = async (documentId: string, limit = 50) => {
  const cappedLimit = Math.max(1, Math.min(limit, 50));

  const legacyProductsWithoutPrice = await prisma.product.findMany({
    where: {
      documentId,
      price: null,
    },
    orderBy: {
      sourceRow: "asc",
    },
    take: cappedLimit,
    include: {
      supplier: {
        select: {
          name: true,
        },
      },
      priceSnapshots: {
        where: {
          documentId,
        },
        take: 1,
        include: {
          supplierOffer: {
            include: {
              mappings: {
                where: {
                  status: "active",
                },
                take: 1,
                include: {
                  productMaster: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const withoutPriceIssues = legacyProductsWithoutPrice.map((product) => {
    const activeMapping = product.priceSnapshots[0]?.supplierOffer?.mappings[0] ?? null;

    return {
      type: "without_price" as const,
      label: "Нет цены",
      productId: product.id,
      sourceRow: product.sourceRow,
      name: product.name,
      article: product.article,
      price: null,
      unit: product.unit?.trim() ? product.unit : null,
      confidence: activeMapping ? formatDecimal(activeMapping.confidence) : null,
      catalogProduct: activeMapping?.productMaster ?? null,
      supplierName: product.supplier.name,
      details: "У строки нет цены после импорта.",
    };
  });

  if (withoutPriceIssues.length >= cappedLimit) {
    return withoutPriceIssues;
  }

  const remainingAfterPrice = cappedLimit - withoutPriceIssues.length;

  const legacyProductsWithoutUnit = await prisma.product.findMany({
    where: {
      documentId,
      OR: [{ unit: null }, { unit: "" }],
    },
    orderBy: {
      sourceRow: "asc",
    },
    take: remainingAfterPrice,
    include: {
      supplier: {
        select: {
          name: true,
        },
      },
      priceSnapshots: {
        where: {
          documentId,
        },
        take: 1,
        include: {
          supplierOffer: {
            include: {
              mappings: {
                where: {
                  status: "active",
                },
                take: 1,
                include: {
                  productMaster: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const withoutUnitIssues = legacyProductsWithoutUnit.map((product) => {
    const activeMapping = product.priceSnapshots[0]?.supplierOffer?.mappings[0] ?? null;

    return {
      type: "without_unit" as const,
      label: "Нет единицы",
      productId: product.id,
      sourceRow: product.sourceRow,
      name: product.name,
      article: product.article,
      price: formatDecimal(product.price),
      unit: null,
      confidence: activeMapping ? formatDecimal(activeMapping.confidence) : null,
      catalogProduct: activeMapping?.productMaster ?? null,
      supplierName: product.supplier.name,
      details: "У строки нет единицы измерения.",
    };
  });

  if (withoutPriceIssues.length + withoutUnitIssues.length >= cappedLimit) {
    return [...withoutPriceIssues, ...withoutUnitIssues].slice(0, cappedLimit);
  }

  const remainingAfterUnit = cappedLimit - withoutPriceIssues.length - withoutUnitIssues.length;

  const unmappedOffers = await prisma.supplierOffer.findMany({
    where: {
      priceSnapshots: {
        some: {
          documentId,
        },
      },
      NOT: {
        mappings: {
          some: {
            status: "active",
          },
        },
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: remainingAfterUnit,
    include: {
      supplier: {
        select: {
          name: true,
        },
      },
      unit: {
        select: {
          symbol: true,
        },
      },
      priceSnapshots: {
        where: {
          documentId,
          isCurrent: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
      },
    },
  });

  const unmappedIssues = unmappedOffers.map((offer) => {
    const snapshot = offer.priceSnapshots[0] ?? null;

    return {
      type: "unmapped" as const,
      label: "Нет сопоставления",
      supplierOfferId: offer.id,
      name: offer.name,
      article: offer.article,
      price: formatDecimal(snapshot?.price),
      unit: offer.unit?.symbol ?? offer.legacyUnit ?? null,
      confidence: null,
      catalogProduct: null,
      supplierName: offer.supplier.name,
      details: "Предложение поставщика пока не связано с catalog product.",
    };
  });

  if (withoutPriceIssues.length + withoutUnitIssues.length + unmappedIssues.length >= cappedLimit) {
    return [...withoutPriceIssues, ...withoutUnitIssues, ...unmappedIssues].slice(0, cappedLimit);
  }

  const remainingAfterUnmapped =
    cappedLimit - withoutPriceIssues.length - withoutUnitIssues.length - unmappedIssues.length;

  const lowConfidenceOffers = await prisma.supplierOffer.findMany({
    where: {
      priceSnapshots: {
        some: {
          documentId,
        },
      },
      mappings: {
        some: {
          status: "active",
          matchSource: {
            not: "manual",
          },
          confidence: {
            lt: new Prisma.Decimal(AUTO_MAPPING_THRESHOLD),
          },
        },
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: remainingAfterUnmapped,
    include: {
      supplier: {
        select: {
          name: true,
        },
      },
      unit: {
        select: {
          symbol: true,
        },
      },
      priceSnapshots: {
        where: {
          documentId,
          isCurrent: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
      },
      mappings: {
        where: {
          status: "active",
          matchSource: {
            not: "manual",
          },
          confidence: {
            lt: new Prisma.Decimal(AUTO_MAPPING_THRESHOLD),
          },
        },
        orderBy: {
          confidence: "asc",
        },
        take: 1,
        include: {
          productMaster: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  const lowConfidenceIssues = lowConfidenceOffers.map((offer) => {
    const activeMapping = offer.mappings[0] ?? null;
    const snapshot = offer.priceSnapshots[0] ?? null;

    return {
      type: "low_confidence" as const,
      label: "Низкая уверенность",
      supplierOfferId: offer.id,
      name: offer.name,
      article: offer.article,
      price: formatDecimal(snapshot?.price),
      unit: offer.unit?.symbol ?? offer.legacyUnit ?? null,
      confidence: activeMapping ? formatDecimal(activeMapping.confidence) : null,
      catalogProduct: activeMapping?.productMaster ?? null,
      supplierName: offer.supplier.name,
      details: "Авто-сопоставление найдено, но уверенность низкая.",
    };
  });

  return [...withoutPriceIssues, ...withoutUnitIssues, ...unmappedIssues, ...lowConfidenceIssues].slice(
    0,
    cappedLimit,
  );
};
