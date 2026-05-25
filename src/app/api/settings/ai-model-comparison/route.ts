import { compareProductIdentityModels } from "@/lib/product-identity-refiner.mjs";
import { jsonUtf8 } from "@/lib/http";

export const runtime = "nodejs";

type ComparisonRequestBody = {
  rawName?: string;
  rawCountry?: string;
  rawBrand?: string;
  supplierName?: string;
  models?: string[];
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as ComparisonRequestBody | null;
  const rawName = body?.rawName?.trim() ?? "";
  const models = Array.isArray(body?.models)
    ? body.models.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];

  if (!rawName) {
    return jsonUtf8({ message: "Нужно передать строку товара для сравнения." }, { status: 400 });
  }

  if (models.length === 0) {
    return jsonUtf8({ message: "Нужно передать хотя бы одну модель." }, { status: 400 });
  }

  if (!process.env.POLZA_AI_API_KEY?.trim()) {
    return jsonUtf8({ message: "POLZA_AI_API_KEY не настроен." }, { status: 400 });
  }

  const results = await compareProductIdentityModels(
    {
      rawName,
      parsedName: rawName,
      brand: body?.rawBrand?.trim() || null,
      country: null,
      rawBrand: body?.rawBrand?.trim() || null,
      rawCountry: body?.rawCountry?.trim() || null,
      supplierName: body?.supplierName?.trim() || "Красный Дракон",
      disableAi: false,
    },
    models,
  );

  return jsonUtf8({
    rawName,
    rawCountry: body?.rawCountry?.trim() || null,
    rawBrand: body?.rawBrand?.trim() || null,
    supplierName: body?.supplierName?.trim() || "Красный Дракон",
    results,
  });
}
