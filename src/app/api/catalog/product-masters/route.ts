import { jsonUtf8 } from "@/lib/http";
import { createProductMaster, listCatalogProductMasters } from "@/lib/product-catalog";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();
  const search = searchParams.get("search")?.trim() ?? "";

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const productMasters = await listCatalogProductMasters(enterpriseId, search);
  return jsonUtf8(productMasters);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | {
        enterpriseId?: string;
        name?: string;
        unitId?: string | null;
        brand?: string | null;
        category?: string | null;
      }
    | null;

  const enterpriseId = body?.enterpriseId?.trim();
  const name = body?.name?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Поле enterpriseId обязательно." }, { status: 400 });
  }

  if (!name) {
    return jsonUtf8({ message: "Поле name обязательно." }, { status: 400 });
  }

  try {
    const result = await createProductMaster({
      enterpriseId,
      name,
      unitId: body?.unitId ?? null,
      brand: body?.brand ?? null,
      category: body?.category ?? null,
    });

    return jsonUtf8(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return jsonUtf8(
      { message: error instanceof Error ? error.message : "Не удалось создать ProductMaster." },
      { status: 400 },
    );
  }
}
