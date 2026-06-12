import { cookies } from "next/headers";
import { isAuthenticatedRequest } from "@/lib/auth";
import { jsonUtf8 } from "@/lib/http";
import { getIikoCatalogSummary } from "@/lib/integrations/iiko/iiko-sync";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const authenticated = await isAuthenticatedRequest(cookieStore);

  if (!authenticated) {
    return jsonUtf8(
      {
        ok: false,
        message: "Нужна авторизация",
        details: "Сначала войдите в систему.",
      },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();

  if (!enterpriseId) {
    return jsonUtf8(
      {
        ok: false,
        message: "Параметр enterpriseId обязателен.",
      },
      { status: 400 },
    );
  }

  try {
    const summary = await getIikoCatalogSummary(enterpriseId);

    return jsonUtf8({
      ok: true,
      ...summary,
    });
  } catch (error) {
    return jsonUtf8(
      {
        ok: false,
        message: "Не удалось получить сводку каталога iiko.",
        details: error instanceof Error ? error.message : "Неизвестная ошибка.",
      },
      { status: 500 },
    );
  }
}
