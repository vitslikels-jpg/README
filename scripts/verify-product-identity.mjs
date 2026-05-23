import { refineParsedProductIdentity } from "../src/lib/product-identity-refiner.mjs";

const cases = [
  {
    rawName: "Арахис жаренный с сычуанским перцем Yuxianshen, 90 г",
    rawCountry: "КИТАЙ",
    expectedBrand: "Yuxianshen",
    expectedCountry: "КИТАЙ",
  },
  {
    rawName: "Кокосовые сливки Kara, ж/б 400 мл",
    rawCountry: "ИНДОНЕЗИЯ",
    expectedBrand: "Kara",
    expectedCountry: "ИНДОНЕЗИЯ",
  },
  {
    rawName: "Кокосовые чипсы KING ISLAND, 40 гр",
    rawCountry: "ТАИЛАНД",
    expectedBrand: "KING ISLAND",
    expectedCountry: "ТАИЛАНД",
  },
  {
    rawName: "Лапша б/п Nongshim Toomba с острым сырно-сливочным вкусом, 137 г",
    rawCountry: "ЮЖНАЯ КОРЕЯ",
    expectedBrand: "Nongshim Toomba",
    expectedCountry: "ЮЖНАЯ КОРЕЯ",
  },
  {
    rawName: "Лента жевательная кислая со вкусом яблока Yaokin Inc., 15 гр",
    rawCountry: "Япония",
    expectedBrand: "Yaokin Inc.",
    expectedCountry: "ЯПОНИЯ",
  },
  {
    rawName: "Мисо-суп с водорослями вакамэ, 12 порций, 216 - 240 гр, Япония",
    rawBrand: "Марукомэ",
    expectedBrand: "Марукомэ",
    expectedCountry: "ЯПОНИЯ",
  },
  {
    rawName: "Напиток Arizona со вкусом питахайи и манго, 650мл",
    rawCountry: "США",
    expectedBrand: "Arizona",
    expectedCountry: "США",
  },
  {
    rawName: "Кокосовые сливки Kati, 1 л",
    rawCountry: "ВЬЕТНАМ",
    expectedBrand: "Kati",
    expectedCountry: "ВЬЕТНАМ",
  },
];

const outputs = [];

for (const item of cases) {
  const result = await refineParsedProductIdentity({
    rawName: item.rawName,
    parsedName: item.rawName,
    brand: item.rawBrand ?? null,
    country: null,
    rawBrand: item.rawBrand ?? null,
    rawCountry: item.rawCountry ?? null,
    supplierName: "Тестовый поставщик",
    disableAi: false,
  });

  outputs.push({
    rawName: item.rawName,
    name: result.name,
    brand: result.brand,
    country: result.country,
    source: result.source,
    confidence: result.confidence,
  });

  if (result.brand !== item.expectedBrand) {
    throw new Error(`Unexpected brand for "${item.rawName}": expected "${item.expectedBrand}", got "${result.brand ?? "null"}"`);
  }

  if (result.country !== item.expectedCountry) {
    throw new Error(`Unexpected country for "${item.rawName}": expected "${item.expectedCountry}", got "${result.country ?? "null"}"`);
  }
}

console.log(JSON.stringify(outputs, null, 2));
