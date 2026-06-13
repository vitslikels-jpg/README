import { prisma } from "@/lib/prisma";

type IikoProductFilterStatus = "all" | "mapped" | "unmapped";

function normalizeSearch(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function parsePositiveInt(value: string | null | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

export async function listIikoProducts(params: {
  enterpriseId: string;
  q?: string | null;
  type?: string | null;
  status?: IikoProductFilterStatus | null;
  limit?: string | null;
  offset?: string | null;
}) {
  const search = normalizeSearch(params.q);
  const type = normalizeSearch(params.type);
  const status = params.status ?? "all";
  const limit = Math.min(parsePositiveInt(params.limit, 20) || 20, 100);
  const offset = parsePositiveInt(params.offset, 0);

  const where = {
    enterpriseId: params.enterpriseId,
    ...(type ? { type } : {}),
    ...(status === "mapped"
      ? { productMasterId: { not: null as never } }
      : status === "unmapped"
        ? { productMasterId: null }
        : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { code: { contains: search, mode: "insensitive" as const } },
            { externalId: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.iikoProduct.findMany({
      where,
      include: {
        productMaster: {
          select: {
            id: true,
            name: true,
            brand: true,
            category: true,
            unit: {
              select: {
                id: true,
                code: true,
                name: true,
                symbol: true,
              },
            },
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
      skip: offset,
      take: limit,
    }),
    prisma.iikoProduct.count({ where }),
  ]);

  return {
    items: items.map((item) => ({
      id: item.id,
      externalId: item.externalId,
      name: item.name,
      code: item.code,
      type: item.type,
      mainUnit: item.mainUnit,
      mapped: Boolean(item.productMasterId),
      productMaster: item.productMaster
        ? {
            id: item.productMaster.id,
            name: item.productMaster.name,
            brand: item.productMaster.brand,
            category: item.productMaster.category,
            unit: item.productMaster.unit,
          }
        : null,
    })),
    total,
    limit,
    offset,
  };
}

export async function mapIikoProduct(params: {
  enterpriseId: string;
  iikoProductId: string;
  productMasterId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const iikoProduct = await tx.iikoProduct.findFirst({
      where: {
        id: params.iikoProductId,
        enterpriseId: params.enterpriseId,
      },
      select: {
        id: true,
        enterpriseId: true,
        externalId: true,
        productMasterId: true,
      },
    });

    if (!iikoProduct) {
      throw new Error("IikoProduct не найден.");
    }

    const productMaster = await tx.productMaster.findFirst({
      where: {
        id: params.productMasterId,
        enterpriseId: params.enterpriseId,
      },
      select: {
        id: true,
        enterpriseId: true,
        name: true,
        brand: true,
        category: true,
      },
    });

    if (!productMaster) {
      throw new Error("ProductMaster не найден.");
    }

    if (iikoProduct.productMasterId && iikoProduct.productMasterId !== productMaster.id) {
      await tx.productMapping.updateMany({
        where: {
          enterpriseId: params.enterpriseId,
          productMasterId: iikoProduct.productMasterId,
          iikoProductExternalId: iikoProduct.externalId,
        },
        data: {
          iikoProductExternalId: null,
        },
      });
    }

    await tx.iikoProduct.updateMany({
      where: {
        enterpriseId: params.enterpriseId,
        productMasterId: productMaster.id,
        NOT: {
          id: iikoProduct.id,
        },
      },
      data: {
        productMasterId: null,
      },
    });

    const updatedIikoProduct = await tx.iikoProduct.update({
      where: {
        id: iikoProduct.id,
      },
      data: {
        productMasterId: productMaster.id,
      },
      select: {
        id: true,
        externalId: true,
        name: true,
        code: true,
        type: true,
        mainUnit: true,
      },
    });

    await tx.productMapping.updateMany({
      where: {
        enterpriseId: params.enterpriseId,
        productMasterId: productMaster.id,
        status: "active",
      },
      data: {
        iikoProductExternalId: iikoProduct.externalId,
      },
    });

    return {
      iikoProduct: updatedIikoProduct,
      productMaster,
    };
  });
}

export async function unmapIikoProduct(params: {
  enterpriseId: string;
  iikoProductId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const iikoProduct = await tx.iikoProduct.findFirst({
      where: {
        id: params.iikoProductId,
        enterpriseId: params.enterpriseId,
      },
      select: {
        id: true,
        externalId: true,
        productMasterId: true,
      },
    });

    if (!iikoProduct) {
      throw new Error("IikoProduct не найден.");
    }

    if (iikoProduct.productMasterId) {
      await tx.productMapping.updateMany({
        where: {
          enterpriseId: params.enterpriseId,
          productMasterId: iikoProduct.productMasterId,
          iikoProductExternalId: iikoProduct.externalId,
        },
        data: {
          iikoProductExternalId: null,
        },
      });
    }

    await tx.iikoProduct.update({
      where: {
        id: iikoProduct.id,
      },
      data: {
        productMasterId: null,
      },
    });

    return {
      ok: true,
    };
  });
}
