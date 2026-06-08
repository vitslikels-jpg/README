import { buildPriceChangesReport, type PriceChangeReportItem } from "@/lib/reports/price-changes";

type SupplierOption = {
  id: string;
  name: string;
};

type BuildTopPriceChangesReportParams = {
  enterpriseId: string;
  periodRaw: string;
  dateFrom: string | null;
  dateTo: string | null;
  supplierId: string;
  query: string;
};

export type TopPriceChangeItem = {
  id: string;
  productId: string;
  productName: string;
  supplierId: string;
  supplierName: string;
  oldPrice: string | null;
  newPrice: string;
  differenceAmount: string | null;
  differencePercent: string | null;
  changedAt: string;
};

export type TopPriceChangeSupplierStat = {
  supplierId: string;
  supplierName: string;
  totalChanges: number;
  increasedCount: number;
  decreasedCount: number;
  averageChangePercent: number | null;
  lastChangedAt: string | null;
};

export type TopPriceChangesReportResponse = {
  summary: {
    maxIncreasePercent: number | null;
    maxDecreasePercent: number | null;
    mostUnstableSupplier: {
      supplierId: string;
      supplierName: string;
      totalChanges: number;
    } | null;
    totalChanges: number;
    uniqueProductsCount: number;
  };
  suppliers: SupplierOption[];
  topIncreases: TopPriceChangeItem[];
  topDecreases: TopPriceChangeItem[];
  supplierStats: TopPriceChangeSupplierStat[];
};

type ReportSuccessResult = {
  ok: true;
  data: TopPriceChangesReportResponse;
};

type ReportErrorResult = {
  ok: false;
  status: number;
  message: string;
};

function toTopItem(item: PriceChangeReportItem): TopPriceChangeItem {
  return {
    id: item.id,
    productId: item.productId,
    productName: item.productName,
    supplierId: item.supplierId,
    supplierName: item.supplierName,
    oldPrice: item.oldPrice,
    newPrice: item.newPrice,
    differenceAmount: item.differenceAmount,
    differencePercent: item.differencePercent,
    changedAt: item.changedAt,
  };
}

export async function buildTopPriceChangesReport(
  params: BuildTopPriceChangesReportParams,
): Promise<ReportSuccessResult | ReportErrorResult> {
  const baseReport = await buildPriceChangesReport({
    ...params,
    directionRaw: "all",
  });

  if (!baseReport.ok) {
    return baseReport;
  }

  const items = baseReport.data.items;
  const itemsWithPercent = items.filter(
    (item): item is PriceChangeReportItem & { differencePercent: string } =>
      item.differencePercent !== null && Number.isFinite(Number(item.differencePercent)),
  );

  const topIncreases = itemsWithPercent
    .filter((item) => Number(item.differencePercent) > 0)
    .sort((left, right) => Number(right.differencePercent) - Number(left.differencePercent))
    .slice(0, 20)
    .map(toTopItem);

  const topDecreases = itemsWithPercent
    .filter((item) => Number(item.differencePercent) < 0)
    .sort((left, right) => Number(left.differencePercent) - Number(right.differencePercent))
    .slice(0, 20)
    .map(toTopItem);

  const supplierStatsMap = new Map<
    string,
    {
      supplierId: string;
      supplierName: string;
      totalChanges: number;
      increasedCount: number;
      decreasedCount: number;
      percentValues: number[];
      lastChangedAt: string | null;
    }
  >();

  for (const item of items) {
    const current = supplierStatsMap.get(item.supplierId) ?? {
      supplierId: item.supplierId,
      supplierName: item.supplierName,
      totalChanges: 0,
      increasedCount: 0,
      decreasedCount: 0,
      percentValues: [],
      lastChangedAt: null,
    };
    const differenceAmount = Number(item.differenceAmount ?? "0");
    const differencePercent = item.differencePercent === null ? null : Number(item.differencePercent);

    current.totalChanges += 1;

    if (differenceAmount > 0) {
      current.increasedCount += 1;
    } else if (differenceAmount < 0) {
      current.decreasedCount += 1;
    }

    if (differencePercent !== null && Number.isFinite(differencePercent)) {
      current.percentValues.push(differencePercent);
    }

    if (!current.lastChangedAt || new Date(item.changedAt).getTime() > new Date(current.lastChangedAt).getTime()) {
      current.lastChangedAt = item.changedAt;
    }

    supplierStatsMap.set(item.supplierId, current);
  }

  const supplierStats: TopPriceChangeSupplierStat[] = Array.from(supplierStatsMap.values())
    .map((item) => ({
      supplierId: item.supplierId,
      supplierName: item.supplierName,
      totalChanges: item.totalChanges,
      increasedCount: item.increasedCount,
      decreasedCount: item.decreasedCount,
      averageChangePercent:
        item.percentValues.length > 0
          ? item.percentValues.reduce((sum, value) => sum + value, 0) / item.percentValues.length
          : null,
      lastChangedAt: item.lastChangedAt,
    }))
    .sort((left, right) => {
      if (right.totalChanges !== left.totalChanges) {
        return right.totalChanges - left.totalChanges;
      }

      return new Date(right.lastChangedAt ?? 0).getTime() - new Date(left.lastChangedAt ?? 0).getTime();
    });

  const maxIncreasePercent =
    topIncreases.length > 0 ? Number(topIncreases.reduce((max, item) => (Number(item.differencePercent) > Number(max.differencePercent) ? item : max)).differencePercent) : null;
  const maxDecreasePercent =
    topDecreases.length > 0 ? Number(topDecreases.reduce((min, item) => (Number(item.differencePercent) < Number(min.differencePercent) ? item : min)).differencePercent) : null;

  return {
    ok: true,
    data: {
      summary: {
        maxIncreasePercent,
        maxDecreasePercent,
        mostUnstableSupplier:
          supplierStats.length > 0
            ? {
                supplierId: supplierStats[0].supplierId,
                supplierName: supplierStats[0].supplierName,
                totalChanges: supplierStats[0].totalChanges,
              }
            : null,
        totalChanges: items.length,
        uniqueProductsCount: new Set(items.map((item) => item.productId)).size,
      },
      suppliers: baseReport.data.suppliers,
      topIncreases,
      topDecreases,
      supplierStats,
    },
  };
}
