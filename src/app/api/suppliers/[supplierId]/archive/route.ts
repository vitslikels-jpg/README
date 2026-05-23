import { jsonUtf8 } from "@/lib/http";
import { findDraftOrder } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    supplierId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { supplierId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    enterpriseId?: string;
  };
  const enterpriseId = body.enterpriseId?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Поле enterpriseId обязательно." }, { status: 400 });
  }

  const supplier = await prisma.supplier.findFirst({
    where: {
      id: supplierId,
      enterpriseId,
      archivedAt: null,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!supplier) {
    return jsonUtf8(
      { message: "Поставщик не найден в активной работе для выбранного предприятия." },
      { status: 404 },
    );
  }

  const draftOrder = await findDraftOrder(enterpriseId, supplierId);

  if (draftOrder) {
    return jsonUtf8(
      {
        message:
          "Нельзя отправить поставщика в архив, пока по нему есть черновик заказа. Сначала закройте или отмените draft-заказ.",
      },
      { status: 409 },
    );
  }

  const archivedSupplier = await prisma.supplier.update({
    where: {
      id: supplierId,
    },
    data: {
      archivedAt: new Date(),
    },
  });

  return jsonUtf8(archivedSupplier);
}
