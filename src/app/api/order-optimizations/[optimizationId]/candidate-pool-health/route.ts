import { jsonUtf8 } from "@/lib/http";
import { buildCandidatePoolHealthReport, getOrderOptimizationWithDetails } from "@/lib/order-optimizations";
import { ensureEnterpriseExists } from "@/lib/orders";

type RouteContext = {
  params: Promise<{
    optimizationId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { optimizationId } = await context.params;
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "РџР°СЂР°РјРµС‚СЂ enterpriseId РѕР±СЏР·Р°С‚РµР»РµРЅ." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "РџСЂРµРґРїСЂРёСЏС‚РёРµ РЅРµ РЅР°Р№РґРµРЅРѕ." }, { status: 404 });
  }

  const optimization = await getOrderOptimizationWithDetails(optimizationId, enterpriseId);

  if (!optimization) {
    return jsonUtf8({ message: "РЈРјРЅС‹Р№ Р·Р°РєР°Р· РЅРµ РЅР°Р№РґРµРЅ." }, { status: 404 });
  }

  return jsonUtf8(buildCandidatePoolHealthReport(optimization));
}
