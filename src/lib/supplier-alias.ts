export function normalizeSupplierAliasValue(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[ё]/g, "е")
    .replace(/["'`«»“”„]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
