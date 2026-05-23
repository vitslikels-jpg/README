import { jsonUtf8 } from "@/lib/http";
import { rebuildOrderOptimizationCandidates } from "@/lib/order-optimization-matching";
import { serializeOrderOptimization } from "@/lib/order-optimizations";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    optimizationId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { optimizationId } = await context.params;
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

  const existingOptimization = await prisma.orderOptimization.findFirst({
    where: {
      id: optimizationId,
      enterpriseId,
    },
    select: {
      id: true,
    },
  });

  if (!existingOptimization) {
    return jsonUtf8({ message: "Умный заказ не найден." }, { status: 404 });
  }

  const optimization = await rebuildOrderOptimizationCandidates(optimizationId, enterpriseId);

  if (!optimization) {
    return jsonUtf8({ message: "Умный заказ не найден." }, { status: 404 });
  }

  return jsonUtf8(serializeOrderOptimization(optimization));
}

