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
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
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

  const body = (await request.json()) as {
    rawText?: string;
  };

  const nextRawText = String(body.rawText ?? "").trim();

  const updatedInvoice = await prisma.invoiceDocument.update({
    where: {
      id,
    },
    data: {
      rawText: nextRawText || null,
      status: nextRawText ? "needs_review" : "uploaded",
    },
    select: {
      id: true,
      status: true,
      rawText: true,
      updatedAt: true,
    },
  });

  return jsonUtf8({ invoice: updatedInvoice });
}
