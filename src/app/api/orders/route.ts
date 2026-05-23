import { jsonUtf8 } from "@/lib/http";
import {
  ensureEnterpriseExists,
  ensureScopedSupplier,
  getOrderWithDetails,
  getOrCreateDraftOrder,
  normalizeOptionalString,
  serializeOrder,
} from "@/lib/orders";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();
  const supplierId = searchParams.get("supplierId")?.trim();
  const status = searchParams.get("status")?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  if (supplierId) {
    const supplier = await ensureScopedSupplier(enterpriseId, supplierId);

    if (!supplier) {
      return jsonUtf8({ message: "Поставщик не найден в выбранном предприятии." }, { status: 404 });
    }
  }

  const orders = await prisma.order.findMany({
    where: {
      enterpriseId,
      ...(supplierId ? { supplierId } : {}),
      ...(status ? { status: status as "draft" | "submitted" | "cancelled" } : {}),
    },
    include: {
      supplier: {
        select: {
          id: true,
          name: true,
          phone: true,
          managerName: true,
          email: true,
          minOrderAmount: true,
        },
      },
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              article: true,
              brand: true,
            },
          },
          productMaster: {
            select: {
              id: true,
              name: true,
              brand: true,
              category: true,
            },
          },
          supplierOffer: {
            select: {
              id: true,
              name: true,
              article: true,
              brand: true,
              legacyUnit: true,
            },
          },
          priceSnapshot: {
            select: {
              id: true,
              capturedAt: true,
            },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  return jsonUtf8(orders.map(serializeOrder));
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    enterpriseId?: string;
    supplierId?: string;
    comment?: string;
  };

  const enterpriseId = body.enterpriseId?.trim();
  const supplierId = body.supplierId?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Поле enterpriseId обязательно." }, { status: 400 });
  }

  if (!supplierId) {
    return jsonUtf8({ message: "Поле supplierId обязательно." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  const supplier = await ensureScopedSupplier(enterpriseId, supplierId);

  if (!supplier) {
    return jsonUtf8({ message: "Поставщик не найден в выбранном предприятии." }, { status: 404 });
  }

  const order = await getOrCreateDraftOrder({
    enterpriseId,
    supplierId,
    comment: normalizeOptionalString(body.comment),
  });

  const fullOrder = await getOrderWithDetails(order.id, enterpriseId);

  if (!fullOrder) {
    return jsonUtf8({ message: "Не удалось получить созданный заказ." }, { status: 500 });
  }

  return jsonUtf8(serializeOrder(fullOrder), { status: 201 });
}
