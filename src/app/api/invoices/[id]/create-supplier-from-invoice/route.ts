import { jsonUtf8 } from "@/lib/http";
import { extractInvoiceSupplierDetails } from "@/lib/invoice-supplier-details";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { normalizeSupplierAliasValue } from "@/lib/supplier-alias";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type RequestBody = {
  enterpriseId?: string;
  supplierName?: string;
  legalName?: string;
  inn?: string;
  alias?: string;
  comment?: string;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as RequestBody;
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
      rawText: true,
    },
  });

  if (!invoice) {
    return jsonUtf8({ message: "Накладная не найдена." }, { status: 404 });
  }

  if (invoice.supplierId) {
    return jsonUtf8({ message: "Для накладной уже выбран поставщик." }, { status: 400 });
  }

  const extractedDetails = extractInvoiceSupplierDetails(invoice.rawText, invoice.detectedSupplierName);
  const supplierName = body.supplierName?.trim() || extractedDetails.supplierName;
  const legalName = body.legalName?.trim() || extractedDetails.legalName;
  const inn = body.inn?.trim() || extractedDetails.inn;
  const alias = body.alias?.trim() || null;
  const comment = body.comment?.trim() || null;

  if (!supplierName) {
    return jsonUtf8({ message: "В накладной нет названия поставщика." }, { status: 400 });
  }

  const normalizedSupplierName = normalizeSupplierAliasValue(supplierName);
  const normalizedLegalName = legalName ? normalizeSupplierAliasValue(legalName) : null;
  const normalizedAlias = alias ? normalizeSupplierAliasValue(alias) : null;

  if (!normalizedSupplierName) {
    return jsonUtf8({ message: "Название поставщика пустое после нормализации." }, { status: 400 });
  }

  const [suppliers, supplierByNameAlias, supplierByLegalAlias, supplierByCustomAlias] = await Promise.all([
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
    normalizedLegalName
      ? prisma.supplierAlias.findUnique({
          where: {
            enterpriseId_normalizedValue: {
              enterpriseId,
              normalizedValue: normalizedLegalName,
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
        })
      : Promise.resolve(null),
    normalizedAlias
      ? prisma.supplierAlias.findUnique({
          where: {
            enterpriseId_normalizedValue: {
              enterpriseId,
              normalizedValue: normalizedAlias,
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
        })
      : Promise.resolve(null),
  ]);

  const supplierByDirectName =
    suppliers.find((supplier) => normalizeSupplierAliasValue(supplier.name) === normalizedSupplierName) ?? null;

  const existingSupplier =
    supplierByDirectName ?? supplierByNameAlias?.supplier ?? supplierByLegalAlias?.supplier ?? supplierByCustomAlias?.supplier ?? null;

  if (existingSupplier) {
    return jsonUtf8(
      {
        message: "Похожий поставщик уже есть. Лучше связать накладную с существующим.",
        supplier: existingSupplier,
      },
      { status: 409 },
    );
  }

  const commentParts = [
    comment,
    legalName && legalName !== supplierName ? `Юр. название: ${legalName}` : null,
    inn ? `ИНН: ${inn}` : null,
  ].filter(Boolean);

  const result = await prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.create({
      data: {
        enterpriseId,
        name: supplierName,
        comment: commentParts.join("\n") || null,
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

    for (const aliasValue of [supplierName, legalName, alias]) {
      const value = aliasValue?.trim();
      const normalizedValue = normalizeSupplierAliasValue(value);

      if (!value || !normalizedValue) {
        continue;
      }

      const existingAlias = await tx.supplierAlias.findUnique({
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
        continue;
      }

      await tx.supplierAlias.create({
        data: {
          enterpriseId,
          supplierId: supplier.id,
          value,
          normalizedValue,
          type:
            value === supplierName
              ? "invoice_name"
              : value === legalName
                ? "invoice_legal_name"
                : "invoice_alias",
        },
      });
    }

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
