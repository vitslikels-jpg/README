import { Prisma } from "@prisma/client";
import { jsonUtf8 } from "@/lib/http";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
    itemId: string;
  }>;
};

type PatchBody = {
  enterpriseId?: string;
  matchedProductId?: string | null;
  productNameRaw?: string | null;
  quantity?: string | number | null;
  unit?: string | null;
  priceWithVat?: string | number | null;
  lineTotal?: string | number | null;
  vatRate?: string | number | null;
};

function parseDecimalField(value: string | number | null | undefined, fieldName: string, scale: number) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === "") {
    return null;
  }

  const normalized = typeof value === "number" ? String(value) : value.trim().replace(",", ".");
  const numericValue = Number(normalized);

  if (!Number.isFinite(numericValue)) {
    throw new Error(`Поле ${fieldName} должно быть числом.`);
  }

  if (numericValue < 0) {
    throw new Error(`Поле ${fieldName} не может быть отрицательным.`);
  }

  return new Prisma.Decimal(normalized).toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP);
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id, itemId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as PatchBody;
  const enterpriseId = body.enterpriseId?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Поле enterpriseId обязательно." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  const invoice = await prisma.invoiceDocument.findFirst({
    where: {
      id,
      enterpriseId,
    },
    select: {
      id: true,
    },
  });

  if (!invoice) {
    return jsonUtf8({ message: "Накладная не найдена." }, { status: 404 });
  }

  const item = await prisma.invoiceItem.findFirst({
    where: {
      id: itemId,
      invoiceDocumentId: id,
    },
    select: {
      id: true,
      productNameRaw: true,
      matchedProductId: true,
      quantity: true,
      unit: true,
      priceWithVat: true,
      lineTotal: true,
      vatRate: true,
      confidence: true,
    },
  });

  if (!item) {
    return jsonUtf8({ message: "Строка накладной не найдена." }, { status: 404 });
  }

  const hasMatchedProductId = Object.prototype.hasOwnProperty.call(body, "matchedProductId");
  const hasProductNameRaw = Object.prototype.hasOwnProperty.call(body, "productNameRaw");
  const hasQuantity = Object.prototype.hasOwnProperty.call(body, "quantity");
  const hasUnit = Object.prototype.hasOwnProperty.call(body, "unit");
  const hasPriceWithVat = Object.prototype.hasOwnProperty.call(body, "priceWithVat");
  const hasLineTotal = Object.prototype.hasOwnProperty.call(body, "lineTotal");
  const hasVatRate = Object.prototype.hasOwnProperty.call(body, "vatRate");

  if (!hasMatchedProductId && !hasProductNameRaw && !hasQuantity && !hasUnit && !hasPriceWithVat && !hasLineTotal && !hasVatRate) {
    return jsonUtf8({ message: "Нет полей для обновления." }, { status: 400 });
  }

  const matchedProductId = hasMatchedProductId
    ? body.matchedProductId === null
      ? null
      : typeof body.matchedProductId === "string"
        ? body.matchedProductId.trim()
        : undefined
    : item.matchedProductId;

  if (hasMatchedProductId && matchedProductId === undefined) {
    return jsonUtf8({ message: "Поле matchedProductId некорректно." }, { status: 400 });
  }

  if (matchedProductId) {
    const product = await prisma.product.findFirst({
      where: {
        id: matchedProductId,
        enterpriseId,
      },
      select: {
        id: true,
      },
    });

    if (!product) {
      return jsonUtf8({ message: "Товар не найден в текущем предприятии." }, { status: 400 });
    }
  }

  const productNameRaw = hasProductNameRaw
    ? typeof body.productNameRaw === "string"
      ? body.productNameRaw.trim()
      : ""
    : item.productNameRaw;

  if (!productNameRaw) {
    return jsonUtf8({ message: "Название товара не может быть пустым." }, { status: 400 });
  }

  let quantity = item.quantity;
  let priceWithVat = item.priceWithVat;
  let lineTotal = item.lineTotal;
  let vatRate = item.vatRate;

  try {
    if (hasQuantity) {
      quantity = parseDecimalField(body.quantity, "quantity", 3) ?? null;
    }

    if (hasPriceWithVat) {
      priceWithVat = parseDecimalField(body.priceWithVat, "priceWithVat", 2) ?? null;
    }

    if (hasLineTotal) {
      lineTotal = parseDecimalField(body.lineTotal, "lineTotal", 2) ?? null;
    }

    if (hasVatRate) {
      vatRate = parseDecimalField(body.vatRate, "vatRate", 2) ?? null;
    }
  } catch (error) {
    return jsonUtf8(
      { message: error instanceof Error ? error.message : "Некорректные числовые значения." },
      { status: 400 },
    );
  }

  const unit = hasUnit ? (typeof body.unit === "string" ? body.unit.trim() || null : null) : item.unit;
  const hasStructuredFields = quantity !== null && Boolean(unit) && priceWithVat !== null;
  const needsReview = !(Boolean(matchedProductId) && hasStructuredFields);
  const confidence = matchedProductId
    ? needsReview
      ? item.confidence
      : Math.max(item.confidence ?? 0, 0.9)
    : hasMatchedProductId
      ? Math.min(item.confidence ?? 0.5, 0.5)
      : item.confidence;

  const updatedItem = await prisma.invoiceItem.update({
    where: {
      id: itemId,
    },
    data: {
      ...(hasMatchedProductId ? { matchedProductId } : {}),
      ...(hasProductNameRaw ? { productNameRaw } : {}),
      ...(hasQuantity ? { quantity } : {}),
      ...(hasUnit ? { unit } : {}),
      ...(hasPriceWithVat ? { priceWithVat } : {}),
      ...(hasLineTotal ? { lineTotal } : {}),
      ...(hasVatRate ? { vatRate } : {}),
      needsReview,
      confidence,
    },
    include: {
      matchedProduct: {
        select: {
          id: true,
          name: true,
          article: true,
          brand: true,
        },
      },
    },
  });

  return jsonUtf8({
    item: {
      id: updatedItem.id,
      productNameRaw: updatedItem.productNameRaw,
      matchedProductId: updatedItem.matchedProductId,
      matchedProductName: updatedItem.matchedProduct?.name ?? null,
      matchedProductArticle: updatedItem.matchedProduct?.article ?? null,
      matchedProductBrand: updatedItem.matchedProduct?.brand ?? null,
      quantity: updatedItem.quantity?.toString() ?? null,
      unit: updatedItem.unit,
      priceWithVat: updatedItem.priceWithVat?.toString() ?? null,
      lineTotal: updatedItem.lineTotal?.toString() ?? null,
      vatRate: updatedItem.vatRate?.toString() ?? null,
      confidence: updatedItem.confidence,
      needsReview: updatedItem.needsReview,
    },
  });
}
