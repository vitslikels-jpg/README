import { jsonUtf8 } from "@/lib/http";
import {
  normalizeOptionalString,
  normalizeOrderOptimizationUnit,
  parseNullablePositiveDecimal,
  isOrderOptimizationItemProblem,
  calculateRequestedAmount,
  getOrderOptimizationItemStatus,
} from "@/lib/order-optimizations";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    optimizationId: string;
    itemId: string;
  }>;
};

function serializeItem(item: Awaited<ReturnType<typeof getItem>>) {
  if (!item) {
    return null;
  }

  return {
    id: item.id,
    optimizationId: item.optimizationId,
    sourceLine: item.sourceLine,
    requestedSupplierName: item.requestedSupplierName,
    lockSupplier: item.lockSupplier,
    parsedName: item.parsedName,
    parsedQuantity: item.parsedQuantity?.toString() ?? null,
    parsedUnit: item.parsedUnit,
    requestedAmount: item.requestedAmount?.toString() ?? null,
    selectedCandidateId: item.selectedCandidateId,
    selectionMode: item.selectionMode,
    matchStatus: item.matchStatus,
    status: getOrderOptimizationItemStatus(item),
    isProblem: isOrderOptimizationItemProblem(item),
    notes: item.notes,
    sortOrder: item.sortOrder,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    results: [],
  };
}

function getItem(itemId: string, optimizationId: string, enterpriseId: string) {
  return prisma.orderOptimizationItem.findFirst({
    where: {
      id: itemId,
      optimizationId,
      optimization: {
        enterpriseId,
      },
    },
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { optimizationId, itemId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    enterpriseId?: string;
    requestedSupplierName?: string | null;
    parsedName?: string | null;
    parsedQuantity?: string | number | null;
    parsedUnit?: string | null;
  };
  const enterpriseId = body.enterpriseId?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Поле enterpriseId обязательно." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  const existingItem = await getItem(itemId, optimizationId, enterpriseId);

  if (!existingItem) {
    return jsonUtf8({ message: "Позиция умного заказа не найдена." }, { status: 404 });
  }

  const hasSupplier = Object.prototype.hasOwnProperty.call(body, "requestedSupplierName");
  const hasName = Object.prototype.hasOwnProperty.call(body, "parsedName");
  const hasQuantity = Object.prototype.hasOwnProperty.call(body, "parsedQuantity");
  const hasUnit = Object.prototype.hasOwnProperty.call(body, "parsedUnit");

  if (!hasSupplier && !hasName && !hasQuantity && !hasUnit) {
    return jsonUtf8({ message: "Нет полей для обновления." }, { status: 400 });
  }

  const parsedName = hasName ? normalizeOptionalString(body.parsedName) : existingItem.parsedName;

  if (!parsedName) {
    return jsonUtf8({ message: "Название позиции не может быть пустым." }, { status: 400 });
  }

  let parsedQuantity = existingItem.parsedQuantity;

  try {
    if (hasQuantity) {
      parsedQuantity = parseNullablePositiveDecimal(body.parsedQuantity, "parsedQuantity");
    }
  } catch (error) {
    return jsonUtf8(
      { message: error instanceof Error ? error.message : "Некорректное количество." },
      { status: 400 },
    );
  }

  const parsedUnit = hasUnit ? normalizeOrderOptimizationUnit(body.parsedUnit) : existingItem.parsedUnit;

  if (hasUnit && body.parsedUnit !== null && body.parsedUnit !== "" && !parsedUnit) {
    return jsonUtf8({ message: "Некорректная единица измерения." }, { status: 400 });
  }

  const requestedAmount = calculateRequestedAmount(parsedQuantity, parsedUnit);

  const updatedItem = await prisma.orderOptimizationItem.update({
    where: {
      id: itemId,
    },
    data: {
      ...(hasSupplier ? { requestedSupplierName: normalizeOptionalString(body.requestedSupplierName) } : {}),
      ...(hasName ? { parsedName } : {}),
      ...(hasQuantity ? { parsedQuantity: parsedQuantity?.toString() ?? null } : {}),
      ...(hasUnit ? { parsedUnit } : {}),
      ...(hasQuantity || hasUnit ? { requestedAmount: requestedAmount?.toString() ?? null } : {}),
    },
  });

  return jsonUtf8(serializeItem(updatedItem));
}

