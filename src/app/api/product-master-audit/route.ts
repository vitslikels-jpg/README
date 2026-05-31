import { jsonUtf8 } from "@/lib/http";
import { ensureEnterpriseExists } from "@/lib/orders";
import { buildProductMasterAuditReport } from "@/lib/product-master-audit";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  return jsonUtf8(await buildProductMasterAuditReport(enterpriseId));
}
