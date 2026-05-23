import { jsonUtf8 } from "@/lib/http";
import { searchOrderOptimizationItemCandidates } from "@/lib/order-optimization-matching";
import { serializeOrderOptimizationResult } from "@/lib/order-optimizations";
import { ensureEnterpriseExists } from "@/lib/orders";

type RouteContext = {
  params: Promise<{
    optimizationId: string;
    itemId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { optimizationId, itemId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    enterpriseId?: string;
    query?: string;
  };
  const enterpriseId = body.enterpriseId?.trim();
  const query = body.query?.trim() ?? "";

  if (!enterpriseId) {
    return jsonUtf8({ message: "Поле enterpriseId обязательно." }, { status: 400 });
  }

  if (!query) {
    return jsonUtf8({ results: [] });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  const results = await searchOrderOptimizationItemCandidates({
    optimizationId,
    itemId,
    enterpriseId,
    query,
  });

  if (!results) {
    return jsonUtf8({ message: "Позиция умного заказа не найдена." }, { status: 404 });
  }

  return jsonUtf8({
    results: results.map(serializeOrderOptimizationResult),
  });
}
