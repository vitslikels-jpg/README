import { parseMeridianSheetRows } from "../src/lib/price-parser-meridian.mjs";

const rows = [
  ["", "Артикул", "НоменклатураПредставление", "ПРАЙС - ЛИСТ", "", "Бренд", "Страна", "Шт в коробке", "Мин квант", "Под заказ", "Отгружать по коробкам"],
  ["", "", "", "Цена", "Ед.", "", "", "", "", "", ""],
  ["", "903736", "ГРИБЫ ассорти обжаренные 800 г * 6 шт ROBO Италия", "872.22 руб.", "шт", "ROBO", "Италия", "6", "1", "", ""],
  ["", "906153", "АРТИШОКИ в подсолнечном масле по-римски 1,9/1,2 кг * 2 шт ITALCARCIOFI Италия", "1,317.12 руб.", "шт", "ITALCARCIOFI", "Италия", "2", "1", "", ""],
  ["", "900113", "Артишоки ITALCARCIOFI в подсолнечном масле целые по-крестьянски, 530 г / 300 г * 12 шт", "451.78 руб.", "шт", "ITALCARCIOFI", "Италия", "12", "1", "", ""],
  ["", "900101", "АГАР-АГАР порошок 500 г * 10 шт VAL'DE Россия", "1,856.81 руб.", "шт", "VAL'DE", "РОССИЯ", "10", "1", "", ""],
];

const { products, skippedCount } = await parseMeridianSheetRows(rows);

if (skippedCount !== 0) {
  throw new Error(`Expected skippedCount=0, got ${skippedCount}`);
}

if (products.length !== 4) {
  throw new Error(`Expected 4 products, got ${products.length}`);
}

const byArticle = new Map(products.map((product) => [product.article, product]));

if (byArticle.get("903736")?.unitsPerPack?.toString() !== "6") {
  throw new Error(`Unexpected unitsPerPack for 903736: ${byArticle.get("903736")?.unitsPerPack?.toString() ?? "null"}`);
}

if (byArticle.get("903736")?.name !== "ГРИБЫ ассорти обжаренные 800 г") {
  throw new Error(`Unexpected name for 903736: ${byArticle.get("903736")?.name ?? "null"}`);
}

if (byArticle.get("906153")?.name !== "АРТИШОКИ в подсолнечном масле по-римски 1,9/1,2 кг") {
  throw new Error(`Unexpected name for 906153: ${byArticle.get("906153")?.name ?? "null"}`);
}

if (byArticle.get("900113")?.name !== "Артишоки в подсолнечном масле целые по-крестьянски, 530 г / 300 г") {
  throw new Error(`Unexpected name for 900113: ${byArticle.get("900113")?.name ?? "null"}`);
}

if (byArticle.get("900101")?.country !== "Россия") {
  throw new Error(`Unexpected country for 900101: ${byArticle.get("900101")?.country ?? "null"}`);
}

console.log(
  JSON.stringify(
    products.map((product) => ({
      article: product.article,
      name: product.name,
      brand: product.brand,
      country: product.country,
      unitsPerPack: product.unitsPerPack?.toString() ?? null,
      price: product.price?.toString() ?? null,
    })),
    null,
    2,
  ),
);
