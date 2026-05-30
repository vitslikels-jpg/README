import { jsonUtf8 } from "@/lib/http";
import { buildSupplierOptimizerPreview, getOrderOptimizationWithDetails } from "@/lib/order-optimizations";
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
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  const optimization = await getOrderOptimizationWithDetails(optimizationId, enterpriseId);

  if (!optimization) {
    return jsonUtf8({ message: "Умный заказ не найден." }, { status: 404 });
  }

  return jsonUtf8(buildSupplierOptimizerPreview(optimization));
}
