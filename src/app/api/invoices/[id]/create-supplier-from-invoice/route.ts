import { jsonUtf8 } from "@/lib/http";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { normalizeSupplierAliasValue } from "@/lib/supplier-alias";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    enterpriseId?: string;
  };

  const enterpriseId = body.enterpriseId?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Поле enterpriseId обязательно." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  const invoice = await prisma.invoiceDocument.findFirst({
    where: {
      id,
      enterpriseId,
    },
    select: {
      id: true,
      supplierId: true,
      detectedSupplierName: true,
    },
  });

  if (!invoice) {
    return jsonUtf8({ message: "Накладная не найдена." }, { status: 404 });
  }

  if (invoice.supplierId) {
    return jsonUtf8({ message: "Для накладной уже выбран поставщик." }, { status: 400 });
  }

  const supplierName = invoice.detectedSupplierName?.trim();

  if (!supplierName) {
    return jsonUtf8({ message: "В накладной нет названия поставщика." }, { status: 400 });
  }

  const normalizedSupplierName = normalizeSupplierAliasValue(supplierName);

  if (!normalizedSupplierName) {
    return jsonUtf8({ message: "Название поставщика пустое после нормализации." }, { status: 400 });
  }

  const [suppliers, existingSupplierByAlias] = await Promise.all([
    prisma.supplier.findMany({
      where: {
        enterpriseId,
        archivedAt: null,
      },
      select: {
        id: true,
        name: true,
      },
    }),
    prisma.supplierAlias.findUnique({
      where: {
        enterpriseId_normalizedValue: {
          enterpriseId,
          normalizedValue: normalizedSupplierName,
        },
      },
      select: {
        supplier: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
  ]);

  const matchingSupplierByName =
    suppliers.find((supplier) => normalizeSupplierAliasValue(supplier.name) === normalizedSupplierName) ?? null;

  const existingSupplier = matchingSupplierByName ?? existingSupplierByAlias?.supplier ?? null;

  if (existingSupplier) {
    return jsonUtf8(
      { message: "Похожий поставщик уже есть. Лучше связать с существующим.", supplier: existingSupplier },
      { status: 409 },
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.create({
      data: {
        enterpriseId,
        name: supplierName,
      },
      select: {
        id: true,
        enterpriseId: true,
        name: true,
        phone: true,
        managerName: true,
        email: true,
        comment: true,
        minOrderAmount: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await tx.supplierAlias.create({
      data: {
        enterpriseId,
        supplierId: supplier.id,
        value: supplierName,
        normalizedValue: normalizedSupplierName,
        type: "invoice_name",
      },
    });

    await tx.invoiceDocument.update({
      where: {
        id,
      },
      data: {
        supplierId: supplier.id,
        detectedSupplierName: supplierName,
        confidence: 1,
      },
    });

    return supplier;
  });

  return jsonUtf8({ supplier: result }, { status: 201 });
}
