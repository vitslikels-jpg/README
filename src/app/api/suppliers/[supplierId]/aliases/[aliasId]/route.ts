import { jsonUtf8 } from "@/lib/http";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    supplierId: string;
    aliasId: string;
  }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  const { supplierId, aliasId } = await context.params;
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  const alias = await prisma.supplierAlias.findFirst({
    where: {
      id: aliasId,
      enterpriseId,
      supplierId,
    },
    select: {
      id: true,
    },
  });

  if (!alias) {
    return jsonUtf8({ message: "Alias не найден для этого поставщика." }, { status: 404 });
  }

  await prisma.supplierAlias.delete({
    where: {
      id: aliasId,
    },
  });

  return jsonUtf8({ ok: true, id: aliasId });
}
