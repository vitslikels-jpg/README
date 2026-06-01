import { Prisma } from "@prisma/client";

const UNIT_ALIASES = new Map<string, string>([
  ["кг", "кг"],
  ["г", "г"],
  ["л", "л"],
  ["мл", "мл"],
  ["шт", "шт"],
  ["штук", "шт"],
  ["уп", "упак"],
  ["упак", "упак"],
  ["упаковка", "упак"],
  ["короб", "короб"],
  ["коробка", "короб"],
  ["кор", "кор"],
  ["бут", "бут"],
  ["бутылка", "бут"],
  ["банка", "банка"],
  ["бан", "банка"],
]);

const UNIT_PATTERN =
  /(^|[^\p{L}\p{N}])(кг|г|л|мл|шт|штук|уп|упак|упаковка|короб|коробка|кор|бут|бутылка|банка|бан)\.?(?=$|[^\p{L}\p{N}])/iu;
const NUMBER_PATTERN = /(?<!\d)(?:\d{1,3}(?:[ \u00a0]\d{3})+|\d+)(?:[,.]\d+)?(?!\d)/gu;

const HEADER_OR_TOTAL_PATTERNS = [
  /\b(товарная\s+накладная|универсальный\s+передаточный|счет[-\s]?фактура|сч[её]т\s+на\s+оплату)\b/iu,
  /\b(поставщик|покупатель|грузоотправитель|грузополучатель|организация|адрес|телефон|банк|бик|инн|кпп|окпо)\b/iu,
  /\b(основание|договор|дата|номер|страница|подпись|руководитель|бухгалтер|кладовщик)\b/iu,
  /^\s*(№|n|п\/п)\b/iu,
  /\b(наименование\s+товара|кол-?во|количество|ед\.?\s*изм|цена|сумма|ндс)\b/iu,
  /^\s*(итого|всего|итог|сумма\s+ндс|без\s+налога|в\s+том\s+числе|к\s+оплате)\b/iu,
];

export type ParsedInvoiceItemLine = {
  productNameRaw: string;
  quantity: Prisma.Decimal | null;
  unit: string | null;
  priceWithVat: Prisma.Decimal | null;
  lineTotal: Prisma.Decimal | null;
  confidence: number;
  needsReview: boolean;
};

type NumberMatch = {
  raw: string;
  value: number;
  start: number;
  end: number;
};

function buildDecimal(value: number, scale: number) {
  return new Prisma.Decimal(value).toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP);
}

function parseNumber(value: string) {
  const normalized = value.replace(/[ \u00a0]/g, "").replace(",", ".");

  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function findNumbers(line: string) {
  return Array.from(line.matchAll(NUMBER_PATTERN))
    .map((match): NumberMatch | null => {
      const raw = match[0];
      const value = parseNumber(raw);
      const start = match.index ?? -1;

      if (value === null || start < 0) {
        return null;
      }

      return {
        raw,
        value,
        start,
        end: start + raw.length,
      };
    })
    .filter((match): match is NumberMatch => match !== null);
}

function isIgnoredInvoiceLine(line: string) {
  const trimmed = line.trim();

  if (!trimmed) {
    return true;
  }

  if (/^-+\s*страница\s+\d+\s*-+$/iu.test(trimmed)) {
    return true;
  }

  const lower = trimmed.toLowerCase().replace(/ё/g, "е");

  return (
    lower.includes("товарная накладная") ||
    lower.includes("универсальный передаточный") ||
    lower.includes("счет-фактура") ||
    lower.includes("счет на оплату") ||
    lower.startsWith("итого") ||
    lower.startsWith("всего") ||
    lower.startsWith("сумма ндс") ||
    lower.startsWith("к оплате") ||
    HEADER_OR_TOTAL_PATTERNS.some((pattern) => pattern.test(trimmed))
  );
}

function cleanupProductName(value: string, fallback: string) {
  const cleaned = value
    .replace(/^\s*(?:№\s*)?\d+[).]?\s+/iu, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s:;.,-]+|[\s:;.,-]+$/g, "")
    .trim();

  return cleaned || fallback.trim();
}

function parseStructuredLine(line: string): ParsedInvoiceItemLine | null {
  const unitMatch = line.match(UNIT_PATTERN);

  if (!unitMatch || unitMatch.index === undefined) {
    return null;
  }

  const unitStart = unitMatch.index + unitMatch[1].length;
  const unitRaw = unitMatch[2];
  const unitEnd = unitStart + unitRaw.length;
  const normalizedUnit = UNIT_ALIASES.get(unitRaw.toLowerCase().replace(".", "")) ?? unitRaw.toLowerCase();
  const numbers = findNumbers(line);
  const quantity = numbers.filter((number) => number.end <= unitStart).at(-1) ?? null;
  const afterUnitNumbers = numbers.filter((number) => number.start >= unitEnd);

  const price =
    afterUnitNumbers.length >= 2
      ? afterUnitNumbers[afterUnitNumbers.length - 2]
      : afterUnitNumbers.length === 1
        ? afterUnitNumbers[0]
        : null;
  const total = afterUnitNumbers.length >= 2 ? afterUnitNumbers[afterUnitNumbers.length - 1] : null;
  const nameEnd = quantity?.start ?? unitStart;
  const productNameRaw = cleanupProductName(line.slice(0, nameEnd), line);
  const recognizedCount = Number(Boolean(quantity)) + 1 + Number(Boolean(price));

  return {
    productNameRaw,
    quantity: quantity ? buildDecimal(quantity.value, 3) : null,
    unit: normalizedUnit,
    priceWithVat: price ? buildDecimal(price.value, 2) : null,
    lineTotal: total ? buildDecimal(total.value, 2) : null,
    confidence: recognizedCount === 3 ? 0.8 : 0.5,
    needsReview: recognizedCount < 3,
  };
}

function parseFallbackLine(line: string): ParsedInvoiceItemLine {
  const numbers = findNumbers(line);
  const price = numbers.at(-2) ?? numbers.at(-1) ?? null;
  const total = numbers.length >= 2 ? numbers.at(-1) ?? null : null;
  const productNameRaw = cleanupProductName(price ? line.slice(0, price.start) : line, line);
  const hasUsefulNumbers = numbers.length >= 2;

  return {
    productNameRaw,
    quantity: null,
    unit: null,
    priceWithVat: price ? buildDecimal(price.value, 2) : null,
    lineTotal: total ? buildDecimal(total.value, 2) : null,
    confidence: hasUsefulNumbers ? 0.35 : 0.2,
    needsReview: true,
  };
}

function shouldKeepFallbackLine(line: string) {
  const lettersCount = (line.match(/\p{L}/gu) ?? []).length;
  const numbersCount = findNumbers(line).length;

  return lettersCount >= 3 && numbersCount > 0;
}

export function parseInvoiceItemLine(line: string): ParsedInvoiceItemLine | null {
  const trimmed = line.trim();

  if (isIgnoredInvoiceLine(trimmed)) {
    return null;
  }

  const structured = parseStructuredLine(trimmed);

  if (structured) {
    return structured;
  }

  return shouldKeepFallbackLine(trimmed) ? parseFallbackLine(trimmed) : null;
}

export function parseInvoiceItemsFromText(rawText: string) {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map(parseInvoiceItemLine)
    .filter((item): item is ParsedInvoiceItemLine => item !== null);
}
