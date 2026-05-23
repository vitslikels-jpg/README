import { jsonUtf8 } from "@/lib/http";
import { listUnmappedSupplierOffers } from "@/lib/product-catalog";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();
  const search = searchParams.get("search")?.trim() ?? "";
  const supplierId = searchParams.get("supplierId")?.trim() ?? "";
  const unitId = searchParams.get("unitId")?.trim() ?? "";

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const offers = await listUnmappedSupplierOffers({
    enterpriseId,
    search,
    supplierId,
    unitId,
  });
  return jsonUtf8(offers);
}
