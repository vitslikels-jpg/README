type InvoicePriceLayoutProfile = "unit_without_vat_plus_line_total_with_vat";

type InvoiceLinePriceInput = {
  supplierName?: string | null;
  quantity: number | null;
  priceWithoutVat: number | null;
  priceWithVat: number | null;
  vatRate: number | null;
  lineTotal: number | null;
};

type InvoiceLinePriceNormalizationResult = {
  priceWithoutVat: number | null;
  priceWithVat: number | null;
  vatRate: number | null;
  lineTotal: number | null;
  profile: InvoicePriceLayoutProfile | null;
  derivedPriceWithoutVat: boolean;
  derivedPriceWithVat: boolean;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function detectInvoicePriceLayoutProfile(supplierName?: string | null): InvoicePriceLayoutProfile | null {
  const normalizedSupplierName = String(supplierName ?? "").toLowerCase();

  if (
    normalizedSupplierName.includes("хорека") ||
    normalizedSupplierName.includes("horeca") ||
    normalizedSupplierName.includes("хорека мдц")
  ) {
    return "unit_without_vat_plus_line_total_with_vat";
  }

  return null;
}

export function normalizeInvoiceLinePrices(input: InvoiceLinePriceInput): InvoiceLinePriceNormalizationResult {
  const profile = detectInvoicePriceLayoutProfile(input.supplierName);
  const quantity = input.quantity !== null && input.quantity > 0 ? input.quantity : null;
  let vatRate = input.vatRate;
  const lineTotal = input.lineTotal;

  let priceWithoutVat = input.priceWithoutVat;
  let priceWithVat = input.priceWithVat;
  let derivedPriceWithoutVat = false;
  let derivedPriceWithVat = false;

  if (quantity !== null && lineTotal !== null) {
    const unitPriceFromLineTotal = roundMoney(lineTotal / quantity);

    if (profile === "unit_without_vat_plus_line_total_with_vat") {
      if (priceWithVat === null || Math.abs(priceWithVat - unitPriceFromLineTotal) > 0.01) {
        priceWithVat = unitPriceFromLineTotal;
        derivedPriceWithVat = true;
      }
    } else if (priceWithVat === null) {
      priceWithVat = unitPriceFromLineTotal;
      derivedPriceWithVat = true;
    }
  }

  if (vatRate !== null && vatRate >= 0) {
    const multiplier = 1 + vatRate / 100;

    if (priceWithVat === null && priceWithoutVat !== null && multiplier > 0) {
      priceWithVat = roundMoney(priceWithoutVat * multiplier);
      derivedPriceWithVat = true;
    }

    if (priceWithoutVat === null && priceWithVat !== null && multiplier > 0) {
      priceWithoutVat = roundMoney(priceWithVat / multiplier);
      derivedPriceWithoutVat = true;
    }
  }

  if (vatRate === null && priceWithoutVat !== null && priceWithoutVat > 0 && priceWithVat !== null) {
    vatRate = roundMoney(((priceWithVat / priceWithoutVat) - 1) * 100);
  }

  return {
    priceWithoutVat,
    priceWithVat,
    vatRate,
    lineTotal,
    profile,
    derivedPriceWithoutVat,
    derivedPriceWithVat,
  };
}
