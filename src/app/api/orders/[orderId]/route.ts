import { type OrderStatus } from "@prisma/client";
import { jsonUtf8 } from "@/lib/http";
import { ensureEnterpriseExists, getOrderWithDetails, normalizeOptionalString, serializeOrder } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    orderId: string;
  }>;
};

const allowedStatuses = new Set<OrderStatus>(["draft", "submitted", "cancelled"]);

function getStatusTransitionError(currentStatus: OrderStatus, nextStatus: OrderStatus) {
  if (currentStatus === nextStatus) {
    return null;
  }

  if (currentStatus === "draft" && (nextStatus === "submitted" || nextStatus === "cancelled")) {
    return null;
  }

  return "Недопустимый переход статуса заказа. Сейчас разрешены только переходы draft -> submitted и draft -> cancelled.";
}

export async function GET(request: Request, context: RouteContext) {
  const { orderId } = await context.params;
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const order = await getOrderWithDetails(orderId, enterpriseId);

  if (!order) {
    return jsonUtf8({ message: "Заказ не найден." }, { status: 404 });
  }

  return jsonUtf8(serializeOrder(order));
}

export async function PATCH(request: Request, context: RouteContext) {
  const { orderId } = await context.params;
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  const existingOrder = await prisma.order.findFirst({
    where: {
      id: orderId,
      enterpriseId,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!existingOrder) {
    return jsonUtf8({ message: "Заказ не найден." }, { status: 404 });
  }

  const body = (await request.json()) as {
    status?: OrderStatus;
    comment?: string | null;
  };

  const nextStatus = body.status;

  if (nextStatus && !allowedStatuses.has(nextStatus)) {
    return jsonUtf8({ message: "Недопустимый статус заказа." }, { status: 400 });
  }

  if (nextStatus) {
    const transitionError = getStatusTransitionError(existingOrder.status, nextStatus);

    if (transitionError) {
      return jsonUtf8({ message: transitionError }, { status: 409 });
    }
  }

  const now = new Date();

  await prisma.order.update({
    where: { id: orderId },
    data: {
      ...(nextStatus ? { status: nextStatus } : {}),
      ...(nextStatus === "submitted" && existingOrder.status !== "submitted" ? { submittedAt: now } : {}),
      ...(nextStatus === "cancelled" && existingOrder.status !== "cancelled" ? { cancelledAt: now } : {}),
      ...(body.comment !== undefined ? { comment: normalizeOptionalString(body.comment) } : {}),
    },
  });

  const updatedOrder = await getOrderWithDetails(orderId, enterpriseId);

  if (!updatedOrder) {
    return jsonUtf8({ message: "Не удалось получить обновлённый заказ." }, { status: 500 });
  }

  return jsonUtf8(serializeOrder(updatedOrder));
}
