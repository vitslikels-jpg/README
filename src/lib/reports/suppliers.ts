import { Prisma } from "@prisma/client";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

export type SuppliersReportPeriod = "today" | "7d" | "month" | "custom";

export type SupplierReportSupplierStat = {
  supplierId: string;
  supplierName: string;
  totalChanges: number;
  increasedCount: number;
  decreasedCount: number;
  averageChangePercent: number | null;
  averageIncreasePercent: number | null;
  averageDecreasePercent: number | null;
  lastChangedAt: string | null;
};

export type SupplierWithoutChangesItem = {
  supplierId: string;
  supplierName: string;
};

export type SuppliersReportResponse = {
  summary: {
    totalSuppliersCount: number;
    activeSuppliersCount: number;
    suppliersWithChangesCount: number;
    averageSupplierChangePercent: number | null;
    mostUnstableSupplier: {
      supplierId: string;
      supplierName: string;
      totalChanges: number;
      averageChangePercent: number | null;
    } | null;
  };
  period: {
    period: SuppliersReportPeriod;
    dateFrom: string;
    dateTo: string;
  };
  charts: {
    changesBySuppliers: Array<{
      supplierId: string;
      supplierName: string;
      totalChanges: number;
    }>;
    directionBySuppliers: Array<{
      supplierId: string;
      supplierName: string;
      increasedCount: number;
      decreasedCount: number;
    }>;
  };
  tables: {
    topByChanges: SupplierReportSupplierStat[];
    topByAverageIncrease: SupplierReportSupplierStat[];
    topByAverageDecrease: SupplierReportSupplierStat[];
    withoutChanges: SupplierWithoutChangesItem[];
    unstable: SupplierReportSupplierStat[];
  };
};

type BuildSuppliersReportParams = {
  enterpriseId: string;
  periodRaw: string;
  dateFrom: string | null;
  dateTo: string | null;
};

type ReportSuccessResult = {
  ok: true;
  data: SuppliersReportResponse;
};

type ReportErrorResult = {
  ok: false;
  status: number;
  message: string;
};

type SupplierAccumulator = {
  supplierId: string;
  supplierName: string;
  totalChanges: number;
  increasedCount: number;
  decreasedCount: number;
  percentValues: number[];
  increaseValues: number[];
  decreaseValues: number[];
  lastChangedAt: string | null;
};

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

function resolveDateRange(period: SuppliersReportPeriod, dateFromRaw: string | null, dateToRaw: string | null) {
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

function average(values: number[]) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function toSupplierStat(item: SupplierAccumulator): SupplierReportSupplierStat {
  return {
    supplierId: item.supplierId,
    supplierName: item.supplierName,
    totalChanges: item.totalChanges,
    increasedCount: item.increasedCount,
    decreasedCount: item.decreasedCount,
    averageChangePercent: average(item.percentValues),
    averageIncreasePercent: average(item.increaseValues),
    averageDecreasePercent: average(item.decreaseValues),
    lastChangedAt: item.lastChangedAt,
  };
}

function compareByChanges(left: SupplierReportSupplierStat, right: SupplierReportSupplierStat) {
  if (right.totalChanges !== left.totalChanges) {
    return right.totalChanges - left.totalChanges;
  }

  const rightAbs = Math.abs(right.averageChangePercent ?? 0);
  const leftAbs = Math.abs(left.averageChangePercent ?? 0);

  if (rightAbs !== leftAbs) {
    return rightAbs - leftAbs;
  }

  return left.supplierName.localeCompare(right.supplierName, "ru");
}

function compareByAverageIncrease(left: SupplierReportSupplierStat, right: SupplierReportSupplierStat) {
  const leftValue = left.averageIncreasePercent ?? -Infinity;
  const rightValue = right.averageIncreasePercent ?? -Infinity;

  if (rightValue !== leftValue) {
    return rightValue - leftValue;
  }

  if (right.increasedCount !== left.increasedCount) {
    return right.increasedCount - left.increasedCount;
  }

  return left.supplierName.localeCompare(right.supplierName, "ru");
}

function compareByAverageDecrease(left: SupplierReportSupplierStat, right: SupplierReportSupplierStat) {
  const leftValue = left.averageDecreasePercent ?? Infinity;
  const rightValue = right.averageDecreasePercent ?? Infinity;

  if (leftValue !== rightValue) {
    return leftValue - rightValue;
  }

  if (right.decreasedCount !== left.decreasedCount) {
    return right.decreasedCount - left.decreasedCount;
  }

  return left.supplierName.localeCompare(right.supplierName, "ru");
}

function compareWithoutChanges(left: SupplierWithoutChangesItem, right: SupplierWithoutChangesItem) {
  return left.supplierName.localeCompare(right.supplierName, "ru");
}

export async function buildSuppliersReport(
  params: BuildSuppliersReportParams,
): Promise<ReportSuccessResult | ReportErrorResult> {
  const period: SuppliersReportPeriod = ["today", "7d", "month", "custom"].includes(params.periodRaw)
    ? (params.periodRaw as SuppliersReportPeriod)
    : "7d";

  const enterprise = await ensureEnterpriseExists(params.enterpriseId);

  if (!enterprise) {
    return {
      ok: false,
      status: 404,
      message: "Предприятие не найдено.",
    };
  }

  const resolvedRange = resolveDateRange(period, params.dateFrom, params.dateTo);

  if ("error" in resolvedRange) {
    return {
      ok: false,
      status: 400,
      message: resolvedRange.error ?? "Некорректный период отчёта.",
    };
  }

  const where: Prisma.InvoicePriceChangeWhereInput = {
    invoiceDocument: {
      enterpriseId: params.enterpriseId,
    },
    supplier: {
      archivedAt: null,
    },
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
    ],
  };

  try {
    const [totalSuppliersCount, activeSuppliers, changes] = await Promise.all([
      prisma.supplier.count({
        where: {
          enterpriseId: params.enterpriseId,
        },
      }),
      prisma.supplier.findMany({
        where: {
          enterpriseId: params.enterpriseId,
          archivedAt: null,
        },
        select: {
          id: true,
          name: true,
        },
        orderBy: {
          name: "asc",
        },
      }),
      prisma.invoicePriceChange.findMany({
        where,
        select: {
          supplierId: true,
          differenceAmount: true,
          differencePercent: true,
          createdAt: true,
          supplier: {
            select: {
              name: true,
            },
          },
          invoiceDocument: {
            select: {
              invoiceDate: true,
            },
          },
        },
      }),
    ]);

    const supplierStatsMap = new Map<string, SupplierAccumulator>();

    for (const change of changes) {
      const current = supplierStatsMap.get(change.supplierId) ?? {
        supplierId: change.supplierId,
        supplierName: change.supplier.name,
        totalChanges: 0,
        increasedCount: 0,
        decreasedCount: 0,
        percentValues: [],
        increaseValues: [],
        decreaseValues: [],
        lastChangedAt: null,
      };
      const differenceAmount = Number(change.differenceAmount?.toString() ?? "0");
      const differencePercent =
        change.differencePercent === null ? null : Number(change.differencePercent.toString());
      const changedAt = (change.invoiceDocument.invoiceDate ?? change.createdAt).toISOString();

      current.totalChanges += 1;

      if (differenceAmount > 0) {
        current.increasedCount += 1;
      } else if (differenceAmount < 0) {
        current.decreasedCount += 1;
      }

      if (differencePercent !== null && Number.isFinite(differencePercent)) {
        current.percentValues.push(differencePercent);

        if (differenceAmount > 0) {
          current.increaseValues.push(differencePercent);
        } else if (differenceAmount < 0) {
          current.decreaseValues.push(differencePercent);
        }
      }

      if (!current.lastChangedAt || new Date(changedAt).getTime() > new Date(current.lastChangedAt).getTime()) {
        current.lastChangedAt = changedAt;
      }

      supplierStatsMap.set(change.supplierId, current);
    }

    const supplierStats = Array.from(supplierStatsMap.values()).map(toSupplierStat);
    const topByChanges = [...supplierStats].sort(compareByChanges).slice(0, 20);
    const topByAverageIncrease = supplierStats
      .filter((item) => item.averageIncreasePercent !== null)
      .sort(compareByAverageIncrease)
      .slice(0, 20);
    const topByAverageDecrease = supplierStats
      .filter((item) => item.averageDecreasePercent !== null)
      .sort(compareByAverageDecrease)
      .slice(0, 20);
    const unstable = [...supplierStats].sort(compareByChanges).slice(0, 20);

    const changedSupplierIds = new Set(supplierStats.map((item) => item.supplierId));
    const withoutChanges = activeSuppliers
      .filter((supplier) => !changedSupplierIds.has(supplier.id))
      .map((supplier) => ({
        supplierId: supplier.id,
        supplierName: supplier.name,
      }))
      .sort(compareWithoutChanges);

    const averageSupplierChangePercent = average(
      supplierStats
        .map((item) => item.averageChangePercent)
        .filter((value): value is number => value !== null && Number.isFinite(value)),
    );

    const mostUnstableSupplier = unstable[0]
      ? {
          supplierId: unstable[0].supplierId,
          supplierName: unstable[0].supplierName,
          totalChanges: unstable[0].totalChanges,
          averageChangePercent: unstable[0].averageChangePercent,
        }
      : null;

    const chartBase = [...supplierStats].sort(compareByChanges).slice(0, 12);

    return {
      ok: true,
      data: {
        summary: {
          totalSuppliersCount,
          activeSuppliersCount: activeSuppliers.length,
          suppliersWithChangesCount: supplierStats.length,
          averageSupplierChangePercent,
          mostUnstableSupplier,
        },
        period: {
          period,
          dateFrom: resolvedRange.start.toISOString(),
          dateTo: resolvedRange.end.toISOString(),
        },
        charts: {
          changesBySuppliers: chartBase.map((item) => ({
            supplierId: item.supplierId,
            supplierName: item.supplierName,
            totalChanges: item.totalChanges,
          })),
          directionBySuppliers: chartBase.map((item) => ({
            supplierId: item.supplierId,
            supplierName: item.supplierName,
            increasedCount: item.increasedCount,
            decreasedCount: item.decreasedCount,
          })),
        },
        tables: {
          topByChanges,
          topByAverageIncrease,
          topByAverageDecrease,
          withoutChanges,
          unstable,
        },
      },
    };
  } catch {
    return {
      ok: false,
      status: 500,
      message: "Не удалось собрать отчёт по поставщикам.",
    };
  }
}
