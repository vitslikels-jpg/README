import { normalizeCatalogText } from "@/lib/catalog-model.shared.js";

export function normalizeSupplierAliasValue(value: string | null | undefined) {
  return normalizeCatalogText(value)
    .replace(/\s+/g, " ")
    .trim();
}
