import { cookies } from "next/headers";
import { isAuthenticatedRequest } from "@/lib/auth";
import { jsonUtf8 } from "@/lib/http";
import { syncIikoCatalog } from "@/lib/integrations/iiko/iiko-sync";

export const runtime = "nodejs";

export async function POST(request: Request) {
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

  const body = (await request.json().catch(() => ({}))) as {
    enterpriseId?: string;
  };
  const enterpriseId = body.enterpriseId?.trim();

  if (!enterpriseId) {
    return jsonUtf8(
      {
        ok: false,
        message: "Поле enterpriseId обязательно.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await syncIikoCatalog(enterpriseId);

    return jsonUtf8({
      ok: true,
      ...result,
    });
  } catch (error) {
    return jsonUtf8(
      {
        ok: false,
        message: "Не удалось синхронизировать каталог iiko.",
        details: error instanceof Error ? error.message : "Неизвестная ошибка.",
      },
      { status: 502 },
    );
  }
}
