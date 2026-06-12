function normalizeLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return values.filter((value, index, array): value is string => Boolean(value) && array.indexOf(value) === index);
}

export type InvoiceSupplierDetails = {
  supplierName: string | null;
  legalName: string | null;
  inn: string | null;
  aliases: string[];
};

export function extractInvoiceSupplierDetails(rawText: string | null | undefined, detectedSupplierName: string | null | undefined): InvoiceSupplierDetails {
  const normalizedDetectedName = normalizeLine(detectedSupplierName ?? "") || null;
  const text = rawText ?? "";
  const lines = text
    .split(/\r?\n/)
    .map((line) => normalizeLine(line))
    .filter(Boolean);

  const legalNameLine =
    lines.find((line) => /\b(ооо|ип|ао|пао|зао|оао)\b/i.test(line) && /[а-яa-z]/i.test(line)) ?? normalizedDetectedName;

  const supplierName = normalizedDetectedName ?? legalNameLine ?? null;
  const legalName = legalNameLine ?? supplierName ?? null;

  const innMatch =
    text.match(/(?:\bинн\b[\s:№-]*)?(\d{10}|\d{12})\b/i) ??
    lines.map((line) => line.match(/\b(\d{10}|\d{12})\b/)).find(Boolean) ??
    null;
  const inn = innMatch?.[1] ?? null;

  const aliases = uniqueStrings([supplierName, legalName]);

  return {
    supplierName,
    legalName,
    inn,
    aliases,
  };
}
