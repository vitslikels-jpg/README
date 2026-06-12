import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getProducts, getStores, type IikoProductPayload, type IikoStorePayload } from "./iiko-server-client";

export type IikoCatalogSyncResult = {
  storesReceived: number;
  storesCreated: number;
  storesUpdated: number;
  productsReceived: number;
  productsCreated: number;
  productsUpdated: number;
  goodsCount: number;
  errors: string[];
};

export type IikoCatalogSummary = {
  storesCount: number;
  productsCount: number;
  goodsCount: number;
  lastSyncedAt: string | null;
};

function readString(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

function readNestedString(payload: Record<string, unknown>, key: string, nestedKeys: string[]) {
  const value = payload[key];

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return readString(value as Record<string, unknown>, nestedKeys);
  }

  return null;
}

function readMoney(payload: Record<string, unknown>, key: string) {
  const value = payload[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toFixed(2);
  }

  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value).toFixed(2);
  }

  return null;
}

function asJson(payload: Record<string, unknown>) {
  return payload as Prisma.InputJsonValue;
}

function normalizeStore(payload: IikoStorePayload) {
  const externalId = readString(payload, ["id", "externalId", "uuid", "code"]);

  if (!externalId) {
    return null;
  }

  return {
    externalId,
    name: readString(payload, ["name", "description"]),
    code: readString(payload, ["code", "num"]),
    rawData: asJson(payload),
  };
}

function normalizeProduct(payload: IikoProductPayload) {
  const externalId = readString(payload, ["id", "externalId", "uuid"]);

  if (!externalId) {
    return null;
  }

  return {
    externalId,
    name: readString(payload, ["name"]),
    code: readString(payload, ["num", "code"]),
    type: readString(payload, ["type"]),
    mainUnit: readNestedString(payload, "mainUnit", ["name", "code", "id"]),
    parentId: readNestedString(payload, "parent", ["id"]),
    parentName: readNestedString(payload, "parent", ["name"]),
    estimatedPurchasePrice: readMoney(payload, "estimatedPurchasePrice"),
    defaultSalePrice: readMoney(payload, "defaultSalePrice"),
    rawData: asJson(payload),
  };
}

export async function syncIikoCatalog(enterpriseId: string): Promise<IikoCatalogSyncResult> {
  const enterprise = await prisma.enterprise.findUnique({
    where: {
      id: enterpriseId,
    },
    select: {
      id: true,
    },
  });

  if (!enterprise) {
    throw new Error("Предприятие не найдено.");
  }

  const syncedAt = new Date();
  const errors: string[] = [];
  const stores = await getStores();
  const products = await getProducts();
  let storesCreated = 0;
  let storesUpdated = 0;
  let productsCreated = 0;
  let productsUpdated = 0;
  let goodsCount = 0;

  for (const storePayload of stores) {
    const store = normalizeStore(storePayload);

    if (!store) {
      errors.push("iiko вернул склад без внешнего id, запись пропущена.");
      continue;
    }

    const existingStore = await prisma.iikoStore.findUnique({
      where: {
        enterpriseId_externalId: {
          enterpriseId,
          externalId: store.externalId,
        },
      },
      select: {
        id: true,
      },
    });

    await prisma.iikoStore.upsert({
      where: {
        enterpriseId_externalId: {
          enterpriseId,
          externalId: store.externalId,
        },
      },
      create: {
        enterpriseId,
        ...store,
        lastSyncedAt: syncedAt,
      },
      update: {
        name: store.name,
        code: store.code,
        rawData: store.rawData,
        lastSyncedAt: syncedAt,
      },
    });

    if (existingStore) {
      storesUpdated += 1;
    } else {
      storesCreated += 1;
    }
  }

  for (const productPayload of products) {
    const product = normalizeProduct(productPayload);

    if (!product) {
      errors.push("iiko вернул товар без внешнего id, запись пропущена.");
      continue;
    }

    if (product.type === "GOODS") {
      goodsCount += 1;
    }

    const existingProduct = await prisma.iikoProduct.findUnique({
      where: {
        enterpriseId_externalId: {
          enterpriseId,
          externalId: product.externalId,
        },
      },
      select: {
        id: true,
      },
    });

    await prisma.iikoProduct.upsert({
      where: {
        enterpriseId_externalId: {
          enterpriseId,
          externalId: product.externalId,
        },
      },
      create: {
        enterpriseId,
        ...product,
        lastSyncedAt: syncedAt,
      },
      update: {
        name: product.name,
        code: product.code,
        type: product.type,
        mainUnit: product.mainUnit,
        parentId: product.parentId,
        parentName: product.parentName,
        estimatedPurchasePrice: product.estimatedPurchasePrice,
        defaultSalePrice: product.defaultSalePrice,
        rawData: product.rawData,
        lastSyncedAt: syncedAt,
      },
    });

    if (existingProduct) {
      productsUpdated += 1;
    } else {
      productsCreated += 1;
    }
  }

  return {
    storesReceived: stores.length,
    storesCreated,
    storesUpdated,
    productsReceived: products.length,
    productsCreated,
    productsUpdated,
    goodsCount,
    errors,
  };
}

export async function getIikoCatalogSummary(enterpriseId: string): Promise<IikoCatalogSummary> {
  const [storesCount, productsCount, goodsCount, latestStore, latestProduct] = await Promise.all([
    prisma.iikoStore.count({
      where: {
        enterpriseId,
      },
    }),
    prisma.iikoProduct.count({
      where: {
        enterpriseId,
      },
    }),
    prisma.iikoProduct.count({
      where: {
        enterpriseId,
        type: "GOODS",
      },
    }),
    prisma.iikoStore.findFirst({
      where: {
        enterpriseId,
      },
      orderBy: {
        lastSyncedAt: "desc",
      },
      select: {
        lastSyncedAt: true,
      },
    }),
    prisma.iikoProduct.findFirst({
      where: {
        enterpriseId,
      },
      orderBy: {
        lastSyncedAt: "desc",
      },
      select: {
        lastSyncedAt: true,
      },
    }),
  ]);

  const lastSyncedAt = [latestStore?.lastSyncedAt, latestProduct?.lastSyncedAt]
    .filter((value): value is Date => Boolean(value))
    .sort((left, right) => right.getTime() - left.getTime())[0];

  return {
    storesCount,
    productsCount,
    goodsCount,
    lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
  };
}
