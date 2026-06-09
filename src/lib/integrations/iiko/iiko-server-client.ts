import { createHash } from "node:crypto";

type IikoConnectionTestResult =
  | {
      ok: true;
      serverUrl: string;
    }
  | {
      ok: false;
      serverUrl: string;
      details: string;
    };

type IikoServerConfig =
  | {
      ok: true;
      serverUrl: string;
      username: string;
      password: string;
      timeoutMs: number;
    }
  | {
      ok: false;
      serverUrl: string;
      details: string;
    };

const DEFAULT_TIMEOUT_MS = 15000;

function getEnvValue(name: string) {
  const value = process.env[name];

  return typeof value === "string" ? value.trim() : "";
}

function getIikoServerConfig(): IikoServerConfig {
  const serverUrl = getEnvValue("IIKO_SERVER_URL").replace(/\/+$/u, "");
  const username = getEnvValue("IIKO_API_USERNAME");
  const password = getEnvValue("IIKO_API_PASSWORD");
  const timeoutRaw = getEnvValue("IIKO_API_TIMEOUT_MS");
  const timeoutMs = Number.parseInt(timeoutRaw || String(DEFAULT_TIMEOUT_MS), 10);

  if (!serverUrl) {
    return {
      ok: false,
      serverUrl: "",
      details: "Не настроен IIKO_SERVER_URL.",
    };
  }

  if (!username) {
    return {
      ok: false,
      serverUrl,
      details: "Не настроен IIKO_API_USERNAME.",
    };
  }

  if (!password) {
    return {
      ok: false,
      serverUrl,
      details: "Не настроен IIKO_API_PASSWORD.",
    };
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return {
      ok: false,
      serverUrl,
      details: "IIKO_API_TIMEOUT_MS должен быть положительным числом.",
    };
  }

  return {
    ok: true,
    serverUrl,
    username,
    password,
    timeoutMs,
  };
}

function buildPasswordHash(password: string) {
  return createHash("sha1").update(password, "utf8").digest("hex");
}

async function readResponseText(response: Response) {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}

function createTimeoutController(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
    },
  };
}

async function fetchWithTimeout(input: string, timeoutMs: number, init?: RequestInit) {
  const { signal, cleanup } = createTimeoutController(timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal,
      cache: "no-store",
    });
  } finally {
    cleanup();
  }
}

export async function testIikoServerConnection(): Promise<IikoConnectionTestResult> {
  const config = getIikoServerConfig();

  if (!config.ok) {
    return config;
  }

  const { serverUrl, username, password, timeoutMs } = config;
  const authUrl = new URL("/resto/api/auth", serverUrl);
  authUrl.searchParams.set("login", username);
  authUrl.searchParams.set("pass", buildPasswordHash(password));

  try {
    const authResponse = await fetchWithTimeout(authUrl.toString(), timeoutMs, {
      method: "GET",
      headers: {
        Accept: "text/plain, application/json, */*",
      },
    });
    const authText = await readResponseText(authResponse);

    if (!authResponse.ok) {
      return {
        ok: false,
        serverUrl,
        details: authText || `iiko вернул HTTP ${authResponse.status} на авторизации.`,
      };
    }

    const accessToken = authText;
    const sessionCookie = authResponse.headers.get("set-cookie");

    if (!accessToken && !sessionCookie) {
      return {
        ok: true,
        serverUrl,
      };
    }

    const versionUrl = new URL("/resto/api/version", serverUrl);
    const headers = new Headers({
      Accept: "text/plain, application/json, */*",
    });

    if (accessToken) {
      versionUrl.searchParams.set("key", accessToken);
    } else if (sessionCookie) {
      headers.set("Cookie", sessionCookie);
    }

    const versionResponse = await fetchWithTimeout(versionUrl.toString(), timeoutMs, {
      method: "GET",
      headers,
    });
    const versionText = await readResponseText(versionResponse);

    if (!versionResponse.ok) {
      return {
        ok: false,
        serverUrl,
        details: versionText || `iiko вернул HTTP ${versionResponse.status} при проверке API.`,
      };
    }

    return {
      ok: true,
      serverUrl,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        serverUrl,
        details: `iiko не ответил за ${timeoutMs} мс.`,
      };
    }

    return {
      ok: false,
      serverUrl,
      details: error instanceof Error ? error.message : "Неизвестная ошибка подключения.",
    };
  }
}
