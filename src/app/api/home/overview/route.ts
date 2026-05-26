import { jsonUtf8 } from "@/lib/http";
import { buildHomeOverview } from "@/lib/home-dashboard";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const enterprise = await prisma.enterprise.findUnique({
    where: {
      id: enterpriseId,
    },
    select: {
      id: true,
    },
  });

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  const overview = await buildHomeOverview(enterpriseId);

  return jsonUtf8(overview);
}
