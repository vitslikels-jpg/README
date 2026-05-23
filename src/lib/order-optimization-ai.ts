import type { OrderOptimizationItem } from "@prisma/client";
import { normalizeOrderOptimizationUnit } from "@/lib/order-optimizations";

export type OrderOptimizationAiSuggestion = {
  suggestedSupplierName: string | null;
  suggestedName: string | null;
  suggestedQuantity: string | null;
  suggestedUnit: string | null;
  explanation: string;
  source: "polza" | "openrouter" | "local";
};

type RemoteAiProvider = {
  source: "polza" | "openrouter";
  apiKey: string;
  model: string;
  completionsUrl: string;
  headers?: Record<string, string>;
};

function normalizeSuggestionText(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function joinApiUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/u, "")}/${path.replace(/^\/+/u, "")}`;
}

function getRemoteAiProvider(): RemoteAiProvider | null {
  const polzaApiKey = process.env.POLZA_AI_API_KEY?.trim();

  if (polzaApiKey) {
    return {
      source: "polza",
      apiKey: polzaApiKey,
      model: process.env.POLZA_AI_MODEL?.trim() || "qwen/qwen3.6-flash",
      completionsUrl: joinApiUrl(process.env.POLZA_AI_BASE_URL?.trim() || "https://polza.ai/api/v1", "chat/completions"),
    };
  }

  const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (!openRouterApiKey) {
    return null;
  }

  return {
    source: "openrouter",
    apiKey: openRouterApiKey,
    model: process.env.OPENROUTER_MODEL?.trim() || "openai/gpt-4o-mini",
    completionsUrl: joinApiUrl(
      process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
      "chat/completions",
    ),
    headers: {
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost",
      "X-Title": "Umnyy Zakaz",
    },
  };
}

function buildLocalSuggestion(item: Pick<OrderOptimizationItem, "sourceLine" | "requestedSupplierName" | "parsedName">) {
  const sourceLine = item.sourceLine.trim();
  const supplierMatch = sourceLine.match(/^([^:]+):\s*(.+)$/u);
  const lineWithoutSupplier = supplierMatch?.[2]?.trim() || sourceLine;
  const suggestedSupplierName = item.requestedSupplierName ?? supplierMatch?.[1]?.trim() ?? null;
  const quantityMatch = lineWithoutSupplier.match(/(\d+(?:[.,]\d+)?)\s*([а-яА-Я.]+)?/u);
  const suggestedQuantity = quantityMatch?.[1]?.replace(",", ".") ?? null;
  const suggestedUnit = normalizeOrderOptimizationUnit(quantityMatch?.[2]) ?? null;
  const suggestedName =
    lineWithoutSupplier
      .replace(/(\d+(?:[.,]\d+)?)\s*([а-яА-Я.]+)?/u, "")
      .replace(/\s+/g, " ")
      .trim() ||
    item.parsedName ||
    lineWithoutSupplier;

  return {
    suggestedSupplierName: normalizeSuggestionText(suggestedSupplierName),
    suggestedName: normalizeSuggestionText(suggestedName),
    suggestedQuantity,
    suggestedUnit,
    explanation: quantityMatch
      ? "Найдено число внутри строки. Единица принята только если она входит в список допустимых."
      : "Автоматически подсказал очищенное название без уверенного количества.",
    source: "local" as const,
  };
}

function normalizeOpenRouterSuggestion(value: unknown): Omit<OrderOptimizationAiSuggestion, "source"> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const suggestion = value as Record<string, unknown>;
  const suggestedUnit = normalizeOrderOptimizationUnit(suggestion.suggestedUnit);

  return {
    suggestedSupplierName: normalizeSuggestionText(suggestion.suggestedSupplierName),
    suggestedName: normalizeSuggestionText(suggestion.suggestedName),
    suggestedQuantity: normalizeSuggestionText(suggestion.suggestedQuantity)?.replace(",", ".") ?? null,
    suggestedUnit,
    explanation:
      normalizeSuggestionText(suggestion.explanation) ??
      "AI предложил вариант разбора, но не вернул объяснение.",
  };
}

export async function suggestOrderOptimizationItem(
  item: Pick<
    OrderOptimizationItem,
    "sourceLine" | "requestedSupplierName" | "parsedName" | "parsedQuantity" | "parsedUnit"
  >,
): Promise<OrderOptimizationAiSuggestion> {
  const provider = getRemoteAiProvider();

  if (!provider) {
    return buildLocalSuggestion(item);
  }

  try {
    const response = await fetch(provider.completionsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
        ...provider.headers,
      },
      body: JSON.stringify({
        model: provider.model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Ты помощник разбора строки заказа. Верни только JSON с полями suggestedSupplierName, suggestedName, suggestedQuantity, suggestedUnit, explanation. Исправляй явные опечатки и кривой ввод в названии товара и единице измерения. Примеры: 'макороны' -> 'макароны', 'сметна' -> 'сметана', 'кк' -> 'кг'. Не подбирай товары из базы и не придумывай бренды. Единицы только: шт, кг, г, л, мл, уп, пач, кор, бут. Если не уверен, ставь null. explanation коротко по-русски.",
          },
          {
            role: "user",
            content: JSON.stringify({
              sourceLine: item.sourceLine,
              currentSupplier: item.requestedSupplierName,
              currentName: item.parsedName,
              currentQuantity: item.parsedQuantity?.toString() ?? null,
              currentUnit: item.parsedUnit,
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      return buildLocalSuggestion(item);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return buildLocalSuggestion(item);
    }

    const parsed = normalizeOpenRouterSuggestion(JSON.parse(content));

    if (!parsed) {
      return buildLocalSuggestion(item);
    }

    return {
      ...parsed,
      source: provider.source,
    };
  } catch {
    return buildLocalSuggestion(item);
  }
}
