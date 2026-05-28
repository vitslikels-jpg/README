import { jsonUtf8 } from "@/lib/http";
import {
  buildSmartOrderAiParsePrompt,
  validateSmartOrderAiParseResponse,
} from "@/lib/smart-order-ai-parse-schema";

const POLZA_MODEL = "gpt-5-mini";
const MAX_SOURCE_TEXT_LENGTH = 10_000;

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

function buildRawSnippet(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, 500) : null;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    sourceText?: string;
  };
  const sourceText = typeof body.sourceText === "string" ? body.sourceText.trim() : "";

  if (!sourceText) {
    return jsonUtf8({ message: "Поле sourceText обязательно." }, { status: 400 });
  }

  if (sourceText.length > MAX_SOURCE_TEXT_LENGTH) {
    return jsonUtf8(
      { message: `sourceText слишком длинный. Максимум ${MAX_SOURCE_TEXT_LENGTH} символов.` },
      { status: 400 },
    );
  }

  const apiKey = process.env.POLZA_AI_API_KEY?.trim();

  if (!apiKey) {
    return jsonUtf8(
      { message: "POLZA_AI_API_KEY не настроен. Sandbox AI parse test недоступен." },
      { status: 503 },
    );
  }

  const completionsUrl = joinApiUrl(process.env.POLZA_AI_BASE_URL?.trim() || "https://polza.ai/api/v1", "chat/completions");

  try {
    const response = await fetch(completionsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: POLZA_MODEL,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: buildSmartOrderAiParsePrompt(sourceText),
          },
        ],
      }),
    });

    if (!response.ok) {
      const rawText = await response.text().catch(() => "");

      return jsonUtf8(
        {
          message: `Polza AI вернул HTTP ${response.status}.`,
          rawSnippet: buildRawSnippet(rawText),
        },
        { status: 502 },
      );
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
      return jsonUtf8(
        {
          message: "AI не вернул JSON content.",
          rawSnippet: buildRawSnippet(rawContent),
        },
        { status: 502 },
      );
    }

    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(jsonText);
    } catch {
      return jsonUtf8(
        {
          message: "AI вернул невалидный JSON.",
          rawSnippet: buildRawSnippet(jsonText),
        },
        { status: 502 },
      );
    }

    const validated = validateSmartOrderAiParseResponse(parsedJson, { sourceText });

    return jsonUtf8({
      source: "polza",
      model: POLZA_MODEL,
      items: validated.items,
    });
  } catch (error) {
    return jsonUtf8(
      {
        message: "Не удалось выполнить запрос к Polza AI.",
        rawSnippet: buildRawSnippet(error instanceof Error ? error.message : String(error)),
      },
      { status: 502 },
    );
  }
}
