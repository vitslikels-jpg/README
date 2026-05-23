import { PrismaClient } from "@prisma/client";
import { BASIC_UNITS } from "../src/lib/catalog-model.shared.js";

const prisma = new PrismaClient();

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  for (const unit of BASIC_UNITS) {
    await prisma.unit.upsert({
      where: { code: unit.code },
      update: {
        name: unit.name,
        symbol: unit.symbol,
        kind: unit.kind,
        baseUnitCode: unit.baseUnitCode,
        multiplier: unit.multiplier,
        aliases: unit.aliases,
      },
      create: {
        code: unit.code,
        name: unit.name,
        symbol: unit.symbol,
        kind: unit.kind,
        baseUnitCode: unit.baseUnitCode,
        multiplier: unit.multiplier,
        aliases: unit.aliases,
      },
    });
  }

  console.log(`Seeded ${BASIC_UNITS.length} base units.`);
}

main()
  .catch((error) => {
    console.error("UNIT_SEED_ERROR", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
