import { jsonUtf8 } from "@/lib/http";
import {
  buildRawSnippet,
  requestSmartOrderAiParse,
  SMART_ORDER_AI_PARSE_MODEL,
  SmartOrderAiParseError,
} from "@/lib/smart-order-ai-parse";

const MAX_SOURCE_TEXT_LENGTH = 10_000;

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

  try {
    const validated = await requestSmartOrderAiParse(sourceText);

    return jsonUtf8({
      source: "polza",
      model: SMART_ORDER_AI_PARSE_MODEL,
      items: validated.items,
    });
  } catch (error) {
    if (error instanceof SmartOrderAiParseError && error.code === "api_key_missing") {
      return jsonUtf8({ message: error.message }, { status: 503 });
    }

    return jsonUtf8(
      {
        message:
          error instanceof SmartOrderAiParseError ? error.message : "Не удалось выполнить запрос к Polza AI.",
        rawSnippet:
          error instanceof SmartOrderAiParseError
            ? error.rawSnippet
            : buildRawSnippet(error instanceof Error ? error.message : String(error)),
      },
      { status: 502 },
    );
  }
}
