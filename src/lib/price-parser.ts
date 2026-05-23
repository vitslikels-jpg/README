import path from "path";
import { execFile as execFileCallback } from "child_process";
import { readFile } from "fs/promises";
import { promisify } from "util";
import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { syncCatalogForDocument } from "@/lib/catalog-sync-core.js";
import { upsertDocumentQualityReport } from "@/lib/document-quality";
import { prisma } from "@/lib/prisma";

const execFile = promisify(execFileCallback);

type ParsedField =
  | "name"
  | "article"
  | "brand"
  | "country"
  | "unit"
  | "packaging"
  | "minOrderQuantity"
  | "unitsPerPack"
  | "price"
  | "stock"
  | "preOrder"
  | "shipByBoxesOnly";

type HeaderMatchResult = {
  headerRowIndex: number;
  headerRowSpan: number;
  fieldIndexes: Partial<Record<ParsedField, number>>;
  supplierProfileId: string | null;
};

type ParseDocumentResult = {
  parsedCount: number;
  skippedCount: number;
  status: "parsed" | "parsed_with_errors" | "failed";
  message?: string;
};

type ParsedProductRow = {
  name: string;
  article: string | null;
  brand: string | null;
  country: string | null;
  unit: string | null;
  unitsPerPack: Prisma.Decimal | null;
  minOrderQuantity: Prisma.Decimal | null;
  orderStep: Prisma.Decimal | null;
  allowFractionalOrder: boolean;
  shipByBoxesOnly: boolean;
  price: Prisma.Decimal | null;
  stock: Prisma.Decimal | null;
  sourceRow: number;
  rawData: Record<string, string>;
};

type SupplierProfile = {
  id: string;
  detectHeaders: string[];
  exactFieldHeaders?: Partial<Record<ParsedField, string[]>>;
  rawHeaderAliases?: Partial<Record<ParsedField, string[]>>;
  excludedNameHeaders?: string[];
  disableStockParsing?: boolean;
};

type NameParts = {
  name: string;
  brand: string | null;
  country: string | null;
};

const headerSynonyms: Record<ParsedField, string[]> = {
  name: [
    "наименование",
    "товар",
    "номенклатура",
    "наименование товара",
    "позиция",
    "название",
    "product",
    "name",
    "item",
  ],
  article: ["артикул", "код", "код товара", "vendor code", "sku", "article"],
  brand: ["бренд", "марка", "производитель", "manufacturer", "brand", "vendor"],
  country: ["страна", "страна производителя", "country", "origin"],
  unit: ["ед", "ед.", "единица", "ед изм", "единица измерения", "unit", "uom", "упак", "упак.", "уп."],
  packaging: ["фасовка", "вес", "объем", "packing", "packaging"],
  minOrderQuantity: [
    "мин квант",
    "мин. квант",
    "минимум",
    "мин заказ",
    "минимальный заказ",
    "minimum order",
  ],
  unitsPerPack: [
    "шт в коробке",
    "коробка",
    "кол-во в коробке",
    "box qty",
    "pack size",
    "шт/кр",
    "шткр",
  ],
  price: ["цена", "стоимость", "прайс", "price", "cost", "закупочная цена", "опт цена", "цена опт"],
  stock: ["остаток", "наличие", "stock", "available", "availability"],
  preOrder: ["под заказ", "preorder"],
  shipByBoxesOnly: ["отгружать по коробкам", "коробками", "ship by boxes"],
};

const supplierProfiles: SupplierProfile[] = [
  {
    id: "vostok-zapad",
    detectHeaders: [
      "маркетинговое наименование товара",
      "товар №",
      "мин. цена супер.",
      "пеи",
    ],
    exactFieldHeaders: {
      name: ["маркетинговое наименование товара"],
      article: ["товар №", "товар n", "товар no"],
      unit: ["ед. изм.", "ед. изм"],
      packaging: ["вес нетто ед. изм", "вес нетто ед изм"],
      minOrderQuantity: ["кол-во единиц в пеи"],
      unitsPerPack: ["кол-во еи в коробке"],
      price: ["мин. цена супер.", "мин цена супер"],
      preOrder: ["статус продукта"],
    },
    rawHeaderAliases: {
      shipByBoxesOnly: ["пеи"],
    },
    excludedNameHeaders: ["товарная группа 1", "товарная группа 2", "товар №"],
    disableStockParsing: true,
  },
  {
    id: "eurofoods",
    detectHeaders: ["артикул", "номенклатура", "стандарт основной", "цена", "упак"],
    exactFieldHeaders: {
      article: ["артикул"],
      name: ["номенклатура"],
      unit: ["упак.", "упак"],
    },
    disableStockParsing: true,
  },
];

const countryAliases = new Map<string, string>([
  ["россия", "РОССИЯ"],
  ["рф", "РОССИЯ"],
  ["russia", "РОССИЯ"],
  ["таиланд", "ТАИЛАНД"],
  ["тайланд", "ТАИЛАНД"],
  ["thailand", "ТАИЛАНД"],
  ["вьетнам", "ВЬЕТНАМ"],
  ["vietnam", "ВЬЕТНАМ"],
  ["австрия", "АВСТРИЯ"],
  ["austria", "АВСТРИЯ"],
  ["индонезия", "ИНДОНЕЗИЯ"],
  ["indonesia", "ИНДОНЕЗИЯ"],
  ["бельгия", "БЕЛЬГИЯ"],
  ["belgium", "БЕЛЬГИЯ"],
  ["бразилия", "БРАЗИЛИЯ"],
  ["brazil", "БРАЗИЛИЯ"],
  ["беларусь", "БЕЛАРУСЬ"],
  ["belarus", "БЕЛАРУСЬ"],
  ["малайзия", "МАЛАЙЗИЯ"],
  ["malaysia", "МАЛАЙЗИЯ"],
  ["нидерланды", "НИДЕРЛАНДЫ"],
  ["netherlands", "НИДЕРЛАНДЫ"],
  ["польша", "ПОЛЬША"],
  ["poland", "ПОЛЬША"],
  ["италия", "ИТАЛИЯ"],
  ["italy", "ИТАЛИЯ"],
  ["italia", "ИТАЛИЯ"],
  ["китай", "КИТАЙ"],
  ["china", "КИТАЙ"],
  ["индия", "ИНДИЯ"],
  ["india", "ИНДИЯ"],
  ["турция", "ТУРЦИЯ"],
  ["turkey", "ТУРЦИЯ"],
  ["иран", "ИРАН"],
  ["iran", "ИРАН"],
  ["испания", "ИСПАНИЯ"],
  ["spain", "ИСПАНИЯ"],
  ["греция", "ГРЕЦИЯ"],
  ["greece", "ГРЕЦИЯ"],
  ["франция", "ФРАНЦИЯ"],
  ["france", "ФРАНЦИЯ"],
  ["германия", "ГЕРМАНИЯ"],
  ["germany", "ГЕРМАНИЯ"],
  ["южная корея", "ЮЖНАЯ КОРЕЯ"],
  ["корея южная", "ЮЖНАЯ КОРЕЯ"],
  ["south korea", "ЮЖНАЯ КОРЕЯ"],
  ["republic of korea", "ЮЖНАЯ КОРЕЯ"],
  ["эквадор", "ЭКВАДОР"],
  ["ecuador", "ЭКВАДОР"],
  ["аргентина", "АРГЕНТИНА"],
  ["argentina", "АРГЕНТИНА"],
  ["уругвай", "УРУГВАЙ"],
  ["uruguay", "УРУГВАЙ"],
  ["египет", "ЕГИПЕТ"],
  ["egypt", "ЕГИПЕТ"],
  ["чили", "ЧИЛИ"],
  ["chile", "ЧИЛИ"],
  ["сша", "США"],
  ["usa", "США"],
  ["u.s.a.", "США"],
  ["united states", "США"],
]);

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/giu, "");
}

function tokenizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^a-zа-я0-9]+/giu)
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeHeaderTokens(value: unknown) {
  return tokenizeHeader(value).map((token) => normalizeHeader(token));
}

function normalizeCellValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value).trim();
}

function normalizeOptionalProductText(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();

  if (!trimmed) {
    return null;
  }

  if (/^[-—–]+$/u.test(trimmed)) {
    return null;
  }

  const normalized = normalizeComparableText(trimmed);

  if (["нет", "отсутствует", "none", "n/a", "na"].includes(normalized)) {
    return null;
  }

  return trimmed;
}

function normalizeComparableText(value: string) {
  return value.trim().toLowerCase().replace(/ё/g, "е");
}

function normalizeCountryToken(value: string) {
  return normalizeComparableText(value).replace(/[).,;:!?]+$/gu, "").trim();
}

function normalizeBrandComparableText(value: string) {
  return normalizeComparableText(value).replace(/[!.,;:()"'`]+$/gu, "").trim();
}

function toDisplayCountry(value: string) {
  return countryAliases.get(normalizeCountryToken(value)) ?? normalizeCountryToken(value).toUpperCase();
}

function looksLikeCountry(value: string) {
  const normalized = normalizeCountryToken(value);
  return countryAliases.has(normalized);
}

function looksLikeBrand(value: string) {
  const trimmed = value.trim();

  if (!trimmed || looksLikeCountry(trimmed)) {
    return false;
  }

  if (!/[A-ZА-ЯЁ]/u.test(trimmed)) {
    return false;
  }

  return /^[A-ZА-ЯЁ0-9'’`_.&/\- ]{2,}$/u.test(trimmed);
}

function looksLikeLatinTitleCaseBrand(value: string) {
  const trimmed = value.trim();

  if (!trimmed || looksLikeCountry(trimmed) || !/[A-Za-z]/u.test(trimmed)) {
    return false;
  }

  const words = trimmed.split(/\s+/u).filter(Boolean);

  if (words.length === 0 || words.length > 3) {
    return false;
  }

  return words.every((word) => /^[A-Z][A-Za-z0-9'вЂ™`_.&/\-]*$/u.test(word) || /^[A-Z0-9'вЂ™`_.&/\-]+$/u.test(word));
}

function isBrandCandidate(value: string) {
  return looksLikeBrand(value) || looksLikeLatinTitleCaseBrand(value);
}

function extractTrailingBrandCandidate(name: string, currentBrand: string | null) {
  if (currentBrand) {
    return null;
  }

  const words = name
    .trim()
    .split(/\s+/u)
    .filter(Boolean);

  if (words.length < 2) {
    return null;
  }

  for (let size = Math.min(3, words.length - 1); size >= 1; size -= 1) {
    const candidate = sanitizeLooseBrandCandidate(words.slice(-size).join(" ").trim());
    const remainingName = words.slice(0, -size).join(" ").trim();

    if (!remainingName || !isBrandCandidate(candidate)) {
      continue;
    }

    return {
      name: remainingName,
      brand: candidate,
    };
  }

  return null;
}

function sanitizeLooseBrandCandidate(value: string) {
  return value
    .trim()
    .replace(/^[("']?(?:TM|ТМ)\s+/iu, "")
    .replace(/[!)+*.,;:'"]+$/gu, "")
    .trim();
}

function looksLikeQuotedBrandValue(value: string) {
  const compactValue = value.trim();

  if (!compactValue || compactValue.length < 2 || compactValue.length > 80) {
    return false;
  }

  if (!/[A-Za-zА-Яа-яЁё]/u.test(compactValue)) {
    return false;
  }

  const words = compactValue.split(/\s+/u).filter(Boolean);
  return words.length > 0 && words.length <= 6;
}

function extractQuotedBrandCandidate(name: string, currentBrand: string | null) {
  if (currentBrand) {
    return null;
  }

  const compactName = name.trim();
  const normalizedQuotedName = compactName.replace(/[«»“”]/gu, '"');
  const matches = [...normalizedQuotedName.matchAll(/"([^"]+)"/gu)];

  if (matches.length === 0) {
    return null;
  }

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const currentMatch = matches[index];

    if (!currentMatch || currentMatch.index === undefined) {
      continue;
    }

    const candidateBrand = sanitizeLooseBrandCandidate(currentMatch[1]);

    if (!looksLikeQuotedBrandValue(candidateBrand)) {
      continue;
    }

    const nextName = normalizePdfNameSpacing(
      `${normalizedQuotedName.slice(0, currentMatch.index)} ${normalizedQuotedName.slice(currentMatch.index + currentMatch[0].length)}`,
    )
      .replace(/\s*,\s*,/gu, ", ")
      .replace(/,\s*$/u, "")
      .trim();

    if (!nextName) {
      continue;
    }

    return {
      name: nextName,
      brand: candidateBrand,
    };
  }

  return null;
}

function extractTrailingCountryCandidate(name: string, currentCountry: string | null): {
  name: string;
  country: string | null;
} {
  if (currentCountry) {
    return {
      name: name.trim(),
      country: currentCountry,
    };
  }

  const compactName = name.trim();

  if (!compactName) {
    return {
      name: compactName,
      country: currentCountry,
    };
  }

  for (const alias of countryAliases.keys()) {
    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const match = compactName.match(new RegExp(`(?:^|\\s)(${escapedAlias})(?:(?:\\s*\\([^)]*\\))|(?:[).,;:!?*/\\\\]+))?\\s*$`, "iu"));

    if (!match) {
      continue;
    }

    return {
      name: compactName.slice(0, match.index).trim(),
      country: toDisplayCountry(match[1]),
    };
  }

  return {
    name: compactName,
    country: currentCountry,
  };
}

function stripLeadingDuplicatedBrand(name: string, brand: string | null) {
  if (!brand) {
    return name.trim();
  }

  const normalizedName = name.trim();
  const brandWords = brand.trim().split(/\s+/u).filter(Boolean);

  if (brandWords.length === 0) {
    return normalizedName;
  }

  const nameWords = normalizedName.split(/\s+/u).filter(Boolean);
  const leadingCandidate = nameWords.slice(0, brandWords.length).join(" ").trim();

  if (normalizeBrandComparableText(leadingCandidate) !== normalizeBrandComparableText(brand)) {
    return normalizedName;
  }

  return nameWords.slice(brandWords.length).join(" ").trim() || normalizedName;
}

const knownLeadingBrandPhrases = [
  "Альпийская коровка",
  "Био-Баланс",
  "АктиБио",
  "Актимуно",
  "Даниссимо",
  "Хохланд",
  "Киндер",
  "PRB",
  "PADAM",
  "KOUMORI",
  "Pechagin Professional",
  "EFKO FOOD",
];

const knownInlineBrandPhrases = [
  "Pechagin Professional",
  "ToDoFood",
  "BOMBBAR",
  "Varvello",
  "Luciano",
  "KOUMORI",
  "PADAM",
  "BURCU",
  "PRB",
];

function extractLeadingKnownBrandCandidate(name: string, currentBrand: string | null) {
  if (currentBrand) {
    return null;
  }

  const compactName = name.trim();

  for (const phrase of knownLeadingBrandPhrases) {
    const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const match = compactName.match(new RegExp(`^(${escapedPhrase})(?:\\s+|$)(.+)?$`, "u"));

    if (!match) {
      continue;
    }

    const remainder = (match[2] ?? "").trim();

    if (!remainder) {
      continue;
    }

    return {
      name: stripLeadingDuplicatedBrand(remainder, phrase),
      brand: phrase,
    };
  }

  return null;
}

function enrichKnownBrandFromName(name: string, brand: string | null) {
  const nextName = name.trim();
  const nextBrand = brand?.trim() || null;

  if (!nextBrand) {
    return {
      name: nextName,
      brand: nextBrand,
    };
  }

  if (nextBrand === "Нео Продукт" && /(^|\s)Долголетие(?=\s+\d)/u.test(nextName)) {
    return {
      name: nextName.replace(/(^|\s)Долголетие(?=\s+\d)/u, "$1").replace(/\s+/gu, " ").trim(),
      brand: "Нео Продукт Долголетие",
    };
  }

  return {
    name: nextName,
    brand: nextBrand,
  };
}

function inferUnitsPerPackFromName(name: string) {
  const compactName = name.trim();
  const unitsToken = String.raw`(?:\u0448\u0442|pcs?|pieces?)`;
  const separatorMatch = compactName.match(
    new RegExp(String.raw`(?:[*xX×/\u0445\u0425-])\s*(\d+(?:[.,]\d+)?)\s*${unitsToken}(?=\b|[^A-Za-z\u0400-\u04FF]|$)`, "iu"),
  );

  if (separatorMatch) {
    return new Prisma.Decimal(separatorMatch[1].replace(",", "."));
  }

  const bracketMatch = compactName.match(new RegExp(String.raw`\(\s*(\d+(?:[.,]\d+)?)\s*${unitsToken}\s*\)`, "iu"));

  if (!bracketMatch) {
    return null;
  }

  return new Prisma.Decimal(bracketMatch[1].replace(",", "."));
}

function extractKnownInlineBrandCandidate(name: string, currentBrand: string | null) {
  if (currentBrand) {
    return null;
  }

  const compactName = name.trim();

  for (const phrase of knownInlineBrandPhrases) {
    const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const match = compactName.match(new RegExp(`(?:^|\\s)(?:TM|ТМ)?\\s*(${escapedPhrase})(?=\\s|[)!.,;:*/]|$)`, "iu"));

    if (!match || match.index === undefined) {
      continue;
    }

    const matchedText = match[0];
    const nextName = normalizePdfNameSpacing(`${compactName.slice(0, match.index)} ${compactName.slice(match.index + matchedText.length)}`);

    if (!nextName) {
      continue;
    }

    return {
      name: nextName,
      brand: phrase,
    };
  }

  return null;
}

function extractTrailingBrandCountryCandidate(name: string, currentBrand: string | null, currentCountry: string | null) {
  if (currentBrand || currentCountry) {
    return null;
  }

  const compactName = name.trim();

  if (!compactName) {
    return null;
  }

  const words = compactName.split(/\s+/u).filter(Boolean);

  for (let countrySize = Math.min(3, words.length - 1); countrySize >= 1; countrySize -= 1) {
    const rawCountry = words.slice(-countrySize).join(" ").trim();

    if (!looksLikeCountry(rawCountry)) {
      continue;
    }

    const withoutCountry = words.slice(0, -countrySize).join(" ").trim();
    const brandWords = withoutCountry.split(/\s+/u).filter(Boolean);

    for (let brandSize = Math.min(4, brandWords.length - 1); brandSize >= 1; brandSize -= 1) {
      const rawBrand = brandWords.slice(-brandSize).join(" ").trim();
      const sanitizedBrand = sanitizeLooseBrandCandidate(rawBrand);

      if (!sanitizedBrand || !isBrandCandidate(sanitizedBrand)) {
        continue;
      }

      const remainingName = brandWords.slice(0, -brandSize).join(" ").trim();

      if (!remainingName) {
        continue;
      }

      return {
        name: stripLeadingDuplicatedBrand(remainingName, sanitizedBrand),
        brand: sanitizedBrand,
        country: toDisplayCountry(rawCountry),
      };
    }
  }

  return null;
}

function looksLikeBrandTitleWord(value: string) {
  return /^[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё!'-]*$/u.test(value.trim());
}

function extractTrailingLatinBrandBeforeMeasure(beforeMeasure: string, afterMeasure: string): {
  name: string;
  brand: string;
} | null {
  const compactBeforeMeasure = beforeMeasure.trim();

  if (!compactBeforeMeasure) {
    return null;
  }

  const brandMatch = compactBeforeMeasure.match(
    /^(.*?)(?:\s+)([A-Z][A-Za-z0-9'’`_.&/\-]+(?:\s+(?:[A-Z][A-Za-z0-9'’`_.&/\-]+|[a-z][A-Za-z0-9'’`_.&/\-]+)){0,3})$/u,
  );

  if (!brandMatch) {
    return null;
  }

  const candidateBrand = sanitizeLooseBrandCandidate(brandMatch[2]);
  const nextName = [brandMatch[1]?.trim(), afterMeasure].filter(Boolean).join(" ").trim();

  if (!candidateBrand || !nextName) {
    return null;
  }

  const candidateWords = candidateBrand.split(/\s+/u).filter(Boolean);
  const hasSignalWord = candidateWords.some((word) => /^[A-Z]{2,}$/.test(word) || /^[A-Z][a-z]/.test(word));

  if (!hasSignalWord) {
    return null;
  }

  return {
    name: nextName,
    brand: candidateBrand,
  };
}

function extractEmbeddedCountryBeforeMeasure(name: string, currentCountry: string | null): {
  name: string;
  country: string | null;
} {
  if (currentCountry) {
    return {
      name: name.trim(),
      country: currentCountry,
    };
  }

  const compactName = name.trim();
  const measureMatch = compactName.match(/\b\d+(?:[.,]\d+)?\s*(?:%|л|л\.|мл|гр|г|кг|шт)\b|\(\s*\d+\s*шт\s*\)/iu);

  if (!measureMatch || measureMatch.index === undefined || measureMatch.index <= 0) {
    return {
      name: compactName,
      country: currentCountry,
    };
  }

  const beforeMeasure = compactName.slice(0, measureMatch.index).trim();
  const afterMeasure = compactName.slice(measureMatch.index).trim();
  const trailingCountry = extractTrailingCountryCandidate(beforeMeasure, null);

  if (!trailingCountry.country || !trailingCountry.name) {
    return {
      name: compactName,
      country: currentCountry,
    };
  }

  return {
    name: normalizePdfNameSpacing([trailingCountry.name, afterMeasure].filter(Boolean).join(" ")),
    country: trailingCountry.country,
  };
}

function extractEmbeddedBrandBeforeMeasure(name: string, currentBrand: string | null): NameParts | null {
  if (currentBrand) {
    return null;
  }

  const compactName = name.trim();
  const measureMatch = compactName.match(/\b\d+(?:[.,]\d+)?\s*(?:%|л|л\.|мл|гр|г|кг|шт)\b|\(\s*\d+\s*шт\s*\)/iu);

  if (!measureMatch || measureMatch.index === undefined || measureMatch.index <= 0) {
    return null;
  }

  const beforeMeasure = compactName.slice(0, measureMatch.index).trim();
  const afterMeasure = compactName.slice(measureMatch.index).trim();
  const beforeMeasureBrandCountry = extractTrailingBrandCountryCandidate(beforeMeasure, null, null);

  if (beforeMeasureBrandCountry) {
    return {
      name: [beforeMeasureBrandCountry.name, afterMeasure].filter(Boolean).join(" ").trim(),
      brand: beforeMeasureBrandCountry.brand,
      country: beforeMeasureBrandCountry.country,
    };
  }

  const trailingLatinBrand = extractTrailingLatinBrandBeforeMeasure(beforeMeasure, afterMeasure);

  if (trailingLatinBrand) {
    return {
      ...trailingLatinBrand,
      country: null,
    };
  }

  const words = beforeMeasure.split(/\s+/u).filter(Boolean);
  const genericBrandLeadWords = new Set(["Бутылка", "Банка", "Пакет", "Стакан", "ПЭТ", "Пэт"]);
  const titleCaseRun: string[] = [];

  for (let index = words.length - 1; index >= 0; index -= 1) {
    if (!looksLikeBrandTitleWord(words[index])) {
      break;
    }

    titleCaseRun.unshift(words[index]);
  }

  if (titleCaseRun.length < 2) {
    return null;
  }

  let candidateWords = titleCaseRun.slice(-4);

  while (candidateWords.length > 2 && genericBrandLeadWords.has(candidateWords[0])) {
    candidateWords = candidateWords.slice(1);
  }

  if (candidateWords.length < 2) {
    return null;
  }

  const brand = candidateWords.join(" ").trim();
  const nextNameWords = words.slice(0, words.length - candidateWords.length);
  const nextName = [nextNameWords.join(" ").trim(), afterMeasure].filter(Boolean).join(" ").trim();

  if (!nextName) {
    return null;
  }

  return {
    name: nextName,
    brand,
    country: null,
  };
}

function looksLikePotentialCountryLabel(value: string) {
  const trimmed = value.trim();

  if (!trimmed || /\d/.test(trimmed)) {
    return false;
  }

  if (looksLikeCountry(trimmed)) {
    return true;
  }

  return /^[A-ZА-ЯЁ ]{4,}$/u.test(trimmed);
}

function splitNameBySemanticCommas(value: string) {
  const decimalCommaPlaceholder = "__DECIMAL_COMMA__";

  return value
    .replace(/(?<=\d),\s*(?=\d)/gu, decimalCommaPlaceholder)
    .split(",")
    .map((part) => part.replaceAll(decimalCommaPlaceholder, ",").trim())
    .filter(Boolean);
}

function splitNameBrandCountry(rawName: string, currentBrand: string | null, currentCountry: string | null): NameParts {
  const compactName = rawName.trim();

  if (!compactName) {
    return {
      name: compactName,
      brand: currentBrand,
      country: currentCountry,
    };
  }

  const leadingKnownBrand = extractLeadingKnownBrandCandidate(compactName, currentBrand);

  if (leadingKnownBrand) {
    return finalizeParsedNameParts({
      name: leadingKnownBrand.name,
      brand: leadingKnownBrand.brand,
      country: currentCountry,
    });
  }

  const quotedBrand = extractQuotedBrandCandidate(compactName, currentBrand);

  if (quotedBrand) {
    return finalizeParsedNameParts({
      name: quotedBrand.name,
      brand: quotedBrand.brand,
      country: currentCountry,
    });
  }

  const trailingBrandCountry = extractTrailingBrandCountryCandidate(compactName, currentBrand, currentCountry);

  if (trailingBrandCountry) {
    return trailingBrandCountry;
  }

  const parts = splitNameBySemanticCommas(compactName);

  if (parts.length < 2) {
    const trailingBrand = extractTrailingBrandCandidate(compactName, currentBrand);

    if (trailingBrand) {
      return {
        name: trailingBrand.name,
        brand: trailingBrand.brand,
        country: currentCountry,
      };
    }

    const embeddedBrand = extractEmbeddedBrandBeforeMeasure(compactName, currentBrand);

    if (embeddedBrand) {
      return {
        name: embeddedBrand.name,
        brand: embeddedBrand.brand,
        country: currentCountry,
      };
    }

    return {
      name: compactName,
      brand: currentBrand,
      country: currentCountry,
    };
  }

  let nextCountry = currentCountry?.trim() || null;
  let nextBrand = currentBrand?.trim() || null;

  if (nextBrand && looksLikeCountry(nextBrand) && !nextCountry) {
    nextCountry = toDisplayCountry(nextBrand);
    nextBrand = null;
  }

  if (nextCountry && !looksLikeCountry(nextCountry) && !nextBrand && looksLikeBrand(nextCountry)) {
    nextBrand = nextCountry;
    nextCountry = null;
  }

  const mutableParts = [...parts];
  const lastPart = mutableParts[mutableParts.length - 1];

  if (looksLikeCountry(lastPart)) {
    nextCountry = toDisplayCountry(lastPart);
    mutableParts.pop();
  } else if (nextCountry && normalizeComparableText(lastPart) === normalizeComparableText(nextCountry)) {
    mutableParts.pop();
  }

  const maybeBrand = mutableParts[mutableParts.length - 1];

  if ((!nextBrand || normalizeComparableText(nextBrand) === normalizeComparableText(maybeBrand)) && maybeBrand && isBrandCandidate(maybeBrand)) {
    nextBrand = maybeBrand;
    mutableParts.pop();
  } else if (nextBrand && maybeBrand && normalizeComparableText(maybeBrand) === normalizeComparableText(nextBrand)) {
    mutableParts.pop();
  }

  const nextName = mutableParts.join(", ").trim();

  return {
    name: nextName || compactName,
    brand: nextBrand,
    country: nextCountry,
  };
}

function repairQuotedBrandParts(rawName: string, parts: NameParts) {
  if (!/["«»“”]/u.test(rawName)) {
    return parts;
  }

  const quotedBrand = extractQuotedBrandCandidate(rawName, null);

  if (!quotedBrand) {
    return parts;
  }

  if (!parts.name.includes('"') && parts.brand && normalizeBrandComparableText(parts.brand) === normalizeBrandComparableText(quotedBrand.brand)) {
    return parts;
  }

  return finalizeParsedNameParts({
    name: quotedBrand.name,
    brand: quotedBrand.brand,
    country: parts.country,
  });
}

function finalizeParsedNameParts(product: {
  name: string;
  brand: string | null;
  country: string | null;
}) {
  let nextName = product.name.trim();
  let nextBrand = product.brand?.trim() || null;
  let nextCountry = product.country?.trim() || null;

  const trailingCountry = extractTrailingCountryCandidate(nextName, nextCountry);
  nextName = trailingCountry.name;
  nextCountry = trailingCountry.country;

  const embeddedCountry = extractEmbeddedCountryBeforeMeasure(nextName, nextCountry);
  nextName = embeddedCountry.name;
  nextCountry = embeddedCountry.country;

  const quotedBrand = extractQuotedBrandCandidate(nextName, nextBrand);

  if (quotedBrand) {
    nextName = quotedBrand.name;
    nextBrand = quotedBrand.brand;
  }

  const leadingKnownBrand = extractLeadingKnownBrandCandidate(nextName, nextBrand);

  if (leadingKnownBrand) {
    nextName = leadingKnownBrand.name;
    nextBrand = leadingKnownBrand.brand;
  }

  const inlineKnownBrand = extractKnownInlineBrandCandidate(nextName, nextBrand);

  if (inlineKnownBrand) {
    nextName = inlineKnownBrand.name;
    nextBrand = inlineKnownBrand.brand;
  }

  const trailingCountryAfterBrand = extractTrailingCountryCandidate(nextName, nextCountry);
  nextName = trailingCountryAfterBrand.name;
  nextCountry = trailingCountryAfterBrand.country;

  const embeddedCountryAfterBrand = extractEmbeddedCountryBeforeMeasure(nextName, nextCountry);
  nextName = embeddedCountryAfterBrand.name;
  nextCountry = embeddedCountryAfterBrand.country;

  if (nextBrand && looksLikeCountry(nextBrand) && !nextCountry) {
    nextCountry = toDisplayCountry(nextBrand);
    nextBrand = null;
  }

  if (nextBrand && looksLikeCountry(nextBrand) && nextCountry && !looksLikeCountry(nextCountry) && looksLikeBrand(nextCountry)) {
    const swappedBrand = nextCountry;
    nextCountry = toDisplayCountry(nextBrand);
    nextBrand = swappedBrand;
  }

  const parts = splitNameBySemanticCommas(nextName);

  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1];

    if (nextCountry && normalizeComparableText(lastPart) === normalizeComparableText(nextCountry)) {
      parts.pop();
    }

    const maybeBrand = parts[parts.length - 1];

    if (!nextBrand && maybeBrand && isBrandCandidate(maybeBrand)) {
      nextBrand = maybeBrand;
      parts.pop();
    } else if (!nextCountry && nextBrand && maybeBrand && isBrandCandidate(maybeBrand) && looksLikePotentialCountryLabel(nextBrand)) {
      nextCountry = toDisplayCountry(nextBrand);
      nextBrand = maybeBrand;
      parts.pop();
    } else if (nextBrand && maybeBrand && normalizeComparableText(maybeBrand) === normalizeComparableText(nextBrand)) {
      parts.pop();
    }

    nextName = parts.join(", ").trim() || nextName;
  }

  const trailingBrand = extractTrailingBrandCandidate(nextName, nextBrand);

  if (trailingBrand) {
    nextName = trailingBrand.name;
    nextBrand = trailingBrand.brand;
  }

  nextName = stripLeadingDuplicatedBrand(nextName, nextBrand);
  nextName = nextName
    .replace(/\s+,/gu, ",")
    .replace(/\s*[,/\\]+\s*$/u, "")
    .replace(/[,\s]+$/u, "")
    .replace(/\(\s*\)$/u, "")
    .trim();
  const enrichedBrand = enrichKnownBrandFromName(nextName, nextBrand);
  nextName = enrichedBrand.name;
  nextBrand = enrichedBrand.brand;

  return {
    name: nextName,
    brand: nextBrand,
    country: nextCountry,
  };
}

function normalizePdfNameSpacing(value: string) {
  return value
    .replace(/([A-Za-zА-Яа-яЁё%])\(/gu, "$1 (")
    .replace(/\)([A-Za-zА-Яа-яЁё])/gu, ") $1")
    .replace(/\s*\(\s*/gu, " (")
    .replace(/\s*\)\s*/gu, ") ")
    .replace(/\s*,\s*/gu, ", ")
    .replace(/(\d), (\d)/gu, "$1,$2")
    .replace(/((?:короб(?:ка)?\.?|кор\.?|кор|монолит|в\/у|уп\.?|уп))(?=[~\d])/giu, "$1 ")
    .replace(/(^|[\s)])((?:короб(?:ка)?\.?|кор\.?|кор|монолит|в\/у|уп\.?|уп))(?=[~\d(])/giu, "$1$2 ")
    .replace(/\s+/gu, " ")
    .trim();
}

function extractPdfAnalysisSegments(name: string) {
  const normalizedName = normalizePdfNameSpacing(name);
  const match = normalizedName.match(/^(.*?)(\s+(?:короб(?:ка)?\.?|монолит|в\/у|уп\.?|кор\.?).*)$/iu);

  if (!match) {
    return {
      analysisPart: normalizedName,
      suffixPart: "",
    };
  }

  return {
    analysisPart: match[1].trim(),
    suffixPart: match[2].trim(),
  };
}

function stripTrailingPdfReferenceCode(name: string) {
  return normalizePdfNameSpacing(name.replace(/\s*\([A-ZА-Я0-9\s./-]{1,24}\)\s*$/u, " ").trim());
}

function looksLikePdfTrailingBrand(value: string) {
  const trimmed = sanitizeLooseBrandCandidate(value);

  if (!trimmed || looksLikeCountry(trimmed) || /\d/u.test(trimmed)) {
    return false;
  }

  const words = trimmed.split(/\s+/u).filter(Boolean);

  if (words.length === 0 || words.length > 3) {
    return false;
  }

  return words.every((word) => {
    if (/^[A-ZА-ЯЁ0-9'’`_.&/\-]+$/u.test(word)) {
      return true;
    }

    return /^[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё'’`_.&/\-]*$/u.test(word);
  });
}

function extractPdfCountryAndCleanup(name: string) {
  let nextName = name.trim();
  let country: string | null = null;

  for (const alias of countryAliases.keys()) {
    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const patterns = [
      new RegExp(`(?:^|\\s)(${escapedAlias})(?:(?:\\s*\\([^)]*\\))|(?:[).,;:!?*]+))?\\s*$`, "iu"),
      new RegExp(`(?:^|\\s)(${escapedAlias})(?:\\s+[A-Z0-9/-]+){1,3}\\s*$`, "iu"),
    ];
    const match = patterns.map((pattern) => nextName.match(pattern)).find(Boolean);

    if (!match) {
      continue;
    }

    country = toDisplayCountry(match[1]);
    nextName = normalizePdfNameSpacing(nextName.slice(0, match.index).trim());
    break;
  }

  return {
    name: nextName,
    country,
  };
}

function extractPdfTrailingBrand(name: string) {
  const normalizedName = stripTrailingPdfReferenceCode(name);
  const words = normalizedName.trim().split(/\s+/u).filter(Boolean);

  for (let size = Math.min(3, words.length - 1); size >= 1; size -= 1) {
    const candidate = sanitizeLooseBrandCandidate(words.slice(-size).join(" ").trim());
    const remainingName = words.slice(0, -size).join(" ").trim();

    if (!remainingName || !looksLikePdfTrailingBrand(candidate)) {
      continue;
    }

    return {
      name: normalizePdfNameSpacing(remainingName),
      brand: candidate,
    };
  }

  return {
    name: normalizedName,
    brand: null,
  };
}

function normalizePdfExtractedBrand(name: string, brand: string | null) {
  if (!brand) {
    return {
      name: normalizePdfNameSpacing(name),
      brand: null,
    };
  }

  const words = brand.split(/\s+/u).filter(Boolean);
  const restorablePrefixes = new Set(["ПБГ", "ПСГ", "ГОСТ", "КУБИКИ", "Кубики"]);
  const movedPrefixes: string[] = [];

  while (words.length > 1 && restorablePrefixes.has(words[0])) {
    movedPrefixes.push(words.shift() as string);
  }

  const nextBrand = words.join(" ").trim() || null;
  const nextName = normalizePdfNameSpacing([name, ...movedPrefixes].filter(Boolean).join(" "));

  return {
    name: nextName,
    brand: nextBrand,
  };
}

function splitPdfNameBrandCountry(rawName: string) {
  const normalizedName = normalizePdfNameSpacing(rawName);
  const wholeLineParts = splitNameBrandCountry(normalizedName, null, null);

  if (wholeLineParts.brand || wholeLineParts.country) {
    const trailingCountry = extractPdfCountryAndCleanup(wholeLineParts.name);

    return finalizeParsedNameParts({
      name: trailingCountry.name,
      brand: wholeLineParts.brand,
      country: wholeLineParts.country ?? trailingCountry.country,
    });
  }

  const { analysisPart, suffixPart } = extractPdfAnalysisSegments(normalizedName);
  const extractedCountry = extractPdfCountryAndCleanup(analysisPart);
  const extractedBrand = extractPdfTrailingBrand(extractedCountry.name);
  const normalizedBrand = normalizePdfExtractedBrand(extractedBrand.name, extractedBrand.brand);
  const embeddedBrand = extractEmbeddedBrandBeforeMeasure(normalizedBrand.name, normalizedBrand.brand);
  const mergedName = normalizePdfNameSpacing([(embeddedBrand?.name ?? normalizedBrand.name), suffixPart].filter(Boolean).join(" "));

  return finalizeParsedNameParts({
    name: mergedName,
    brand: embeddedBrand?.brand ?? normalizedBrand.brand,
    country: embeddedBrand?.country ?? extractedCountry.country,
  });
}

function cleanupPdfParsedParts(parts: NameParts) {
  let nextName = normalizePdfNameSpacing(parts.name);
  let nextBrand = parts.brand?.trim() || null;

  if (nextBrand) {
    const movedTokens: string[] = [];

    while (true) {
      const brandMatch: RegExpMatchArray | null = nextBrand.match(/^(ПБГ|ПСГ|ГОСТ|КУБИКИ|Кубики|ПОРЦ\.|порц\.)\s+(.+)$/u);

      if (!brandMatch) {
        break;
      }

      movedTokens.push(brandMatch[1]);
      nextBrand = brandMatch[2].trim();
    }

    if (movedTokens.length > 0) {
      nextName = normalizePdfNameSpacing([nextName, ...movedTokens].join(" "));
    }
  }

  return {
    name: nextName,
    brand: nextBrand,
    country: parts.country,
  };
}

function parseDecimal(value: string) {
  if (!value) {
    return null;
  }

  let normalized = value.replace(/\s+/g, "").replace(/[^\d,.-]/g, "");
  normalized = normalized.replace(/^[,.]+|[,.]+$/g, "");

  if (!normalized) {
    return null;
  }

  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";

    normalized = normalized.replaceAll(thousandsSeparator, "");

    if (decimalSeparator === ",") {
      normalized = normalized.replace(",", ".");
    }
  } else if (lastComma !== -1) {
    normalized = normalized.replace(",", ".");
  }

  normalized = normalized.replace(/(?!^)-/g, "");

  if (!normalized || normalized === "-" || normalized === ".") {
    return null;
  }

  const numberValue = Number(normalized);

  if (!Number.isFinite(numberValue)) {
    return null;
  }

  return new Prisma.Decimal(numberValue);
}

function hasHeaderWords(value: string) {
  const normalized = normalizeHeader(value);

  return (
    normalized.includes("кодтовара") ||
    normalized.includes("наименование") ||
    normalized.includes("ценаза") ||
    normalized.includes("торговаямарка") ||
    normalized.includes("странапроизводителя") ||
    normalized.includes("фасовка")
  );
}

function looksLikeOnlyDigits(value: string) {
  return /^\d[\d\s./-]*$/.test(value.trim());
}

function rowLooksLikeData(row: unknown[]) {
  const values = row.map((cell) => normalizeCellValue(cell)).filter(Boolean);

  if (values.length === 0) {
    return false;
  }

  const numericCells = values.filter((value) => /^[\d\s.,/-]+$/.test(value)).length;
  const longTextCells = values.filter((value) => value.length > 20).length;

  return numericCells >= 2 || longTextCells >= 1;
}

function looksLikeSectionName(value: string) {
  const compactValue = value.trim();

  if (!compactValue || /\d/u.test(compactValue)) {
    return false;
  }

  if (/[",*]/u.test(compactValue)) {
    return false;
  }

  const words = compactValue.split(/\s+/u).filter(Boolean);

  if (words.length === 0 || words.length > 4) {
    return false;
  }

  return words.every((word) => /^[A-Za-zА-Яа-яЁё&.-]+$/u.test(word));
}

function inferUnitFromPackaging(value: string) {
  const normalized = normalizeHeader(value);

  if (!normalized) {
    return null;
  }

  if (
    normalized.includes("кг") ||
    normalized.includes("kg") ||
    normalized.includes("гр") ||
    normalized.includes("г") ||
    normalized.includes("л") ||
    normalized.includes("ml")
  ) {
    return "шт";
  }

  return null;
}

function shouldSkipRow(rowData: {
  resolvedName: string;
  articleValue: string;
  priceValue: string;
  brandValue: string;
  unitValue: string;
}) {
  return (
    hasHeaderWords(rowData.resolvedName) ||
    hasHeaderWords(rowData.articleValue) ||
    hasHeaderWords(rowData.priceValue) ||
    hasHeaderWords(rowData.brandValue) ||
    (!rowData.articleValue && !rowData.priceValue && !rowData.unitValue && looksLikeSectionName(rowData.resolvedName))
  );
}

function isTruthyFlag(value: string) {
  const normalized = normalizeHeader(value);
  return normalized === "v" || normalized === "true" || normalized === "yes" || normalized === "да" || normalized === "1";
}

function normalizeUnitValue(value: string) {
  const normalized = normalizeHeader(value);

  if (!normalized) {
    return null;
  }

  if (["шт", "штука", "штуки", "piece", "pieces", "pcs"].includes(normalized)) {
    return "шт";
  }

  if (["кг", "kilogram", "kilograms", "kg"].includes(normalized)) {
    return "кг";
  }

  if (["л", "литр", "литры", "liter", "litre", "liters", "litres", "l"].includes(normalized)) {
    return "л";
  }

  if (["уп", "упаковка", "упаковки", "pack", "package"].includes(normalized)) {
    return "уп";
  }

  return value.trim().toLowerCase();
}

function inferAllowFractionalOrder(unit: string | null, shipByBoxesOnly: boolean) {
  if (shipByBoxesOnly) {
    return false;
  }

  if (unit === "кг" || unit === "л") {
    return true;
  }

  return false;
}

function headerEqualsAny(header: string, candidates: string[]) {
  const normalizedHeader = normalizeHeader(header);
  return candidates.some((candidate) => normalizedHeader === normalizeHeader(candidate));
}

function findSupplierProfile(headers: string[]) {
  const normalizedHeaders = headers.map((header) => normalizeHeader(header));

  return (
    supplierProfiles.find((profile) =>
      profile.detectHeaders.every((expectedHeader) =>
        normalizedHeaders.some((header) => header.includes(normalizeHeader(expectedHeader))),
      ),
    ) ?? null
  );
}

function buildHeaderCandidates(rows: unknown[][], rowIndex: number, rowSpan = 2) {
  const selectedRows = Array.from({ length: rowSpan }, (_, offset) => rows[rowIndex + offset] ?? []);
  const maxLength = Math.max(...selectedRows.map((row) => row.length), 0);

  return Array.from({ length: maxLength }, (_, index) => {
    const parts = selectedRows
      .map((row) => normalizeCellValue(row[index]))
      .filter(Boolean)
      .filter((part, partIndex, values) => values.indexOf(part) === partIndex);

    return parts.join(" ").trim();
  });
}

function headerMatchesField(header: string, field: ParsedField, profile?: SupplierProfile | null) {
  if (profile?.exactFieldHeaders?.[field]?.length && headerEqualsAny(header, profile.exactFieldHeaders[field] ?? [])) {
    return true;
  }

  if (profile?.excludedNameHeaders?.length && field === "name" && headerEqualsAny(header, profile.excludedNameHeaders)) {
    return false;
  }

  const normalizedHeader = normalizeHeader(header);
  const headerTokens = normalizeHeaderTokens(header);

  return headerSynonyms[field].some((synonym) => {
    const normalizedSynonym = normalizeHeader(synonym);

    if (!normalizedSynonym) {
      return false;
    }

    if (normalizedSynonym.length <= 3) {
      return headerTokens.includes(normalizedSynonym);
    }

    return (
      normalizedHeader === normalizedSynonym ||
      normalizedHeader.includes(normalizedSynonym) ||
      headerTokens.includes(normalizedSynonym)
    );
  });
}

function matchFieldIndexes(candidateHeaders: string[], profile?: SupplierProfile | null) {
  const fieldIndexes: Partial<Record<ParsedField, number>> = {};
  let score = 0;

  candidateHeaders.forEach((header, cellIndex) => {
    for (const [field, exactHeaders] of Object.entries(profile?.exactFieldHeaders ?? {}) as Array<[ParsedField, string[]]>) {
      if (fieldIndexes[field] !== undefined || !exactHeaders?.length) {
        continue;
      }

      if (!headerEqualsAny(header, exactHeaders)) {
        continue;
      }

      fieldIndexes[field] = cellIndex;
      score += field === "name" || field === "price" ? 4 : 2;
    }

    for (const field of Object.keys(headerSynonyms) as ParsedField[]) {
      if (fieldIndexes[field] !== undefined) {
        continue;
      }

      if (field === "stock" && profile?.disableStockParsing) {
        continue;
      }

      if (!headerMatchesField(header, field, profile)) {
        continue;
      }

      fieldIndexes[field] = cellIndex;
      score += field === "name" || field === "price" ? 2 : 1;
    }
  });

  return { fieldIndexes, score };
}

function detectHeaderRow(rows: unknown[][]): HeaderMatchResult | null {
  let bestMatch: HeaderMatchResult | null = null;
  let bestScore = 0;

  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 15); rowIndex += 1) {
    const singleRowCandidate = buildHeaderCandidates(rows, rowIndex, 1);
    const candidates: Array<{ headers: string[]; span: number }> = [{ headers: singleRowCandidate, span: 1 }];

    for (let span = 2; span <= 4 && rowIndex + span - 1 < rows.length; span += 1) {
      if (rowLooksLikeData(rows[rowIndex + span - 1] ?? [])) {
        break;
      }

      candidates.push({ headers: buildHeaderCandidates(rows, rowIndex, span), span });
    }

    for (const candidate of candidates) {
      const profile = findSupplierProfile(candidate.headers);
      const { fieldIndexes, score } = matchFieldIndexes(candidate.headers, profile);

      if (fieldIndexes.name === undefined) {
        continue;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          headerRowIndex: rowIndex,
          headerRowSpan: candidate.span,
          fieldIndexes,
          supplierProfileId: profile?.id ?? null,
        };
      }
    }
  }

  return bestMatch;
}

async function parseWorkbookRows(filePath: string) {
  const fileBuffer = await readFile(filePath);
  const workbook = XLSX.read(fileBuffer, {
    type: "buffer",
    cellDates: true,
    raw: false,
  });

  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    return [];
  }

  const firstSheet = workbook.Sheets[firstSheetName];

  return XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,
  });
}

async function extractPdfLayoutText(filePath: string) {
  try {
    const result = await execFile("pdftotext", ["-layout", filePath, "-"], {
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });

    return result.stdout;
  } catch (error) {
    throw new Error(
      `Не удалось извлечь текст из PDF. Нужен установленный pdftotext. ${error instanceof Error ? error.message : ""}`.trim(),
    );
  }
}

function isPdfPriceValue(value: string) {
  return /^\d{1,3}(?: \d{3})*,\d{2}$/u.test(value.trim());
}

function isPdfHeaderLine(value: string) {
  const normalized = normalizeComparableText(value);

  if (!normalized) {
    return true;
  }

  if (
    normalized === 'ооо "продстар - торговый дом"' ||
    normalized === "прайс-лист" ||
    normalized === "наименование товаров" ||
    normalized === "цена"
  ) {
    return true;
  }

  if (normalized.includes("наименование товаров") && normalized.includes("цена")) {
    return true;
  }

  return /^\d{1,2} [а-яa-z]+ \d{4} г\.$/u.test(normalized);
}

function isPdfSectionLine(value: string) {
  const trimmed = value.trim();

  if (!trimmed || isPdfHeaderLine(trimmed) || /\d/u.test(trimmed)) {
    return false;
  }

  if (trimmed === trimmed.toUpperCase()) {
    return true;
  }

  const words = trimmed.split(/\s+/u).filter(Boolean);
  return words.length <= 6 && words.every((word) => /^[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё"-]*$/u.test(word));
}

function parsePdfRows(pdfText: string): { products: ParsedProductRow[]; skippedCount: number } {
  const products: ParsedProductRow[] = [];
  let skippedCount = 0;
  const rowPattern = /^(.+?)\s{2,}(\d{1,3}(?: \d{3})*,\d{2})\s+([A-Za-zА-Яа-я.]+)\s*$/u;
  const pages = pdfText.split("\f");

  pages.forEach((pageText, pageIndex) => {
    const lines = pageText
      .split(/\r?\n/u)
      .map((line) => line.replace(/\u00a0/gu, " ").replace(/\s+$/u, ""));
    let pendingName: string | null = null;

    lines.forEach((rawLine, lineIndex) => {
      const trimmed = rawLine.trim();

      if (!trimmed) {
        pendingName = null;
        return;
      }

      if (isPdfHeaderLine(trimmed) || isPdfSectionLine(trimmed) || isPdfPriceValue(trimmed)) {
        pendingName = null;
        return;
      }

      const match = trimmed.match(rowPattern);

      if (!match) {
        pendingName = pendingName ? `${pendingName} ${trimmed}`.replace(/\s+/gu, " ").trim() : trimmed;
        return;
      }

      const [, matchedName, matchedPrice, matchedUnit] = match;
      const resolvedName = [pendingName, matchedName].filter(Boolean).join(" ").replace(/\s+/gu, " ").trim();
      pendingName = null;
      const finalizedNameParts = cleanupPdfParsedParts(splitPdfNameBrandCountry(resolvedName));
      const unit = normalizeUnitValue(matchedUnit);
      const price = parseDecimal(matchedPrice);

      if (!finalizedNameParts.name || !price) {
        skippedCount += 1;
        return;
      }

      products.push({
        name: finalizedNameParts.name,
        article: null,
        brand: finalizedNameParts.brand,
        country: finalizedNameParts.country,
        unit,
        unitsPerPack: null,
        minOrderQuantity: null,
        orderStep: null,
        allowFractionalOrder: inferAllowFractionalOrder(unit, false),
        shipByBoxesOnly: false,
        price,
        stock: null,
        sourceRow: pageIndex * 1000 + lineIndex + 1,
        rawData: {
          pdfPage: String(pageIndex + 1),
          pdfLine: String(lineIndex + 1),
          name: resolvedName,
          price: matchedPrice,
          unit: matchedUnit,
        },
      });
    });
  });

  return { products, skippedCount };
}

function toRawData(headers: unknown[], row: unknown[]) {
  const rawData: Record<string, string> = {};

  headers.forEach((header, index) => {
    const key = normalizeCellValue(header) || `column_${index + 1}`;
    rawData[key] = normalizeCellValue(row[index]);
  });

  return rawData;
}

function findRawFieldValue(rawData: Record<string, string>, field: ParsedField, profile?: SupplierProfile | null) {
  if (profile?.exactFieldHeaders?.[field]?.length) {
    const exactValue = findRawFieldValueByHeaders(rawData, profile.exactFieldHeaders[field] ?? []);

    if (exactValue) {
      return exactValue;
    }
  }

  const entry = Object.entries(rawData).find(([header]) => headerMatchesField(header, field, profile));
  return entry?.[1] ?? "";
}

function findRawFieldValueByHeaders(rawData: Record<string, string>, headers: string[]) {
  const entry = Object.entries(rawData).find(([header]) => headerEqualsAny(header, headers));
  return entry?.[1] ?? "";
}

function findRawNameValue(rawData: Record<string, string>, profile?: SupplierProfile | null) {
  if (profile?.exactFieldHeaders?.name?.length) {
    const exactValue = findRawFieldValueByHeaders(rawData, profile.exactFieldHeaders.name);

    if (exactValue) {
      return exactValue;
    }
  }

  const exactNameEntry = Object.entries(rawData).find(([header]) => {
    const normalized = normalizeHeader(header);
    return normalized.includes("наименование") || normalized.includes("название");
  });

  if (exactNameEntry?.[1]) {
    return exactNameEntry[1];
  }

  return findRawFieldValue(rawData, "name", profile);
}

function hasRealProductPayload(product: Omit<ParsedProductRow, "sourceRow" | "rawData">) {
  return Boolean(product.article || product.price || product.stock || product.brand);
}

function parseRows(rows: unknown[][]): { products: ParsedProductRow[]; skippedCount: number } {
  const headerMatch = detectHeaderRow(rows);

  if (!headerMatch) {
    throw new Error("Не удалось определить строку заголовков в прайсе.");
  }

  const headers =
    headerMatch.headerRowSpan > 1
      ? buildHeaderCandidates(rows, headerMatch.headerRowIndex, headerMatch.headerRowSpan)
      : (rows[headerMatch.headerRowIndex] ?? []).map((cell) => normalizeCellValue(cell));
  const supplierProfile =
    supplierProfiles.find((profile) => profile.id === headerMatch.supplierProfileId) ?? null;
  const products: ParsedProductRow[] = [];
  let skippedCount = 0;

  for (let rowIndex = headerMatch.headerRowIndex + headerMatch.headerRowSpan; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const rawData = toRawData(headers, row);

    if (!Object.values(rawData).some(Boolean)) {
      continue;
    }

    const nameValue = headerMatch.fieldIndexes.name === undefined ? "" : normalizeCellValue(row[headerMatch.fieldIndexes.name]);
    const articleValue =
      headerMatch.fieldIndexes.article === undefined ? "" : normalizeCellValue(row[headerMatch.fieldIndexes.article]);
    const brandValue = headerMatch.fieldIndexes.brand === undefined ? "" : normalizeCellValue(row[headerMatch.fieldIndexes.brand]);
    const countryValue =
      headerMatch.fieldIndexes.country === undefined ? "" : normalizeCellValue(row[headerMatch.fieldIndexes.country]);
    const unitValue = headerMatch.fieldIndexes.unit === undefined ? "" : normalizeCellValue(row[headerMatch.fieldIndexes.unit]);
    const packagingValue =
      headerMatch.fieldIndexes.packaging === undefined ? "" : normalizeCellValue(row[headerMatch.fieldIndexes.packaging]);
    const minOrderValue =
      headerMatch.fieldIndexes.minOrderQuantity === undefined
        ? ""
        : normalizeCellValue(row[headerMatch.fieldIndexes.minOrderQuantity]);
    const unitsPerPackValue =
      headerMatch.fieldIndexes.unitsPerPack === undefined
        ? ""
        : normalizeCellValue(row[headerMatch.fieldIndexes.unitsPerPack]);
    const shipByBoxesOnlyValue =
      headerMatch.fieldIndexes.shipByBoxesOnly === undefined
        ? ""
        : normalizeCellValue(row[headerMatch.fieldIndexes.shipByBoxesOnly]);
    const priceValue = headerMatch.fieldIndexes.price === undefined ? "" : normalizeCellValue(row[headerMatch.fieldIndexes.price]);
    const stockValue = headerMatch.fieldIndexes.stock === undefined ? "" : normalizeCellValue(row[headerMatch.fieldIndexes.stock]);

    const rawNameValue = findRawNameValue(rawData, supplierProfile);
    const resolvedName =
      !nameValue || nameValue === articleValue || looksLikeOnlyDigits(nameValue) ? rawNameValue || nameValue : nameValue;
    const inferredUnitFromPackaging = inferUnitFromPackaging(packagingValue || findRawFieldValue(rawData, "packaging", supplierProfile));
    const unit = normalizeUnitValue(unitValue || findRawFieldValue(rawData, "unit", supplierProfile)) ?? inferredUnitFromPackaging;
    const inferredUnitsPerPackFromName = inferUnitsPerPackFromName(resolvedName);
    const unitsPerPack =
      parseDecimal(unitsPerPackValue) ??
      parseDecimal(findRawFieldValue(rawData, "unitsPerPack", supplierProfile)) ??
      inferredUnitsPerPackFromName;
    const minOrderQuantity =
      parseDecimal(minOrderValue) ?? parseDecimal(findRawFieldValue(rawData, "minOrderQuantity", supplierProfile));
    const shipUnitValue =
      supplierProfile?.rawHeaderAliases?.shipByBoxesOnly?.length
        ? findRawFieldValueByHeaders(rawData, supplierProfile.rawHeaderAliases.shipByBoxesOnly)
        : findRawFieldValue(rawData, "shipByBoxesOnly", supplierProfile);
    const shipByBoxesOnly =
      normalizeHeader(shipUnitValue) === normalizeHeader("КОР") ||
      isTruthyFlag(shipByBoxesOnlyValue || findRawFieldValue(rawData, "shipByBoxesOnly", supplierProfile));
    const allowFractionalOrder = inferAllowFractionalOrder(unit, shipByBoxesOnly);

    if (
      shouldSkipRow({
        resolvedName,
        articleValue,
        priceValue,
        brandValue,
        unitValue,
      })
    ) {
      skippedCount += 1;
      continue;
    }

    const orderStep = shipByBoxesOnly ? unitsPerPack ?? minOrderQuantity : minOrderQuantity;

    const directBrand = normalizeOptionalProductText(brandValue || findRawFieldValue(rawData, "brand", supplierProfile));
    const directCountry = normalizeOptionalProductText(countryValue || findRawFieldValue(rawData, "country", supplierProfile));
    const parsedNameParts = repairQuotedBrandParts(
      resolvedName,
      splitNameBrandCountry(resolvedName, directBrand, directCountry),
    );

    const parsedProduct = {
      name: parsedNameParts.name,
      article: articleValue || findRawFieldValue(rawData, "article", supplierProfile) || null,
      brand: parsedNameParts.brand,
      country: parsedNameParts.country,
      unit,
      unitsPerPack: unitsPerPack ?? inferredUnitsPerPackFromName,
      minOrderQuantity,
      orderStep,
      allowFractionalOrder,
      shipByBoxesOnly,
      price: parseDecimal(priceValue) ?? parseDecimal(findRawFieldValue(rawData, "price", supplierProfile)),
      stock:
        supplierProfile?.disableStockParsing
          ? null
          : parseDecimal(stockValue) ?? parseDecimal(findRawFieldValue(rawData, "stock", supplierProfile)),
    };
    const finalizedNameParts = finalizeParsedNameParts({
      name: parsedProduct.name,
      brand: parsedProduct.brand,
      country: parsedProduct.country,
    });
    const product = {
      ...parsedProduct,
      name: finalizedNameParts.name,
      brand: finalizedNameParts.brand,
      country: finalizedNameParts.country,
    };
    const finalizedUnitsPerPack =
      product.unitsPerPack ??
      inferUnitsPerPackFromName(product.name) ??
      inferUnitsPerPackFromName(rawNameValue || resolvedName);

    if (!product.name || !hasRealProductPayload(product)) {
      skippedCount += 1;
      continue;
    }

    products.push({
      ...product,
      unitsPerPack: finalizedUnitsPerPack,
      rawData: {
        ...rawData,
        unitsPerPack: finalizedUnitsPerPack?.toString() ?? rawData.unitsPerPack ?? "",
        minOrderQuantity: product.minOrderQuantity?.toString() ?? rawData.minOrderQuantity ?? "",
        orderStep: product.orderStep?.toString() ?? "",
        allowFractionalOrder: product.allowFractionalOrder ? "true" : "false",
        shipByBoxesOnly: product.shipByBoxesOnly ? "true" : "",
      },
      sourceRow: rowIndex + 1,
    });
  }

  return { products, skippedCount };
}

export async function parsePriceDocument(documentId: string): Promise<ParseDocumentResult> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!document) {
    throw new Error("Документ не найден.");
  }

  if (!["excel", "csv", "pdf"].includes(document.sourceFormat)) {
    await prisma.document.update({
      where: { id: documentId },
      data: { status: "failed", isCurrent: false },
    });

    return {
      parsedCount: 0,
      skippedCount: 0,
      status: "failed",
      message: "На этом этапе разбор поддерживается только для Excel и CSV.",
    };
  }

  await prisma.document.update({
    where: { id: documentId },
    data: { status: "processing" },
  });

  try {
    const absolutePath = path.join(/* turbopackIgnore: true */ process.cwd(), document.storedFilePath);
    const { products, skippedCount } =
      document.sourceFormat === "pdf"
        ? parsePdfRows(await extractPdfLayoutText(absolutePath))
        : parseRows(await parseWorkbookRows(absolutePath));

    if (products.length === 0) {
      await prisma.document.update({
        where: { id: documentId },
        data: { status: "failed", isCurrent: false },
      });

      return {
        parsedCount: 0,
        skippedCount,
        status: "failed",
        message: "В прайсе не найдено ни одной валидной товарной строки.",
      };
    }

    await prisma.$transaction(async (tx) => {
      await tx.product.deleteMany({
        where: {
          documentId: document.id,
        },
      });

      await tx.document.updateMany({
        where: {
          enterpriseId: document.enterpriseId,
          supplierId: document.supplierId,
        },
        data: { isCurrent: false },
      });

      await tx.product.createMany({
        data: products.map((product) => ({
          enterpriseId: document.enterpriseId,
          supplierId: document.supplierId,
          documentId: document.id,
          name: product.name,
          article: product.article,
          brand: product.brand,
          country: product.country,
          unit: product.unit,
          unitsPerPack: product.unitsPerPack?.toString() ?? null,
          minOrderQuantity: product.minOrderQuantity?.toString() ?? null,
          orderStep: product.orderStep?.toString() ?? null,
          allowFractionalOrder: product.allowFractionalOrder,
          shipByBoxesOnly: product.shipByBoxesOnly,
          price: product.price?.toString() ?? null,
          stock: product.stock?.toString() ?? null,
          sourceRow: product.sourceRow,
          rawData: product.rawData,
        })),
      });

      await tx.document.update({
        where: { id: document.id },
        data: {
          status: skippedCount > 0 ? "parsed_with_errors" : "parsed",
          isCurrent: true,
        },
      });
    });

    try {
      await syncCatalogForDocument({
        prisma,
        documentId: document.id,
        syncSource: "parse_auto",
      });

      await upsertDocumentQualityReport(document.id);
    } catch (syncError) {
      console.error("CATALOG_SYNC_AFTER_PARSE_ERROR", {
        documentId: document.id,
        supplierId: document.supplierId,
        enterpriseId: document.enterpriseId,
        error: syncError,
      });

      await prisma.document.update({
        where: { id: document.id },
        data: {
          status: "parsed_with_errors",
          isCurrent: true,
        },
      });

      return {
        parsedCount: products.length,
        skippedCount,
        status: "parsed_with_errors",
        message:
          syncError instanceof Error
            ? `Прайс распарсен, но синхронизация новой catalog-модели упала: ${syncError.message}`
            : "Прайс распарсен, но синхронизация новой catalog-модели упала.",
      };
    }

    return {
      parsedCount: products.length,
      skippedCount,
      status: skippedCount > 0 ? "parsed_with_errors" : "parsed",
    };
  } catch (error) {
    await prisma.document.update({
      where: { id: documentId },
      data: { status: "failed", isCurrent: false },
    });

    return {
      parsedCount: 0,
      skippedCount: 0,
      status: "failed",
      message: error instanceof Error ? error.message : "Не удалось разобрать прайс.",
    };
  }
}
