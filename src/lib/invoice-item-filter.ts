const BLACKLIST_WORDS = [
  "покупатель",
  "поставщик",
  "инн",
  "кпп",
  "адрес",
  "валюта",
  "счет-фактура",
  "счёт-фактура",
  "товарная накладная",
  "исправление",
  "страница",
  "дата",
  "грузополучатель",
  "грузоотправитель",
  "подпись",
  "основание",
  "договор",
  "итого",
  "всего",
  "ндс",
  "окпо",
];

export type InvoiceItemFilterInput = {
  name?: string | null;
  productNameRaw?: string | null;
  quantity?: unknown;
  priceWithVat?: unknown;
  lineTotal?: unknown;
};

export type RejectedInvoiceItemLine = {
  name: string;
  reason: string;
};

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function getItemName(item: InvoiceItemFilterInput) {
  return String(item.name ?? item.productNameRaw ?? "").trim();
}

function hasValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return false;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value === "object" && value && "toString" in value) {
    const asNumber = Number(String(value));
    return Number.isFinite(asNumber);
  }

  const asNumber = Number(String(value).replace(",", "."));
  return Number.isFinite(asNumber);
}

function getSpecialSymbolsRatio(value: string) {
  if (!value) {
    return 1;
  }

  const specialCount = (value.match(/[^\p{L}\p{N}\s%.,/+()-]/gu) ?? []).length;
  return specialCount / value.length;
}

function looksLikeDateOrNumber(value: string) {
  const normalized = value.trim();

  return (
    /^[\d\s.,:/№#-]+$/u.test(normalized) ||
    /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/u.test(normalized) ||
    /\b\d{6,}\b/u.test(normalized)
  );
}

function looksLikeAddress(value: string) {
  return /\b(ул\.?|улица|проспект|пр-т|дом|д\.|офис|корпус|кв\.|г\.|город|обл\.|район)\b/iu.test(value);
}

function getRejectReason(item: InvoiceItemFilterInput) {
  const name = getItemName(item);
  const normalizedName = normalizeText(name);
  const lettersCount = (name.match(/\p{L}/gu) ?? []).length;

  if (!name) {
    return "нет названия";
  }

  if (name.length < 4 || lettersCount < 3) {
    return "слишком короткое название";
  }

  if (BLACKLIST_WORDS.some((word) => normalizedName.includes(word))) {
    return "служебная строка или реквизиты";
  }

  if (getSpecialSymbolsRatio(name) > 0.35) {
    return "слишком много спецсимволов";
  }

  if (lettersCount / Math.max(name.length, 1) < 0.25) {
    return "мало букв";
  }

  if (looksLikeDateOrNumber(name)) {
    return "похоже на номер или дату";
  }

  if (looksLikeAddress(normalizedName)) {
    return "похоже на адрес";
  }

  if (!hasValue(item.quantity)) {
    return "нет количества";
  }

  if (!hasValue(item.priceWithVat) && !hasValue(item.lineTotal)) {
    return "нет цены или суммы";
  }

  return null;
}

export function filterInvoiceItems<T extends InvoiceItemFilterInput>(items: T[]) {
  const accepted: T[] = [];
  const rejected: RejectedInvoiceItemLine[] = [];

  for (const item of items) {
    const reason = getRejectReason(item);

    if (reason) {
      rejected.push({
        name: getItemName(item).slice(0, 200),
        reason,
      });
      continue;
    }

    accepted.push(item);
  }

  return {
    accepted,
    rejected,
  };
}
