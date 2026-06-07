import { jsonUtf8 } from "@/lib/http";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { normalizeSupplierAliasValue } from "@/lib/supplier-alias";

type RouteContext = {
  params: Promise<{
    supplierId: string;
  }>;
};

async function getScopedSupplier(enterpriseId: string, supplierId: string) {
  return prisma.supplier.findFirst({
    where: {
      id: supplierId,
      enterpriseId,
      archivedAt: null,
    },
    select: {
      id: true,
      enterpriseId: true,
      name: true,
    },
  });
}

export async function GET(request: Request, context: RouteContext) {
  const { supplierId } = await context.params;
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  const supplier = await getScopedSupplier(enterpriseId, supplierId);

  if (!supplier) {
    return jsonUtf8({ message: "Поставщик не найден в выбранном предприятии." }, { status: 404 });
  }

  const aliases = await prisma.supplierAlias.findMany({
    where: {
      enterpriseId,
      supplierId,
    },
    select: {
      id: true,
      value: true,
      normalizedValue: true,
      type: true,
      createdAt: true,
    },
    orderBy: [
      { createdAt: "asc" },
      { value: "asc" },
    ],
  });

  return jsonUtf8(aliases);
}

export async function POST(request: Request, context: RouteContext) {
  const { supplierId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    enterpriseId?: string;
    value?: string;
    type?: string;
  };
  const enterpriseId = body.enterpriseId?.trim();
  const value = body.value?.trim();
  const type = body.type?.trim() || null;

  if (!enterpriseId) {
    return jsonUtf8({ message: "Поле enterpriseId обязательно." }, { status: 400 });
  }

  if (!value) {
    return jsonUtf8({ message: "Поле value обязательно." }, { status: 400 });
  }

  const normalizedValue = normalizeSupplierAliasValue(value);

  if (!normalizedValue) {
    return jsonUtf8({ message: "Поле value не может быть пустым после нормализации." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  const supplier = await getScopedSupplier(enterpriseId, supplierId);

  if (!supplier) {
    return jsonUtf8({ message: "Поставщик не найден в выбранном предприятии." }, { status: 404 });
  }

  const existingAlias = await prisma.supplierAlias.findUnique({
    where: {
      enterpriseId_normalizedValue: {
        enterpriseId,
        normalizedValue,
      },
    },
    select: {
      id: true,
    },
  });

  if (existingAlias) {
    return jsonUtf8({ message: "Такой alias уже существует в этом предприятии." }, { status: 409 });
  }

  const alias = await prisma.supplierAlias.create({
    data: {
      enterpriseId,
      supplierId,
      value,
      normalizedValue,
      type,
    },
    select: {
      id: true,
      value: true,
      normalizedValue: true,
      type: true,
      createdAt: true,
    },
  });

  return jsonUtf8(alias, { status: 201 });
}
