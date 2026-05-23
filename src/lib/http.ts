import { NextResponse } from "next/server";

export function jsonUtf8(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");

  return NextResponse.json(body, {
    ...init,
    headers,
  });
}
