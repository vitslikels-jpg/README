import { Prisma } from "@prisma/client";
import { jsonUtf8 } from "@/lib/http";
import { ensureEnterpriseExists, ensureScopedSupplier } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type ReportPeriod = "today" | "7d" | "month" | "custom";
type ReportDirection = "all" | "up" | "down";

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();
  const periodRaw = searchParams.get("period")?.trim() ?? "7d";
  const dateFrom = searchParams.get("dateFrom")?.trim() ?? null;
  const dateTo = searchParams.get("dateTo")?.trim() ?? null;
  const supplierId = searchParams.get("supplierId")?.trim() ?? "";
  const query = searchParams.get("q")?.trim() ?? "";
  const directionRaw = searchParams.get("direction")?.trim() ?? "all";

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const period: ReportPeriod = ["today", "7d", "month", "custom"].includes(periodRaw) ? (periodRaw as ReportPeriod) : "7d";
  const direction: ReportDirection = ["all", "up", "down"].includes(directionRaw)
    ? (directionRaw as ReportDirection)
    : "all";

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  if (supplierId) {
    const supplier = await ensureScopedSupplier(enterpriseId, supplierId);

    if (!supplier) {
      return jsonUtf8({ message: "Поставщик не найден в выбранном предприятии." }, { status: 404 });
    }
  }

  const resolvedRange = resolveDateRange(period, dateFrom, dateTo);

  if ("error" in resolvedRange) {
    return jsonUtf8({ message: resolvedRange.error }, { status: 400 });
  }

  const where: Prisma.InvoicePriceChangeWhereInput = {
    invoiceDocument: {
      enterpriseId,
    },
    ...(supplierId ? { supplierId } : {}),
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
              enterpriseId,
              invoiceDate: {
                gte: resolvedRange.start,
                lte: resolvedRange.end,
              },
            },
          },
          {
            invoiceDocument: {
              enterpriseId,
              invoiceDate: null,
            },
            createdAt: {
              gte: resolvedRange.start,
              lte: resolvedRange.end,
            },
          },
        ],
      },
      ...(query
        ? [
            {
              OR: [
                {
                  product: {
                    name: {
                      contains: query,
                      mode: "insensitive",
                    },
                  },
                },
                {
                  invoiceItem: {
                    productNameRaw: {
                      contains: query,
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
          enterpriseId,
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

    return jsonUtf8({
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
    });
  } catch {
    return jsonUtf8({ message: "Не удалось собрать отчет по изменениям цен." }, { status: 500 });
  }
}
