import { cookies } from "next/headers";
import { clearSessionCookie } from "@/lib/auth";
import { jsonUtf8 } from "@/lib/http";

export async function POST() {
  const cookieStore = await cookies();
  clearSessionCookie(cookieStore);

  return jsonUtf8({ success: true });
}
