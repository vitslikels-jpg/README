import { jsonUtf8 } from "@/lib/http";
import {
  getOrderOptimizationWithDetails,
  normalizeOptionalString,
  serializeOrderOptimization,
} from "@/lib/order-optimizations";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    optimizationId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { optimizationId } = await context.params;
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();

  const optimization = await getOrderOptimizationWithDetails(optimizationId, enterpriseId);

  if (!optimization) {
    return jsonUtf8({ message: "Оптимизация не найдена." }, { status: 404 });
  }

  return jsonUtf8(serializeOrderOptimization(optimization));
}

export async function PATCH(request: Request, context: RouteContext) {
  const { optimizationId } = await context.params;
  const body = (await request.json()) as {
    enterpriseId?: string;
    title?: string | null;
    sourceText?: string;
  };

  const enterpriseId = body.enterpriseId?.trim();

  if (enterpriseId) {
    const enterprise = await ensureEnterpriseExists(enterpriseId);

    if (!enterprise) {
      return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
    }
  }

  const existingOptimization = await prisma.orderOptimization.findFirst({
    where: {
      id: optimizationId,
      ...(enterpriseId ? { enterpriseId } : {}),
    },
    select: {
      id: true,
    },
  });

  if (!existingOptimization) {
    return jsonUtf8({ message: "Оптимизация не найдена." }, { status: 404 });
  }

  const hasTitle = Object.prototype.hasOwnProperty.call(body, "title");
  const hasSourceText = Object.prototype.hasOwnProperty.call(body, "sourceText");

  if (!hasTitle && !hasSourceText) {
    return jsonUtf8({ message: "Передайте title или sourceText для обновления." }, { status: 400 });
  }

  const updatedOptimization = await prisma.orderOptimization.update({
    where: {
      id: optimizationId,
    },
    data: {
      ...(hasTitle ? { title: normalizeOptionalString(body.title) } : {}),
      ...(hasSourceText ? { sourceText: String(body.sourceText ?? "") } : {}),
    },
  });

  const fullOptimization = await getOrderOptimizationWithDetails(updatedOptimization.id, enterpriseId);

  if (!fullOptimization) {
    return jsonUtf8({ message: "Не удалось получить обновлённую оптимизацию." }, { status: 500 });
  }

  return jsonUtf8(serializeOrderOptimization(fullOptimization));
}

export async function DELETE(request: Request, context: RouteContext) {
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

  const existingOptimization = await prisma.orderOptimization.findFirst({
    where: {
      id: optimizationId,
      enterpriseId,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!existingOptimization) {
    return jsonUtf8({ message: "Умный заказ не найден." }, { status: 404 });
  }

  if (existingOptimization.status !== "draft") {
    return jsonUtf8({ message: "Удалять можно только черновики умного заказа." }, { status: 409 });
  }

  await prisma.orderOptimization.delete({
    where: {
      id: existingOptimization.id,
    },
  });

  return jsonUtf8({ id: existingOptimization.id });
}

