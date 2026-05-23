import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

import { parseRedDragonSheetRows } from "../src/lib/price-parser-red-dragon.mjs";

const fixturePath = path.resolve("scripts/fixtures/red-dragon-price.csv");
const workbook = XLSX.read(fs.readFileSync(fixturePath), {
  type: "buffer",
  cellDates: true,
  raw: false,
  codepage: 65001,
});
const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(firstSheet, {
  header: 1,
  defval: "",
  blankrows: false,
  raw: false,
});

const { products, skippedCount } = await parseRedDragonSheetRows(rows);

if (skippedCount !== 0) {
  throw new Error(`Expected skippedCount=0, got ${skippedCount}`);
}

if (products.length !== 3) {
  throw new Error(`Expected 3 products, got ${products.length}`);
}

if (products[0]?.name !== "Соус Чили Pearl River Bridge 500 г") {
  throw new Error(`Unexpected first product name: ${products[0]?.name ?? "null"}`);
}

if (products[0]?.article !== "RD-001") {
  throw new Error(`Unexpected first article: ${products[0]?.article ?? "null"}`);
}

if (products[0]?.unitsPerPack?.toString() !== "24") {
  throw new Error(`Unexpected first unitsPerPack: ${products[0]?.unitsPerPack?.toString() ?? "null"}`);
}

if (products[0]?.price?.toString() !== "199") {
  throw new Error(`Unexpected first price: ${products[0]?.price?.toString() ?? "null"}`);
}

if (products[1]?.price?.toString() !== "349.5") {
  throw new Error(`Unexpected second price: ${products[1]?.price?.toString() ?? "null"}`);
}

if (products[2]?.rawData?._warningUnitsPerPack !== "true") {
  throw new Error("Expected unitsPerPack warning on third product");
}

if (products[2]?.unitsPerPack !== null) {
  throw new Error(`Expected null unitsPerPack on third product, got ${products[2]?.unitsPerPack?.toString() ?? "null"}`);
}

console.log(
  JSON.stringify(
    products.map((product) => ({
      name: product.name,
      article: product.article,
      unitsPerPack: product.unitsPerPack?.toString() ?? null,
      price: product.price?.toString() ?? null,
      detectedPackaging: product.rawData.detectedPackaging ?? null,
      aiSource: product.rawData.aiSource ?? null,
    })),
    null,
    2,
  ),
);
