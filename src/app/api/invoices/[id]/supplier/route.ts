import { jsonUtf8 } from "@/lib/http";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    enterpriseId?: string;
    supplierId?: string | null;
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
    },
  });

  if (!invoice) {
    return jsonUtf8({ message: "Накладная не найдена." }, { status: 404 });
  }

  const hasSupplierId = Object.prototype.hasOwnProperty.call(body, "supplierId");

  if (!hasSupplierId) {
    return jsonUtf8({ message: "Поле supplierId обязательно." }, { status: 400 });
  }

  const supplierId = body.supplierId === null ? null : typeof body.supplierId === "string" ? body.supplierId.trim() : undefined;

  if (supplierId === undefined) {
    return jsonUtf8({ message: "Поле supplierId некорректно." }, { status: 400 });
  }

  let supplierName: string | null = null;

  if (supplierId) {
    const supplier = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        enterpriseId,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!supplier) {
      return jsonUtf8({ message: "Поставщик не найден в текущем предприятии." }, { status: 400 });
    }

    supplierName = supplier.name;
  }

  const updatedInvoice = await prisma.invoiceDocument.update({
    where: {
      id,
    },
    data: supplierId
      ? {
          supplierId,
          detectedSupplierName: supplierName,
          confidence: 1,
        }
      : {
          supplierId: null,
          detectedSupplierName: null,
          confidence: null,
        },
    select: {
      id: true,
      supplierId: true,
      detectedSupplierName: true,
      confidence: true,
      updatedAt: true,
    },
  });

  return jsonUtf8({ invoice: updatedInvoice });
}
