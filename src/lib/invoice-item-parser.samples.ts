import { parseInvoiceItemsFromText } from "./invoice-item-parser";

export const invoiceItemParserSamples = [
  {
    title: "basic Russian units",
    rawText: [
      "Товарная накладная № 123 от 31.05.2026",
      "Поставщик: Тестовый поставщик",
      "1 Молоко 2,5% пастеризованное 10 шт 85,50 855,00",
      "2 Сыр гауда весовой 3 кг 640,00 1 920,00",
      "Итого: 2 775,00",
    ].join("\n"),
    expectedItemsCount: 2,
  },
  {
    title: "column-like OCR text",
    rawText: [
      "№ Наименование Кол-во Ед. Цена Сумма",
      "Мука пшеничная высший сорт 5 кг 72,30 361,50",
      "Томатная паста стекло 12 банка 110,00 1 320,00",
      "Всего наименований 2",
    ].join("\n"),
    expectedItemsCount: 2,
  },
  {
    title: "fallback without unit",
    rawText: "Шоколад темный плитка 20 1 234,50 24 690,00",
    expectedItemsCount: 1,
  },
];

export function verifyInvoiceItemParserSamples() {
  return invoiceItemParserSamples.map((sample) => ({
    title: sample.title,
    expectedItemsCount: sample.expectedItemsCount,
    actualItemsCount: parseInvoiceItemsFromText(sample.rawText).length,
  }));
}
