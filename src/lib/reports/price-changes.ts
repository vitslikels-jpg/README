import { Prisma } from "@prisma/client";
import { ensureEnterpriseExists, ensureScopedSupplier } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

export type ReportPeriod = "today" | "7d" | "month" | "custom";
export type ReportDirection = "all" | "up" | "down";

type PriceChangeStatus = "confirmed" | "requires_review";
type PriceChangeSource = "invoice";

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

export type PriceChangesReportResponse = {
  summary: {
    totalChanges: number;
    increasedCount: number;
    decreasedCount: number;
    averageChangePercent: number | null;
    potentialImpactAmount: string | null;
    hasPotentialImpactData: boolean;
  };
  suppliers: Array<{
    id: string;
    name: string;
  }>;
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
      message: resolvedRange.error ?? "Некорректный период отчёта.",
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
        },
        suppliers,
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
