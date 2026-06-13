import { cookies } from "next/headers";
import { isAuthenticatedRequest } from "@/lib/auth";
import { jsonUtf8 } from "@/lib/http";
import { mapIikoProduct } from "@/lib/integrations/iiko/iiko-product-links";

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

  const body = (await request.json().catch(() => null)) as
    | {
        enterpriseId?: string;
        iikoProductId?: string;
        productMasterId?: string;
      }
    | null;

  const enterpriseId = body?.enterpriseId?.trim();
  const iikoProductId = body?.iikoProductId?.trim();
  const productMasterId = body?.productMasterId?.trim();

  if (!enterpriseId || !iikoProductId || !productMasterId) {
    return jsonUtf8(
      {
        ok: false,
        message: "Поля enterpriseId, iikoProductId и productMasterId обязательны.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await mapIikoProduct({
      enterpriseId,
      iikoProductId,
      productMasterId,
    });

    return jsonUtf8({
      ok: true,
      ...result,
    });
  } catch (error) {
    return jsonUtf8(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Не удалось связать товар iiko.",
      },
      { status: 400 },
    );
  }
}
