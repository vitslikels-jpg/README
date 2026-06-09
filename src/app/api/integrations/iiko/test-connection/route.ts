import { cookies } from "next/headers";
import { isAuthenticatedRequest } from "@/lib/auth";
import { jsonUtf8 } from "@/lib/http";
import { testIikoServerConnection } from "@/lib/integrations/iiko/iiko-server-client";

export const runtime = "nodejs";

export async function GET() {
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

  const result = await testIikoServerConnection();

  if (result.ok) {
    return jsonUtf8({
      ok: true,
      message: "iiko подключен",
      serverUrl: result.serverUrl,
    });
  }

  return jsonUtf8(
    {
      ok: false,
      message: "Ошибка подключения к iiko",
      details: result.details,
    },
    { status: 502 },
  );
}
