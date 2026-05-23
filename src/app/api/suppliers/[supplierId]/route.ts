import { Prisma } from "@prisma/client";
import { jsonUtf8 } from "@/lib/http";
import { getScopedSupplier } from "@/lib/documents";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    supplierId: string;
  }>;
};

function normalizeOptional(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseDecimalInput(value?: string) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/\s+/g, "").replace(",", ".");
  const numberValue = Number(normalized);

  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw new Error("Поле мин. суммы заказа должно быть числом.");
  }

  return new Prisma.Decimal(numberValue);
}

export async function GET(request: Request, context: RouteContext) {
  const { supplierId } = await context.params;
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const supplier = await getScopedSupplier(enterpriseId, supplierId);

  if (!supplier) {
    return jsonUtf8(
      { message: "Поставщик не найден для выбранного предприятия." },
      { status: 404 },
    );
  }

  return jsonUtf8(supplier);
}

export async function PATCH(request: Request, context: RouteContext) {
  const { supplierId } = await context.params;
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const existingSupplier = await getScopedSupplier(enterpriseId, supplierId);

  if (!existingSupplier) {
    return jsonUtf8(
      { message: "Поставщик не найден для выбранного предприятия." },
      { status: 404 },
    );
  }

  const body = (await request.json()) as {
    enterpriseId?: string;
    name?: string;
    phone?: string;
    managerName?: string;
    email?: string;
    comment?: string;
    minOrderAmount?: string;
  };

  const bodyEnterpriseId = body.enterpriseId?.trim();
  const name = body.name?.trim();

  if (bodyEnterpriseId && bodyEnterpriseId !== enterpriseId) {
    return jsonUtf8(
      { message: "Нельзя изменить enterpriseId поставщика." },
      { status: 400 },
    );
  }

  if (!name) {
    return jsonUtf8({ message: "Поле name обязательно." }, { status: 400 });
  }

  try {
    const supplier = await prisma.supplier.update({
      where: {
        id: supplierId,
      },
      data: {
        name,
        phone: normalizeOptional(body.phone),
        managerName: normalizeOptional(body.managerName),
        email: normalizeOptional(body.email),
        comment: normalizeOptional(body.comment),
        minOrderAmount: parseDecimalInput(body.minOrderAmount),
      },
    });

    return jsonUtf8(supplier);
  } catch (error) {
    return jsonUtf8(
      { message: error instanceof Error ? error.message : "Не удалось обновить поставщика." },
      { status: 400 },
    );
  }
}
