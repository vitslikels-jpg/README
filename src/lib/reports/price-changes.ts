import { Prisma } from "@prisma/client";
import { ensureEnterpriseExists, ensureScopedSupplier } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

export type ReportPeriod = "today" | "7d" | "month" | "custom";
export type ReportDirection = "all" | "up" | "down";
export type PriceChangeStatus = "confirmed" | "requires_review";
export type PriceChangeSource = "invoice";

export type PriceChangeReportItem = {
  id: string;
  changedAt: string;
  supplierId: string;
  supplierName: string;
  productId: string;
  productName: string;
  productNameRaw: string;
  oldPrice: string | null;
  newPrice: string;
  differenceAmount: string | null;
  differencePercent: string | null;
  potentialImpactAmount: string | null;
  quantity: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  source: PriceChangeSource;
  status: PriceChangeStatus;
};

export type PriceChangeChartItem = {
  key: string;
  label: string;
  increased: number;
  decreased: number;
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

export type PriceChangeSupplierStat = {
  supplierId: string;
  supplierName: string;
  totalChanges: number;
  increasedCount: number;
  decreasedCount: number;
  averageChangePercent: number | null;
  lastChangedAt: string | null;
};

export type PriceChangesReportResponse = {
  summary: {
    totalChanges: number;
    increasedCount: number;
    decreasedCount: number;
    averageChangePercent: number | null;
    potentialImpactAmount: string | null;
    hasPotentialImpactData: boolean;
    maxIncreasePercent: number | null;
    maxDecreasePercent: number | null;
    mostUnstableSupplier: {
      supplierId: string;
      supplierName: string;
      totalChanges: number;
    } | null;
    uniqueProductsCount: number;
  };
  suppliers: Array<{
    id: string;
    name: string;
  }>;
  chart: PriceChangeChartItem[];
  topIncreases: TopPriceChangeItem[];
  topDecreases: TopPriceChangeItem[];
  supplierStats: PriceChangeSupplierStat[];
  items: PriceChangeReportItem[];
};

type BuildPriceChangesReportParams = {
  enterpriseId: string;
  periodRaw: string;
  dateFrom: string | null;
  dateTo: string | null;
  supplierId: string;
  query: string;
  directionRaw: string;
};

type ReportSuccessResult = {
  ok: true;
  data: PriceChangesReportResponse;
};

type ReportErrorResult = {
  ok: false;
  status: number;
  message: string;
};

const ZERO = new Prisma.Decimal(0);

function parseDateBoundary(value: string, boundary: "start" | "end") {
  const parsed = new Date(`${value}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (boundary === "start") {
    parsed.setHours(0, 0, 0, 0);
  } else {
    parsed.setHours(23, 59, 59, 999);
  }

  return parsed;
}

function resolveDateRange(period: ReportPeriod, dateFromRaw: string | null, dateToRaw: string | null) {
  const now = new Date();

  if (period === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  if (period === "7d") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 6);

    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    start.setHours(0, 0, 0, 0);

    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  if (!dateFromRaw || !dateToRaw) {
    return { error: "Для произвольного периода нужны dateFrom и dateTo." } as const;
  }

  const start = parseDateBoundary(dateFromRaw, "start");
  const end = parseDateBoundary(dateToRaw, "end");

  if (!start || !end) {
    return { error: "Дата периода указана некорректно." } as const;
  }

  if (start > end) {
    return { error: "Дата начала не может быть позже даты окончания." } as const;
  }

  return { start, end };
}

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

export async function buildPriceChangesReport(
  params: BuildPriceChangesReportParams,
): Promise<ReportSuccessResult | ReportErrorResult> {
  const period: ReportPeriod = ["today", "7d", "month", "custom"].includes(params.periodRaw)
    ? (params.periodRaw as ReportPeriod)
    : "7d";
  const direction: ReportDirection = ["all", "up", "down"].includes(params.directionRaw)
    ? (params.directionRaw as ReportDirection)
    : "all";

  const enterprise = await ensureEnterpriseExists(params.enterpriseId);

  if (!enterprise) {
    return {
      ok: false,
      status: 404,
      message: "Предприятие не найдено.",
    };
  }

  if (params.supplierId) {
    const supplier = await ensureScopedSupplier(params.enterpriseId, params.supplierId);

    if (!supplier) {
      return {
        ok: false,
        status: 404,
        message: "Поставщик не найден в выбранном предприятии.",
      };
    }
  }

  const resolvedRange = resolveDateRange(period, params.dateFrom, params.dateTo);

  if ("error" in resolvedRange) {
    return {
      ok: false,
      status: 400,
      message: resolvedRange.error ?? "Некорректный период отчета.",
    };
  }

  const where: Prisma.InvoicePriceChangeWhereInput = {
    invoiceDocument: {
      enterpriseId: params.enterpriseId,
    },
    ...(params.supplierId ? { supplierId: params.supplierId } : {}),
    ...(direction === "up"
      ? {
          differenceAmount: {
            gt: ZERO,
          },
        }
      : {}),
    ...(direction === "down"
      ? {
          differenceAmount: {
            lt: ZERO,
          },
        }
      : {}),
    AND: [
      {
        OR: [
          {
            invoiceDocument: {
              enterpriseId: params.enterpriseId,
              invoiceDate: {
                gte: resolvedRange.start,
                lte: resolvedRange.end,
              },
            },
          },
          {
            invoiceDocument: {
              enterpriseId: params.enterpriseId,
              invoiceDate: null,
            },
            createdAt: {
              gte: resolvedRange.start,
              lte: resolvedRange.end,
            },
          },
        ],
      },
      ...(params.query
        ? [
            {
              OR: [
                {
                  product: {
                    name: {
                      contains: params.query,
                      mode: "insensitive",
                    },
                  },
                },
                {
                  invoiceItem: {
                    productNameRaw: {
                      contains: params.query,
                      mode: "insensitive",
                    },
                  },
                },
              ],
            } satisfies Prisma.InvoicePriceChangeWhereInput,
          ]
        : []),
    ],
  };

  try {
    const [changes, suppliers] = await Promise.all([
      prisma.invoicePriceChange.findMany({
        where,
        include: {
          supplier: {
            select: {
              id: true,
              name: true,
            },
          },
          product: {
            select: {
              id: true,
              name: true,
            },
          },
          invoiceItem: {
            select: {
              productNameRaw: true,
              quantity: true,
            },
          },
          invoiceDocument: {
            select: {
              invoiceNumber: true,
              invoiceDate: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      }),
      prisma.supplier.findMany({
        where: {
          enterpriseId: params.enterpriseId,
          archivedAt: null,
          invoicePriceChanges: {
            some: {},
          },
        },
        select: {
          id: true,
          name: true,
        },
        orderBy: {
          name: "asc",
        },
      }),
    ]);

    const items = changes
      .map((change) => {
        const potentialImpactAmount =
          change.differenceAmount && change.invoiceItem.quantity
            ? change.differenceAmount.mul(change.invoiceItem.quantity).toDecimalPlaces(2)
            : null;

        return {
          id: change.id,
          changedAt: (change.invoiceDocument.invoiceDate ?? change.createdAt).toISOString(),
          supplierId: change.supplierId,
          supplierName: change.supplier.name,
          productId: change.productId,
          productName: change.product.name,
          productNameRaw: change.invoiceItem.productNameRaw,
          oldPrice: change.oldPrice?.toString() ?? null,
          newPrice: change.newPrice.toString(),
          differenceAmount: change.differenceAmount?.toString() ?? null,
          differencePercent: change.differencePercent?.toString() ?? null,
          potentialImpactAmount: potentialImpactAmount?.toString() ?? null,
          quantity: change.invoiceItem.quantity?.toString() ?? null,
          invoiceNumber: change.invoiceDocument.invoiceNumber?.trim() || null,
          invoiceDate: change.invoiceDocument.invoiceDate?.toISOString() ?? null,
          source: "invoice" as const,
          status: change.status === "approved" ? ("confirmed" as const) : ("requires_review" as const),
        };
      })
      .sort((left, right) => new Date(right.changedAt).getTime() - new Date(left.changedAt).getTime());

    const percentValues = items
      .map((item) => (item.differencePercent === null ? null : Number(item.differencePercent)))
      .filter((value): value is number => Number.isFinite(value));

    const impactValues = items
      .map((item) => (item.potentialImpactAmount === null ? null : new Prisma.Decimal(item.potentialImpactAmount)))
      .filter((value): value is Prisma.Decimal => value !== null);

    const averageChangePercent =
      percentValues.length > 0 ? percentValues.reduce((sum, value) => sum + value, 0) / percentValues.length : null;

    const potentialImpactAmount =
      impactValues.length > 0 ? impactValues.reduce((sum, value) => sum.plus(value), ZERO).toDecimalPlaces(2) : null;

    const chartMap = new Map<string, PriceChangeChartItem>();

    for (const item of items) {
      const date = new Date(item.changedAt);

      if (Number.isNaN(date.getTime())) {
        continue;
      }

      const key = date.toISOString().slice(0, 10);
      const current = chartMap.get(key) ?? {
        key,
        label: new Intl.DateTimeFormat("ru-RU", {
          day: "2-digit",
          month: "2-digit",
        }).format(date),
        increased: 0,
        decreased: 0,
      };
      const differenceAmount = Number(item.differenceAmount ?? "0");

      if (differenceAmount > 0) {
        current.increased += 1;
      } else if (differenceAmount < 0) {
        current.decreased += 1;
      }

      chartMap.set(key, current);
    }

    const chart = Array.from(chartMap.values()).sort((left, right) => left.key.localeCompare(right.key));

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

    const supplierStats: PriceChangeSupplierStat[] = Array.from(supplierStatsMap.values())
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
      topIncreases.length > 0
        ? Number(
            topIncreases.reduce((maxItem, item) =>
              Number(item.differencePercent ?? "0") > Number(maxItem.differencePercent ?? "0") ? item : maxItem,
            ).differencePercent,
          )
        : null;
    const maxDecreasePercent =
      topDecreases.length > 0
        ? Number(
            topDecreases.reduce((minItem, item) =>
              Number(item.differencePercent ?? "0") < Number(minItem.differencePercent ?? "0") ? item : minItem,
            ).differencePercent,
          )
        : null;

    return {
      ok: true,
      data: {
        summary: {
          totalChanges: items.length,
          increasedCount: items.filter((item) => Number(item.differenceAmount ?? "0") > 0).length,
          decreasedCount: items.filter((item) => Number(item.differenceAmount ?? "0") < 0).length,
          averageChangePercent,
          potentialImpactAmount: potentialImpactAmount?.toString() ?? null,
          hasPotentialImpactData: impactValues.length > 0,
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
          uniqueProductsCount: new Set(items.map((item) => item.productId)).size,
        },
        suppliers,
        chart,
        topIncreases,
        topDecreases,
        supplierStats,
        items,
      },
    };
  } catch {
    return {
      ok: false,
      status: 500,
      message: "Не удалось собрать отчет по изменениям цен.",
    };
  }
}
