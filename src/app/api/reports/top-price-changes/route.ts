import { jsonUtf8 } from "@/lib/http";
import { buildTopPriceChangesReport } from "@/lib/reports/top-price-changes";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();
  const periodRaw = searchParams.get("period")?.trim() ?? "7d";
  const dateFrom = searchParams.get("dateFrom")?.trim() ?? null;
  const dateTo = searchParams.get("dateTo")?.trim() ?? null;
  const supplierId = searchParams.get("supplierId")?.trim() ?? "";
  const query = searchParams.get("q")?.trim() ?? "";

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const result = await buildTopPriceChangesReport({
    enterpriseId,
    periodRaw,
    dateFrom,
    dateTo,
    supplierId,
    query,
  });

  if (!result.ok) {
    return jsonUtf8({ message: result.message }, { status: result.status });
  }

  return jsonUtf8(result.data);
}
