import { prisma } from "@/lib/prisma";
import type {
  HomeIconName,
  HomeOverviewAttentionItem,
  HomeOverviewHeroFact,
  HomeOverviewLossRow,
  HomeOverviewPayload,
  HomeOverviewSummaryCard,
  HomeOverviewWorkflowStat,
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

function formatQuantity(value: number, unit: string | null) {
  const formatted = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 3,
  }).format(value);

  return unit ? `${formatted} ${unit}` : formatted;
}

function getMonthRange() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const periodLabel = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
  }).format(now);

  return { monthStart, nextMonthStart, periodLabel };
}

type ComparableProduct = {
  id: string;
  title: string;
  bestPrice: number;
  bestSupplier: string;
  worstPrice: number;
  offersCount: number;
};

type PriceRiseCandidate = {
  productName: string;
  supplierName: string;
  previousPrice: number;
  currentPrice: number;
  delta: number;
  percent: number;
};

function buildToneByLoss(value: number): HomeTone {
  if (value >= 1000) {
    return "danger";
  }

  if (value >= 300) {
    return "warning";
  }

  return "accent";
}

function buildToneByPercent(value: number): HomeTone {
  if (value >= 20) {
    return "danger";
  }

  if (value >= 8) {
    return "warning";
  }

  return "accent";
}

function buildPriceRiseIcon(percent: number): HomeIconName {
  if (percent >= 20) {
    return "triangleAlert";
  }

  return "trendingUp";
}

export async function buildHomeOverview(enterpriseId: string): Promise<HomeOverviewPayload> {
  const { monthStart, nextMonthStart, periodLabel } = getMonthRange();

  const [
    activeSuppliersCount,
    currentDocuments,
    productMasters,
    submittedOrders,
    previousPurchaseItems,
  ] = await Promise.all([
    prisma.supplier.count({
      where: {
        enterpriseId,
        archivedAt: null,
      },
    }),
    prisma.document.findMany({
      where: {
        enterpriseId,
        isCurrent: true,
      },
      select: {
        id: true,
        status: true,
        qualityReport: {
          select: {
            usabilityStatus: true,
            lowConfidenceMappingsCount: true,
            rowsWithoutPrice: true,
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
          },
        },
      },
      select: {
        id: true,
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
                    price: {
                      not: null,
                    },
                  },
                  orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
                  take: 3,
                  select: {
                    id: true,
                    price: true,
                    capturedAt: true,
                    isCurrent: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.order.findMany({
      where: {
        enterpriseId,
        status: "submitted",
        submittedAt: {
          gte: monthStart,
          lt: nextMonthStart,
        },
      },
      orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        supplierId: true,
        supplier: {
          select: {
            name: true,
          },
        },
        items: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            productMasterId: true,
            quantity: true,
            unit: true,
            price: true,
            lineTotal: true,
            productMaster: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    }),
    prisma.orderItem.findMany({
      where: {
        productMasterId: {
          not: null,
        },
        price: {
          not: null,
        },
        order: {
          enterpriseId,
          status: "submitted",
          submittedAt: {
            lt: monthStart,
          },
        },
      },
      orderBy: [{ order: { submittedAt: "desc" } }, { createdAt: "desc" }],
      select: {
        productMasterId: true,
        price: true,
      },
    }),
  ]);

  const comparableProducts = new Map<string, ComparableProduct>();
  const priceRiseCandidates: PriceRiseCandidate[] = [];

  for (const productMaster of productMasters) {
    const currentOffers = productMaster.mappings
      .map((mapping) => {
        const currentSnapshot =
          mapping.supplierOffer.priceSnapshots.find((snapshot) => snapshot.isCurrent) ??
          mapping.supplierOffer.priceSnapshots[0] ??
          null;

        if (!currentSnapshot?.price) {
          return null;
        }

        const previousSnapshot =
          mapping.supplierOffer.priceSnapshots.find((snapshot) => snapshot.id !== currentSnapshot.id) ?? null;

        const currentPrice = Number(currentSnapshot.price);
        const previousPrice = previousSnapshot?.price ? Number(previousSnapshot.price) : null;

        if (previousPrice !== null && currentPrice > previousPrice) {
          const delta = currentPrice - previousPrice;
          const percent = previousPrice > 0 ? (delta / previousPrice) * 100 : 0;

          priceRiseCandidates.push({
            productName: productMaster.name,
            supplierName: mapping.supplierOffer.supplier.name,
            previousPrice,
            currentPrice,
            delta,
            percent,
          });
        }

        return {
          supplierName: mapping.supplierOffer.supplier.name,
          currentPrice,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    if (currentOffers.length < 2) {
      continue;
    }

    const sortedOffers = [...currentOffers].sort((left, right) => left.currentPrice - right.currentPrice);
    const bestOffer = sortedOffers[0];
    const worstOffer = sortedOffers[sortedOffers.length - 1];

    comparableProducts.set(productMaster.id, {
      id: productMaster.id,
      title: productMaster.name,
      bestPrice: bestOffer.currentPrice,
      bestSupplier: bestOffer.supplierName,
      worstPrice: worstOffer.currentPrice,
      offersCount: currentOffers.length,
    });
  }

  const previousPurchaseByProductMaster = new Map<string, number>();

  for (const item of previousPurchaseItems) {
    if (!item.productMasterId || !item.price || previousPurchaseByProductMaster.has(item.productMasterId)) {
      continue;
    }

    previousPurchaseByProductMaster.set(item.productMasterId, Number(item.price));
  }

  let monthlyPurchasesAmount = 0;
  let orderedPositionsCount = 0;
  let bestChoiceCount = 0;
  let notBestChoiceCount = 0;
  let withoutActualPriceCount = 0;
  let realizedSavingsAmount = 0;
  let potentialSavingsAmount = 0;
  const usedSuppliers = new Set<string>();
  const lossRowsRaw: Array<{
    title: string;
    supplier: string;
    purchasePrice: number;
    bestPrice: number;
    quantity: number;
    unit: string | null;
    loss: number;
  }> = [];

  for (const order of submittedOrders) {
    usedSuppliers.add(order.supplierId);

    for (const item of order.items) {
      orderedPositionsCount += 1;
      monthlyPurchasesAmount += Number(item.lineTotal);

      const quantity = Number(item.quantity);
      const price = item.price ? Number(item.price) : null;
      const productMasterId = item.productMasterId;

      if (!price || !productMasterId) {
        withoutActualPriceCount += 1;
        continue;
      }

      const previousPurchasePrice = previousPurchaseByProductMaster.get(productMasterId);

      if (previousPurchasePrice !== undefined && previousPurchasePrice > price) {
        realizedSavingsAmount += (previousPurchasePrice - price) * quantity;
      }

      const comparableProduct = comparableProducts.get(productMasterId);

      if (!comparableProduct) {
        continue;
      }

      const lossPerUnit = price - comparableProduct.bestPrice;

      if (lossPerUnit > 0.009) {
        const lossAmount = lossPerUnit * quantity;
        notBestChoiceCount += 1;
        potentialSavingsAmount += lossAmount;
          lossRowsRaw.push({
            title: item.productMaster?.name ?? comparableProduct.title,
            supplier: order.supplier.name,
            purchasePrice: price,
            bestPrice: comparableProduct.bestPrice,
            quantity,
          unit: item.unit,
          loss: lossAmount,
        });
      } else {
        bestChoiceCount += 1;
      }
    }
  }

  const documentsNeedAttentionCount = currentDocuments.reduce((sum, document) => {
    if (document.status === "parsed_with_errors") {
      return sum + 1;
    }

    if (document.qualityReport?.usabilityStatus === "blocked") {
      return sum + 1;
    }

    if ((document.qualityReport?.lowConfidenceMappingsCount ?? 0) > 0) {
      return sum + 1;
    }

    return sum;
  }, 0);

  const productsWithRiseCount = new Set(priceRiseCandidates.map((item) => item.productName)).size;
  const ordersThisMonthCount = submittedOrders.length;

  const summaryCards: HomeOverviewSummaryCard[] = [
    {
      label: "Закупки за месяц",
      value: formatMoney(monthlyPurchasesAmount),
      detail: ordersThisMonthCount > 0 ? `${formatCount(ordersThisMonthCount)} заказов проведено` : "Пока нет проведённых заказов",
      tone: "accent",
      icon: "receiptText",
    },
    {
      label: "Экономия",
      value: formatMoney(realizedSavingsAmount),
      detail: "Относительно прошлой закупочной цены",
      tone: "success",
      icon: "badgePercent",
    },
    {
      label: "Упущенная экономия",
      value: formatMoney(potentialSavingsAmount),
      detail: "Разница до лучшей текущей цены",
      tone: potentialSavingsAmount > 0 ? "warning" : "neutral",
      icon: "trendingUp",
    },
    {
      label: "Проблемы",
      value: formatCount(documentsNeedAttentionCount + withoutActualPriceCount + notBestChoiceCount),
      detail: "Ошибки, пустые цены и невыгодные покупки",
      tone: documentsNeedAttentionCount + withoutActualPriceCount + notBestChoiceCount > 0 ? "danger" : "success",
      icon: "triangleAlert",
    },
    {
      label: "Рост цен",
      value: formatCount(productsWithRiseCount),
      detail: "Позиции с ростом против прошлого снимка",
      tone: productsWithRiseCount > 0 ? "warning" : "success",
      icon: "trendingUp",
    },
  ];

  const heroFacts: HomeOverviewHeroFact[] = [
    {
      label: "Поставщиков в работе",
      value: formatCount(activeSuppliersCount),
      detail: "Активные поставщики в системе",
    },
    {
      label: "Закуплено позиций",
      value: formatCount(orderedPositionsCount),
      detail: "Строк заказа за текущий месяц",
    },
    {
      label: "Закупки проведены через",
      value: formatCount(usedSuppliers.size),
      detail: "Поставщиков в этом месяце",
    },
  ];

  const workflowStats: HomeOverviewWorkflowStat[] = [
    {
      label: "Заказано",
      value: formatCount(orderedPositionsCount),
      detail: ordersThisMonthCount > 0 ? `${formatCount(ordersThisMonthCount)} заказов за ${periodLabel}` : "Пока без проведённых заказов",
      tone: "accent",
    },
    {
      label: "Выгодно распределено",
      value: formatCount(bestChoiceCount),
      detail: "Купили по лучшей текущей цене",
      tone: "success",
    },
    {
      label: "Купили не по лучшей цене",
      value: formatCount(notBestChoiceCount),
      detail: potentialSavingsAmount > 0 ? `Потеряли ${formatMoney(potentialSavingsAmount)}` : "Пока без потерь",
      tone: notBestChoiceCount > 0 ? "warning" : "success",
    },
    {
      label: "Без актуальной цены",
      value: formatCount(withoutActualPriceCount),
      detail: "Нужно проверить поставщика или сопоставление",
      tone: withoutActualPriceCount > 0 ? "danger" : "success",
    },
  ];

  const lossRows: HomeOverviewLossRow[] = lossRowsRaw
    .sort((left, right) => right.loss - left.loss)
    .slice(0, 5)
    .map((item) => ({
      title: item.title,
      supplier: item.supplier,
      purchasePrice: formatMoney(item.purchasePrice),
      bestPrice: formatMoney(item.bestPrice),
      quantity: formatQuantity(item.quantity, item.unit),
      loss: formatMoney(item.loss),
      tone: buildToneByLoss(item.loss),
    }));

  const attentionItems: HomeOverviewAttentionItem[] = [];

  if (documentsNeedAttentionCount > 0) {
    attentionItems.push({
      title: "Есть прайсы, которые требуют ручной проверки",
      description: "В текущих документах найдены ошибки разбора, блокировки или слабые сопоставления.",
      value: formatCount(documentsNeedAttentionCount),
      tone: "danger",
      icon: "triangleAlert",
    });
  }

  if (withoutActualPriceCount > 0) {
    attentionItems.push({
      title: "Не у всех закупленных позиций есть актуальная цена",
      description: "Часть строк заказа не привязана к актуальному прайсу. Это мешает честно считать выгоду.",
      value: formatCount(withoutActualPriceCount),
      tone: "warning",
      icon: "receiptText",
    });
  }

  if (potentialSavingsAmount > 0) {
    attentionItems.push({
      title: "Есть закупки, где уже видно потерю денег",
      description: "По части позиций купили дороже, чем лучшая текущая цена у другого поставщика.",
      value: formatMoney(potentialSavingsAmount),
      tone: "warning",
      icon: "badgePercent",
    });
  }

  priceRiseCandidates
    .sort((left, right) => right.percent - left.percent)
    .slice(0, 2)
    .forEach((item) => {
      attentionItems.push({
        title: `${item.productName} вырос в цене`,
        description: `${item.supplierName}: было ${formatMoney(item.previousPrice)}, стало ${formatMoney(item.currentPrice)}.`,
        value: `+${Math.round(item.percent)}%`,
        tone: buildToneByPercent(item.percent),
        icon: buildPriceRiseIcon(item.percent),
      });
    });

  if (attentionItems.length === 0) {
    attentionItems.push({
      title: "Критичных сигналов сейчас нет",
      description: "На текущих данных не видно ошибок разбора, пустых цен или заметных потерь.",
      value: "OK",
      tone: "success",
      icon: "badgePercent",
    });
  }

  return {
    periodLabel,
    summaryCards,
    heroFacts,
    workflowStats,
    lossRows,
    attentionItems: attentionItems.slice(0, 5),
  };
}
