import {
  buildSmartOrderAiParsePrompt,
  validateSmartOrderAiParseResponse,
  type SmartOrderAiParseResponse,
} from "@/lib/smart-order-ai-parse-schema";

export const SMART_ORDER_AI_PARSE_MODEL = "gpt-5-mini";
export const SMART_ORDER_AI_PARSE_TIMEOUT_MS = 20_000;

type SmartOrderAiParseOptions = {
  apiKey?: string | null;
  baseUrl?: string | null;
  timeoutMs?: number;
};

export class SmartOrderAiParseError extends Error {
  code: "api_key_missing" | "http_error" | "empty_content" | "invalid_json" | "fetch_failed";
  rawSnippet: string | null;
  status: number | null;

  constructor(
    code: SmartOrderAiParseError["code"],
    message: string,
    options: { rawSnippet?: string | null; status?: number | null } = {},
  ) {
    super(message);
    this.code = code;
    this.rawSnippet = options.rawSnippet ?? null;
    this.status = options.status ?? null;
  }
}

function joinApiUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/u, "")}/${path.replace(/^\/+/u, "")}`;
}

function extractJson(text: string) {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?/iu, "").replace(/```$/u, "").trim() || null;
  }

  return trimmed;
}

export function buildRawSnippet(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, 500) : null;
}

export function isSmartOrderAiParseEnabled() {
  return process.env.SMART_ORDER_AI_PARSE_ENABLED?.trim().toLowerCase() === "true";
}

export async function requestSmartOrderAiParse(
  sourceText: string,
  options: SmartOrderAiParseOptions = {},
): Promise<SmartOrderAiParseResponse> {
  const apiKey = options.apiKey?.trim() || process.env.POLZA_AI_API_KEY?.trim() || "";

  if (!apiKey) {
    throw new SmartOrderAiParseError(
      "api_key_missing",
      "POLZA_AI_API_KEY не настроен. Smart Order AI parse недоступен.",
    );
  }

  const completionsUrl = joinApiUrl(
    options.baseUrl?.trim() || process.env.POLZA_AI_BASE_URL?.trim() || "https://polza.ai/api/v1",
    "chat/completions",
  );
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? SMART_ORDER_AI_PARSE_TIMEOUT_MS);

  try {
    const response = await fetch(completionsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: SMART_ORDER_AI_PARSE_MODEL,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: buildSmartOrderAiParsePrompt(sourceText),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const rawText = await response.text().catch(() => "");

      throw new SmartOrderAiParseError(`http_error`, `Polza AI вернул HTTP ${response.status}.`, {
        rawSnippet: buildRawSnippet(rawText),
        status: response.status,
      });
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };
    const rawContent = payload.choices?.[0]?.message?.content ?? null;
    const jsonText = rawContent ? extractJson(rawContent) : null;

    if (!jsonText) {
      throw new SmartOrderAiParseError("empty_content", "AI не вернул JSON content.", {
        rawSnippet: buildRawSnippet(rawContent),
      });
    }

    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(jsonText);
    } catch {
      throw new SmartOrderAiParseError("invalid_json", "AI вернул невалидный JSON.", {
        rawSnippet: buildRawSnippet(jsonText),
      });
    }

    return validateSmartOrderAiParseResponse(parsedJson, { sourceText });
  } catch (error) {
    if (error instanceof SmartOrderAiParseError) {
      throw error;
    }

    throw new SmartOrderAiParseError("fetch_failed", "Не удалось выполнить запрос к Polza AI.", {
      rawSnippet: buildRawSnippet(error instanceof Error ? error.message : String(error)),
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
