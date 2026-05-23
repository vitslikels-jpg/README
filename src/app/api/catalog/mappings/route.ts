import { jsonUtf8 } from "@/lib/http";
import { createManualProductMapping } from "@/lib/product-catalog";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | {
        supplierOfferId?: string;
        productMasterId?: string;
      }
    | null;

  const supplierOfferId = body?.supplierOfferId?.trim();
  const productMasterId = body?.productMasterId?.trim();

  if (!supplierOfferId || !productMasterId) {
    return jsonUtf8(
      { message: "Поля supplierOfferId и productMasterId обязательны." },
      { status: 400 },
    );
  }

  try {
    const mapping = await createManualProductMapping({
      supplierOfferId,
      productMasterId,
    });

    return jsonUtf8(mapping, { status: 201 });
  } catch (error) {
    return jsonUtf8(
      { message: error instanceof Error ? error.message : "Не удалось создать manual mapping." },
      { status: 400 },
    );
  }
}
