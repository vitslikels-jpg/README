import { cookies } from "next/headers";
import { isAuthenticatedRequest } from "@/lib/auth";
import { jsonUtf8 } from "@/lib/http";
import { listIikoProducts } from "@/lib/integrations/iiko/iiko-product-links";

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

  const status = searchParams.get("status");
  if (status && !["all", "mapped", "unmapped"].includes(status)) {
    return jsonUtf8(
      {
        ok: false,
        message: "Параметр status должен быть all, mapped или unmapped.",
      },
      { status: 400 },
    );
  }

  const result = await listIikoProducts({
    enterpriseId,
    q: searchParams.get("q"),
    type: searchParams.get("type"),
    status: (status as "all" | "mapped" | "unmapped" | null) ?? "all",
    limit: searchParams.get("limit"),
    offset: searchParams.get("offset"),
  });

  return jsonUtf8({
    ok: true,
    ...result,
  });
}
