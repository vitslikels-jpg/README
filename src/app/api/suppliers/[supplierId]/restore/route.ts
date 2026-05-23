import { jsonUtf8 } from "@/lib/http";
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
      archivedAt: {
        not: null,
      },
    },
    select: {
      id: true,
    },
  });

  if (!supplier) {
    return jsonUtf8(
      { message: "Архивный поставщик не найден для выбранного предприятия." },
      { status: 404 },
    );
  }

  const restoredSupplier = await prisma.supplier.update({
    where: {
      id: supplierId,
    },
    data: {
      archivedAt: null,
    },
  });

  return jsonUtf8(restoredSupplier);
}
