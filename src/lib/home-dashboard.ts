import { prisma } from "@/lib/prisma";
import type {
  HomeIconName,
  HomeOverviewFocusItem,
  HomeOverviewPayload,
  HomeOverviewRecentEvent,
  HomeOverviewSummaryCard,
  HomeTone,
} from "@/features/home/types";

function formatMoney(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCount(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatEventTime(date: Date) {
  const now = new Date();
  const sameDay =
    now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate();

  return sameDay
    ? date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

type ComparisonCandidate = {
  productName: string;
  bestSupplier: string;
  worstSupplier: string;
  bestPrice: number;
  worstPrice: number;
  savingsAmount: number;
  savingsPercent: number;
  capturedAt: Date;
};

function buildComparisonTone(percent: number): HomeTone {
  if (percent >= 20) {
    return "success";
  }

  if (percent >= 8) {
    return "accent";
  }

  return "warning";
}

function buildComparisonIcon(percent: number): HomeIconName {
  if (percent >= 20) {
    return "badgePercent";
  }

  return "trendingUp";
}

export async function buildHomeOverview(enterpriseId: string): Promise<HomeOverviewPayload> {
  const [currentDocumentsCount, currentPricePositionsCount, currentDocuments, productMasters] = await Promise.all([
    prisma.document.count({
      where: {
        enterpriseId,
        isCurrent: true,
      },
    }),
    prisma.priceSnapshot.count({
      where: {
        enterpriseId,
        isCurrent: true,
        price: {
          not: null,
        },
      },
    }),
    prisma.document.findMany({
      where: {
        enterpriseId,
        isCurrent: true,
      },
      orderBy: {
        uploadedAt: "desc",
      },
      take: 8,
      select: {
        id: true,
        originalFileName: true,
        status: true,
        isCurrent: true,
        uploadedAt: true,
        supplier: {
          select: {
            name: true,
          },
        },
        qualityReport: {
          select: {
            qualityStatus: true,
            usabilityStatus: true,
            rowsWithoutPrice: true,
            lowConfidenceMappingsCount: true,
            warningMessage: true,
          },
        },
      },
    }),
    prisma.productMaster.findMany({
      where: {
        enterpriseId,
        mappings: {
          some: {
            status: "active",
            supplierOffer: {
              supplier: {
                archivedAt: null,
              },
              priceSnapshots: {
                some: {
                  isCurrent: true,
                  price: {
                    not: null,
                  },
                },
              },
            },
          },
        },
      },
      select: {
        name: true,
        mappings: {
          where: {
            status: "active",
            supplierOffer: {
              supplier: {
                archivedAt: null,
              },
            },
          },
          select: {
            supplierOffer: {
              select: {
                supplier: {
                  select: {
                    name: true,
                  },
                },
                priceSnapshots: {
                  where: {
                    isCurrent: true,
                    price: {
                      not: null,
                    },
                  },
                  orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
                  take: 1,
                  select: {
                    price: true,
                    capturedAt: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const comparisonCandidates: ComparisonCandidate[] = [];

  for (const productMaster of productMasters) {
    const offers = productMaster.mappings
      .map((mapping) => {
        const snapshot = mapping.supplierOffer.priceSnapshots[0];

        if (snapshot?.price === null || snapshot?.price === undefined) {
          return null;
        }

        return {
          supplierName: mapping.supplierOffer.supplier.name,
          price: Number(snapshot.price),
          capturedAt: snapshot.capturedAt,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    if (offers.length < 2) {
      continue;
    }

    const sortedOffers = [...offers].sort((left, right) => left.price - right.price);
    const bestOffer = sortedOffers[0];
    const worstOffer = sortedOffers[sortedOffers.length - 1];
    const savingsAmount = worstOffer.price - bestOffer.price;

    if (savingsAmount <= 0) {
      continue;
    }

    const savingsPercent = worstOffer.price > 0 ? (savingsAmount / worstOffer.price) * 100 : 0;

    comparisonCandidates.push({
      productName: productMaster.name,
      bestSupplier: bestOffer.supplierName,
      worstSupplier: worstOffer.supplierName,
      bestPrice: bestOffer.price,
      worstPrice: worstOffer.price,
      savingsAmount,
      savingsPercent,
      capturedAt: bestOffer.capturedAt > worstOffer.capturedAt ? bestOffer.capturedAt : worstOffer.capturedAt,
    });
  }

  comparisonCandidates.sort((left, right) => right.savingsAmount - left.savingsAmount);

  const comparableProductsCount = comparisonCandidates.length;
  const topComparison = comparisonCandidates[0] ?? null;

  const summaryCards: HomeOverviewSummaryCard[] = [
    {
      label: "Текущие прайсы",
      value: formatCount(currentDocumentsCount),
      detail: "актуальных файлов",
      tone: "accent",
      icon: "upload",
    },
    {
      label: "Позиции с ценой",
      value: formatCount(currentPricePositionsCount),
      detail: "в текущих прайсах",
      tone: "success",
      icon: "fileSpreadsheet",
    },
    {
      label: "Товаров для сравнения",
      value: formatCount(comparableProductsCount),
      detail: "есть у нескольких поставщиков",
      tone: "violet",
      icon: "package",
    },
    {
      label: "Лучшая разница",
      value: topComparison ? formatMoney(topComparison.savingsAmount) : "—",
      detail: topComparison ? topComparison.productName : "пока нет данных для сравнения",
      tone: "warning",
      icon: "badgePercent",
    },
  ];

  const comparisonFocusItems: HomeOverviewFocusItem[] = comparisonCandidates.slice(0, 3).map((item) => ({
    title: item.productName,
    description: `У ${item.bestSupplier} цена ${formatMoney(item.bestPrice)}, у ${item.worstSupplier} — ${formatMoney(item.worstPrice)}.`,
    badge:
      item.savingsPercent >= 1
        ? `Экономия ${Math.round(item.savingsPercent)}%`
        : `Экономия ${formatMoney(item.savingsAmount)}`,
    href: "/catalog",
    tone: buildComparisonTone(item.savingsPercent),
    icon: buildComparisonIcon(item.savingsPercent),
  }));

  const focusItems = comparisonFocusItems.slice(0, 4);

  const documentEvents: Array<HomeOverviewRecentEvent & { sortDate: Date }> = currentDocuments.slice(0, 5).map((document) => {
    let title = `Загружен прайс ${document.supplier.name}`;
    let tone: HomeTone = "neutral";
    let icon: HomeIconName = "upload";

    if (document.status === "processing") {
      title = `Прайс ${document.supplier.name} сейчас разбирается`;
      tone = "accent";
    } else if (document.status === "parsed_with_errors") {
      title = `Прайс ${document.supplier.name} разобран с предупреждениями`;
      tone = "warning";
      icon = "triangleAlert";
    } else if (document.qualityReport?.usabilityStatus === "blocked") {
      title = `Прайс ${document.supplier.name} требует ручной проверки`;
      tone = "danger";
      icon = "triangleAlert";
    } else if (document.isCurrent) {
      title = `Обновлён текущий прайс ${document.supplier.name}`;
      tone = "success";
      icon = "fileSpreadsheet";
    }

    return {
      title,
      time: formatEventTime(document.uploadedAt),
      tone,
      icon,
      sortDate: document.uploadedAt,
    };
  });

  const comparisonEvents: Array<HomeOverviewRecentEvent & { sortDate: Date }> = comparisonCandidates
    .slice(0, 3)
    .map((item) => ({
      title: `${item.bestSupplier} дешевле ${item.worstSupplier} по «${item.productName}» на ${formatMoney(item.savingsAmount)}`,
      time: formatEventTime(item.capturedAt),
      tone: buildComparisonTone(item.savingsPercent),
      icon: "badgePercent",
      sortDate: item.capturedAt,
    }));

  const recentEvents = [...comparisonEvents, ...documentEvents]
    .sort((left, right) => right.sortDate.getTime() - left.sortDate.getTime())
    .slice(0, 5)
    .map((event) => ({
      title: event.title,
      time: event.time,
      tone: event.tone,
      icon: event.icon,
    }));

  return {
    summaryCards,
    focusItems,
    recentEvents,
  };
}
