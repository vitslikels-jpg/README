import { PrismaClient } from "@prisma/client";
import { AUTO_MAPPING_THRESHOLD } from "../src/lib/catalog-model.shared.js";
import { syncCatalogForLegacyProducts } from "../src/lib/catalog-sync-core.js";

const prisma = new PrismaClient();

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const products = await prisma.product.findMany({
    include: {
      document: {
        select: {
          id: true,
          isCurrent: true,
          uploadedAt: true,
        },
      },
    },
    orderBy: [{ enterpriseId: "asc" }, { supplierId: "asc" }, { createdAt: "asc" }],
  });
  const result = await syncCatalogForLegacyProducts({
    prisma,
    legacyProducts: products,
    syncSource: "backfill_auto",
  });

  console.log(
    JSON.stringify(
      {
        ...result,
        autoMappingThreshold: AUTO_MAPPING_THRESHOLD,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error("CATALOG_BACKFILL_ERROR", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
