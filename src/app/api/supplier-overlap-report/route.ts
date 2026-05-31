import { jsonUtf8 } from "@/lib/http";
import { ensureEnterpriseExists } from "@/lib/orders";
import { buildSupplierOverlapReport } from "@/lib/supplier-overlap-report";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "РџР°СЂР°РјРµС‚СЂ enterpriseId РѕР±СЏР·Р°С‚РµР»РµРЅ." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "РџСЂРµРґРїСЂРёСЏС‚РёРµ РЅРµ РЅР°Р№РґРµРЅРѕ." }, { status: 404 });
  }

  return jsonUtf8(await buildSupplierOverlapReport(enterpriseId));
}
