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

rows.push(
  ["Жевательные конфеты Alpenliebe 2 Chew с клубничной начинкой, 32 г", "10942OZ", "", "", "24", "119", ""],
  ['Взрывная карамель со вкусом колы "Pokemon" ICD, 15 г', "12236КД", "", "", "30", "45", ""],
  ['Жевательный мармелад со вкусом винограда "Kuromi" SEOJU, 43 г', "12266КД", "", "", "20", "139", ""],
  ["Напиток безалкогольный виноградный, 350 мл, SUNTORY", "13952", "", "", "24", "169", ""],
);

const { products, skippedCount } = await parseRedDragonSheetRows(rows);

if (skippedCount !== 0) {
  throw new Error(`Expected skippedCount=0, got ${skippedCount}`);
}

if (products.length !== 7) {
  throw new Error(`Expected 7 products, got ${products.length}`);
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

const productsByArticle = new Map(products.map((product) => [product.article, product]));

if (productsByArticle.get("10942OZ")?.brand !== "Alpenliebe 2 Chew") {
  throw new Error(`Unexpected brand for 10942OZ: ${productsByArticle.get("10942OZ")?.brand ?? "null"}`);
}

if (productsByArticle.get("12236КД")?.brand !== "ICD") {
  throw new Error(`Unexpected brand for 12236КД: ${productsByArticle.get("12236КД")?.brand ?? "null"}`);
}

if (productsByArticle.get("12266КД")?.brand !== "SEOJU") {
  throw new Error(`Unexpected brand for 12266КД: ${productsByArticle.get("12266КД")?.brand ?? "null"}`);
}

if (productsByArticle.get("12266КД")?.country !== "ЮЖНАЯ КОРЕЯ") {
  throw new Error(`Unexpected country for 12266КД: ${productsByArticle.get("12266КД")?.country ?? "null"}`);
}

if (productsByArticle.get("13952")?.brand !== "SUNTORY") {
  throw new Error(`Unexpected brand for 13952: ${productsByArticle.get("13952")?.brand ?? "null"}`);
}

if (productsByArticle.get("13952")?.country !== "ЯПОНИЯ") {
  throw new Error(`Unexpected country for 13952: ${productsByArticle.get("13952")?.country ?? "null"}`);
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
