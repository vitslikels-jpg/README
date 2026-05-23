import { jsonUtf8 } from "@/lib/http";
import {
  buildOrderOptimizationTitle,
  normalizeOptionalString,
  serializeOrderOptimization,
} from "@/lib/order-optimizations";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  const optimizations = await prisma.orderOptimization.findMany({
    where: {
      enterpriseId,
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  return jsonUtf8(optimizations.map(serializeOrderOptimization));
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    enterpriseId?: string;
    title?: string | null;
    sourceText?: string;
  };

  const enterpriseId = body.enterpriseId?.trim();
  const sourceText = String(body.sourceText ?? "");

  if (!enterpriseId) {
    return jsonUtf8({ message: "Поле enterpriseId обязательно." }, { status: 400 });
  }

  if (!sourceText.trim()) {
    return jsonUtf8({ message: "Поле sourceText обязательно." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  const title = normalizeOptionalString(body.title) ?? buildOrderOptimizationTitle(sourceText);

  const optimization = await prisma.orderOptimization.create({
    data: {
      enterpriseId,
      title,
      sourceText,
      status: "draft",
    },
  });

  return jsonUtf8(serializeOrderOptimization(optimization), { status: 201 });
}

