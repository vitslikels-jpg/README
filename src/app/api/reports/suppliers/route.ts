import { jsonUtf8 } from "@/lib/http";
import { buildSuppliersReport } from "@/lib/reports/suppliers";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();
  const periodRaw = searchParams.get("period")?.trim() ?? "7d";
  const dateFrom = searchParams.get("dateFrom")?.trim() ?? null;
  const dateTo = searchParams.get("dateTo")?.trim() ?? null;

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const result = await buildSuppliersReport({
    enterpriseId,
    periodRaw,
    dateFrom,
    dateTo,
  });

  if (!result.ok) {
    return jsonUtf8({ message: result.message }, { status: result.status });
  }

  return jsonUtf8(result.data);
}
