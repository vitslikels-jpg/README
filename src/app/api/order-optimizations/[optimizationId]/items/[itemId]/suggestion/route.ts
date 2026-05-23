import { jsonUtf8 } from "@/lib/http";
import { isOrderOptimizationItemProblem } from "@/lib/order-optimizations";
import { suggestOrderOptimizationItem } from "@/lib/order-optimization-ai";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

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
  };
  const enterpriseId = body.enterpriseId?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Поле enterpriseId обязательно." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  const item = await prisma.orderOptimizationItem.findFirst({
    where: {
      id: itemId,
      optimizationId,
      optimization: {
        enterpriseId,
      },
    },
  });

  if (!item) {
    return jsonUtf8({ message: "Позиция умного заказа не найдена." }, { status: 404 });
  }

  if (!isOrderOptimizationItemProblem(item)) {
    return jsonUtf8({
      suggestedSupplierName: item.requestedSupplierName,
      suggestedName: item.parsedName,
      suggestedQuantity: item.parsedQuantity?.toString() ?? null,
      suggestedUnit: item.parsedUnit,
      explanation: "Позиция уже разобрана без явных проблем.",
      source: "local",
    });
  }

  const suggestion = await suggestOrderOptimizationItem(item);

  return jsonUtf8(suggestion);
}

