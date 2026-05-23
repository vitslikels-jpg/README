import { cookies } from "next/headers";
import { createSessionCookie, getAuthLogin, getPasswordHash } from "@/lib/auth";
import { jsonUtf8 } from "@/lib/http";

export const runtime = "nodejs";

type LoginRequestBody = {
  login?: string;
  password?: string;
};

export async function POST(request: Request) {
  try {
    const authLogin = await getAuthLogin();
    const passwordHash = await getPasswordHash();

    if (!authLogin || !passwordHash) {
      return jsonUtf8({ success: false }, { status: 500 });
    }

    const body = (await request.json().catch(() => null)) as LoginRequestBody | null;
    const login = body?.login ?? "";
    const password = body?.password ?? "";

    if (login !== authLogin) {
      return jsonUtf8({ success: false }, { status: 401 });
    }

    const { compare } = await import("bcrypt");
    const passwordMatches = await compare(password, passwordHash);

    if (!passwordMatches) {
      return jsonUtf8({ success: false }, { status: 401 });
    }

    const cookieStore = await cookies();
    await createSessionCookie(cookieStore);

    return jsonUtf8({ success: true });
  } catch (error) {
    console.error("AUTH_LOGIN_ERROR", error);

    return jsonUtf8({ success: false }, { status: 500 });
  }
}
