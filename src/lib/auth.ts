import type { RequestCookies, ResponseCookies } from "next/dist/compiled/@edge-runtime/cookies";

export const SESSION_COOKIE_NAME = "citadel_session";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const textEncoder = new TextEncoder();

type AuthConfig = {
  login: string;
  passwordHash: string;
  sessionSecret: string;
};

let cachedAuthConfig: AuthConfig | null = null;

async function getAuthConfig() {
  if (cachedAuthConfig) {
    return cachedAuthConfig;
  }

  cachedAuthConfig = {
    login: process.env.APP_LOGIN?.trim() || "",
    passwordHash: process.env.APP_PASSWORD_HASH?.trim() || "",
    sessionSecret: process.env.APP_SESSION_SECRET?.trim() || process.env.APP_PASSWORD_HASH?.trim() || "",
  };

  return cachedAuthConfig;
}

async function createSigningKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;

  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return diff === 0;
}

async function signSessionValue(value: string, secret: string) {
  const key = await createSigningKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(value));

  return toBase64Url(new Uint8Array(signature));
}

export async function getPasswordHash() {
  const config = await getAuthConfig();

  return config.passwordHash;
}

export async function getAuthLogin() {
  const config = await getAuthConfig();

  return config.login;
}

export async function hasAuthConfig() {
  const config = await getAuthConfig();

  return Boolean(config.login && config.passwordHash);
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.APP_COOKIE_SECURE === "true",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export async function createSessionToken() {
  const config = await getAuthConfig();
  const expiresAt = String(Date.now() + SESSION_TTL_SECONDS * 1000);
  const signature = await signSessionValue(`${config.login}.${expiresAt}`, config.sessionSecret);

  return `${expiresAt}.${signature}`;
}

export async function hasValidSessionToken(token?: string | null) {
  const config = await getAuthConfig();

  if (!token || !config.login || !config.sessionSecret) {
    return false;
  }

  const [expiresAt, signature, ...rest] = token.split(".");

  if (!expiresAt || !signature || rest.length > 0) {
    return false;
  }

  const expiresAtNumber = Number(expiresAt);

  if (!Number.isFinite(expiresAtNumber) || expiresAtNumber <= Date.now()) {
    return false;
  }

  const expectedSignature = await signSessionValue(`${config.login}.${expiresAt}`, config.sessionSecret);

  return safeEqual(signature, expectedSignature);
}

export async function isAuthenticatedRequest(cookieStore: Pick<RequestCookies, "get"> | Pick<ResponseCookies, "get">) {
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  return hasValidSessionToken(token);
}

export async function createSessionCookie(cookieStore: Pick<ResponseCookies, "set">) {
  cookieStore.set(SESSION_COOKIE_NAME, await createSessionToken(), getSessionCookieOptions());
}

export function clearSessionCookie(cookieStore: Pick<ResponseCookies, "set">) {
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    ...getSessionCookieOptions(),
    maxAge: 0,
  });
}
