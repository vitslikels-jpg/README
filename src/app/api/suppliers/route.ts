import { Prisma } from "@prisma/client";
import { jsonUtf8 } from "@/lib/http";
import { prisma } from "@/lib/prisma";

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

async function ensureEnterpriseExists(enterpriseId: string) {
  return prisma.enterprise.findUnique({
    where: {
      id: enterpriseId,
    },
    select: {
      id: true,
    },
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();
  const archivedFilter = searchParams.get("archived")?.trim();
  const query = searchParams.get("q")?.trim();
  const limitValue = Number(searchParams.get("limit")?.trim() ?? "20");
  const limit = Number.isFinite(limitValue) && limitValue > 0 ? Math.min(limitValue, 50) : 20;

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  const suppliers = await prisma.supplier.findMany({
    where: {
      enterpriseId,
      ...(archivedFilter === "only"
        ? { archivedAt: { not: null } }
        : archivedFilter === "all"
          ? {}
          : { archivedAt: null }),
      ...(query
        ? {
            name: {
              contains: query,
              mode: "insensitive",
            },
          }
        : {}),
    },
    orderBy: archivedFilter === "only" ? [{ archivedAt: "desc" }, { name: "asc" }] : { name: "asc" },
    ...(query ? { take: limit } : {}),
  });

  return jsonUtf8(suppliers);
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    enterpriseId?: string;
    name?: string;
    phone?: string;
    managerName?: string;
    email?: string;
    comment?: string;
    minOrderAmount?: string;
  };

  const enterpriseId = body.enterpriseId?.trim();
  const name = body.name?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Поле enterpriseId обязательно." }, { status: 400 });
  }

  if (!name) {
    return jsonUtf8({ message: "Поле name обязательно." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  try {
    const supplier = await prisma.supplier.create({
      data: {
        enterpriseId,
        name,
        phone: normalizeOptional(body.phone),
        managerName: normalizeOptional(body.managerName),
        email: normalizeOptional(body.email),
        comment: normalizeOptional(body.comment),
        minOrderAmount: parseDecimalInput(body.minOrderAmount),
      },
    });

    return jsonUtf8(supplier, { status: 201 });
  } catch (error) {
    return jsonUtf8(
      { message: error instanceof Error ? error.message : "Не удалось создать поставщика." },
      { status: 400 },
    );
  }
}
