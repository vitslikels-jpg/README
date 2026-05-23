import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { hasValidSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

const PUBLIC_AUTH_API_PATHS = new Set(["/api/auth/login", "/api/auth/logout", "/api/auth/me"]);
const PUBLIC_METADATA_PATHS = new Set(["/manifest.webmanifest"]);

function isPublicAsset(pathname: string) {
  return (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    PUBLIC_METADATA_PATHS.has(pathname) ||
    /\.[a-z0-9]+$/i.test(pathname)
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicAsset(pathname) || PUBLIC_AUTH_API_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authenticated = await hasValidSessionToken(token);

  if (pathname === "/login") {
    if (authenticated) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    return NextResponse.next();
  }

  if (authenticated) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ success: false }, { status: 401 });
  }

  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/:path*"],
};
