import { cookies } from "next/headers";
import { isAuthenticatedRequest } from "@/lib/auth";
import { jsonUtf8 } from "@/lib/http";

export async function GET() {
  const cookieStore = await cookies();
  const authenticated = await isAuthenticatedRequest(cookieStore);

  return jsonUtf8({ authenticated });
}
