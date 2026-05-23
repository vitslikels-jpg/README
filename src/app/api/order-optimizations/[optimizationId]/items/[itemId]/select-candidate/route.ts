import { jsonUtf8 } from "@/lib/http";
import { getOrderOptimizationWithDetails, serializeOrderOptimization } from "@/lib/order-optimizations";
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
    candidateId?: string | null;
  };
  const enterpriseId = body.enterpriseId?.trim();
  const candidateId = body.candidateId?.trim() || null;

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
    select: {
      id: true,
      results: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!item) {
    return jsonUtf8({ message: "Позиция умного заказа не найдена." }, { status: 404 });
  }

  if (candidateId) {
    const candidate = await prisma.orderOptimizationResult.findFirst({
      where: {
        id: candidateId,
        itemId,
        optimizationId,
      },
      select: {
        id: true,
      },
    });

    if (!candidate) {
      return jsonUtf8({ message: "Вариант товара не найден для этой позиции." }, { status: 404 });
    }
  }

  await prisma.orderOptimizationItem.update({
    where: {
      id: itemId,
    },
    data: {
      selectedCandidateId: candidateId,
      selectionMode: candidateId ? "manual" : null,
      matchStatus: candidateId ? "review" : item.results.length > 0 ? "review" : "not_found",
    },
  });

  const optimization = await getOrderOptimizationWithDetails(optimizationId, enterpriseId);

  if (!optimization) {
    return jsonUtf8({ message: "Умный заказ не найден." }, { status: 404 });
  }

  return jsonUtf8(serializeOrderOptimization(optimization));
}

