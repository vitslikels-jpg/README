type InvoiceGeminiItem = {
  name: string | null;
  quantity: number | null;
  unit: string | null;
  priceWithVat: number | null;
  priceWithoutVat: number | null;
  vatRate: number | null;
  lineTotal: number | null;
};

export type InvoiceGeminiParseResult = {
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  totalAmount: number | null;
  vatAmount: number | null;
  items: InvoiceGeminiItem[];
};

function joinApiUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/u, "")}/${path.replace(/^\/+/u, "")}`;
}

function getPolzaProvider() {
  const apiKey = process.env.POLZA_AI_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    model: process.env.POLZA_AI_MODEL?.trim() || "google/gemini-3.1-flash-lite",
    completionsUrl: joinApiUrl(process.env.POLZA_AI_BASE_URL?.trim() || "https://polza.ai/api/v1", "chat/completions"),
  };
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function normalizeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numericValue =
    typeof value === "number" ? value : Number(String(value).replace(/\s+/g, "").replace(",", "."));

  return Number.isFinite(numericValue) ? numericValue : null;
}

function normalizeItem(value: unknown): InvoiceGeminiItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const item = value as Record<string, unknown>;
  const name = normalizeText(item.name);

  if (!name) {
    return null;
  }

  return {
    name,
    quantity: normalizeNumber(item.quantity),
    unit: normalizeText(item.unit),
    priceWithVat: normalizeNumber(item.priceWithVat),
    priceWithoutVat: normalizeNumber(item.priceWithoutVat),
    vatRate: normalizeNumber(item.vatRate),
    lineTotal: normalizeNumber(item.lineTotal),
  };
}

function normalizeGeminiResult(value: unknown): InvoiceGeminiParseResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Gemini вернул не JSON-объект.");
  }

  const result = value as Record<string, unknown>;

  return {
    supplierName: normalizeText(result.supplierName),
    invoiceNumber: normalizeText(result.invoiceNumber),
    invoiceDate: normalizeText(result.invoiceDate),
    totalAmount: normalizeNumber(result.totalAmount),
    vatAmount: normalizeNumber(result.vatAmount),
    items: Array.isArray(result.items) ? result.items.map(normalizeItem).filter((item): item is InvoiceGeminiItem => Boolean(item)) : [],
  };
}

function buildPrompt(rawText: string) {
  return [
    "Разбери русский текст накладной после OCR.",
    "Верни только строгий JSON без markdown и пояснений.",
    "Не придумывай данные. Если значение неизвестно, верни null.",
    "Выделяй только реальные товарные строки. Игнорируй шапку, реквизиты, подписи, печати, служебные строки и итоги таблиц.",
    "Дата должна быть в формате YYYY-MM-DD, если её можно определить.",
    "Числа возвращай числами, не строками.",
    "Схема ответа:",
    JSON.stringify({
      supplierName: null,
      invoiceNumber: null,
      invoiceDate: null,
      totalAmount: null,
      vatAmount: null,
      items: [
        {
          name: null,
          quantity: null,
          unit: null,
          priceWithVat: null,
          priceWithoutVat: null,
          vatRate: null,
          lineTotal: null,
        },
      ],
    }),
    "Текст накладной:",
    rawText,
  ].join("\n\n");
}

export function getInvoiceGeminiModel() {
  return process.env.POLZA_AI_MODEL?.trim() || "google/gemini-3.1-flash-lite";
}

export async function parseInvoiceWithGemini(rawText: string): Promise<InvoiceGeminiParseResult> {
  const provider = getPolzaProvider();

  if (!provider) {
    throw new Error("POLZA_AI_API_KEY не настроен. AI-разбор накладной недоступен.");
  }

  const response = await fetch(provider.completionsUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Ты аккуратно разбираешь русские накладные в JSON. Возвращай только факты из текста, без догадок.",
        },
        {
          role: "user",
          content: buildPrompt(rawText),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini не разобрал накладную: HTTP ${response.status}.`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Gemini вернул пустой ответ.");
  }

  return normalizeGeminiResult(JSON.parse(content));
}
