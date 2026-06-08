type VatFieldsInput = {
  priceWithoutVat: number | null;
  priceWithVat: number | null;
  vatRate: number | null;
};

type DerivedVatFields = {
  priceWithoutVat: number | null;
  priceWithVat: number | null;
  vatRate: number | null;
  derivedPriceWithoutVat: boolean;
  derivedPriceWithVat: boolean;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function deriveVatFields(input: VatFieldsInput): DerivedVatFields {
  const { vatRate } = input;
  let priceWithoutVat = input.priceWithoutVat;
  let priceWithVat = input.priceWithVat;
  let derivedPriceWithoutVat = false;
  let derivedPriceWithVat = false;

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

  return {
    priceWithoutVat,
    priceWithVat,
    vatRate,
    derivedPriceWithoutVat,
    derivedPriceWithVat,
  };
}
