type InvoiceGeminiItem = {
  name: string | null;
  quantity: number | null;
  unit: string | null;
  priceWithVat: number | null;
  priceWithoutVat: number | null;
  vatRate: number | null;
  lineTotal: number | null;
};

type InvoiceGeminiColumns = {
  name: string | null;
  quantity: string | null;
  unit: string | null;
  price: string | null;
  vat: string | null;
  total: string | null;
};

export type InvoiceGeminiStructureResult = {
  documentType: string | null;
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  totalAmount: number | null;
  vatAmount: number | null;
  tableDetected: boolean;
  tableStartHint: string | null;
  tableEndHint: string | null;
  columns: InvoiceGeminiColumns;
};

export type InvoiceGeminiFullParseResult = {
  structure: InvoiceGeminiStructureResult;
  tableRows: string[];
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

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  return false;
}

function normalizeColumns(value: unknown): InvoiceGeminiColumns {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      name: null,
      quantity: null,
      unit: null,
      price: null,
      vat: null,
      total: null,
    };
  }

  const columns = value as Record<string, unknown>;

  return {
    name: normalizeText(columns.name),
    quantity: normalizeText(columns.quantity),
    unit: normalizeText(columns.unit),
    price: normalizeText(columns.price),
    vat: normalizeText(columns.vat),
    total: normalizeText(columns.total),
  };
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

function normalizeStructureResult(value: unknown): InvoiceGeminiStructureResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Gemini вернул некорректную структуру документа.");
  }

  const result = value as Record<string, unknown>;

  return {
    documentType: normalizeText(result.documentType),
    supplierName: normalizeText(result.supplierName),
    invoiceNumber: normalizeText(result.invoiceNumber),
    invoiceDate: normalizeText(result.invoiceDate),
    totalAmount: normalizeNumber(result.totalAmount),
    vatAmount: normalizeNumber(result.vatAmount),
    tableDetected: normalizeBoolean(result.tableDetected),
    tableStartHint: normalizeText(result.tableStartHint),
    tableEndHint: normalizeText(result.tableEndHint),
    columns: normalizeColumns(result.columns),
  };
}

function normalizeTableRowsResult(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Gemini вернул некорректный ответ по строкам таблицы.");
  }

  const result = value as Record<string, unknown>;
  return Array.isArray(result.tableRows) ? result.tableRows.map(normalizeText).filter((row): row is string => Boolean(row)) : [];
}

function normalizeItemsResult(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Gemini вернул некорректный ответ по товарам.");
  }

  const result = value as Record<string, unknown>;
  return Array.isArray(result.items) ? result.items.map(normalizeItem).filter((item): item is InvoiceGeminiItem => Boolean(item)) : [];
}

function buildStructurePrompt(rawText: string) {
  return [
    "Analyze OCR text of a Russian invoice document.",
    "Do not parse product rows yet.",
    "Your job now is only to identify the document structure and whether a product table exists.",
    "Return strict JSON only.",
    "If you are unsure, keep fields null.",
    "Detect likely table start and table end hints from the OCR text.",
    "Columns should describe the words or labels that correspond to product name, quantity, unit, price, VAT, and total.",
    "You may also return invoiceNumber, invoiceDate (YYYY-MM-DD), totalAmount, vatAmount if clearly visible.",
    JSON.stringify({
      documentType: "invoice",
      supplierName: null,
      invoiceNumber: null,
      invoiceDate: null,
      totalAmount: null,
      vatAmount: null,
      tableDetected: false,
      tableStartHint: null,
      tableEndHint: null,
      columns: {
        name: null,
        quantity: null,
        unit: null,
        price: null,
        vat: null,
        total: null,
      },
    }),
    "OCR text:",
    rawText,
  ].join("\n\n");
}

function buildTableRowsPrompt(rawText: string, structure: InvoiceGeminiStructureResult) {
  return [
    "You already know this is a Russian invoice OCR text.",
    "Extract only the product table rows.",
    "Return strict JSON only.",
    "Do not include requisites, header, invoice title, supplier details, buyer details, page markers, totals, signatures, stamps, footer, addresses, INN/KPP, phone numbers, or bank details.",
    "Each table row must be returned as one string exactly as it appears or as a lightly cleaned OCR line.",
    "If table boundaries are noisy, still keep only product-like rows from the table.",
    "If no product table rows are visible, return an empty array.",
    "Known structure:",
    JSON.stringify(structure),
    "Response schema:",
    JSON.stringify({
      tableRows: ["example row 1", "example row 2"],
    }),
    "OCR text:",
    rawText,
  ].join("\n\n");
}

function buildItemsPrompt(tableRows: string[], structure: InvoiceGeminiStructureResult) {
  return [
    "Parse Russian invoice table rows into structured items.",
    "Return strict JSON only.",
    "Each row is already from the goods table. Parse every plausible product row.",
    "If a row is partially damaged, still return an item with name and null numeric fields.",
    "Do not invent values. Unknown values must be null.",
    "Use the known document structure and column hints if helpful.",
    "Rows:",
    tableRows.map((row, index) => `${index + 1}. ${row}`).join("\n"),
    "Structure hints:",
    JSON.stringify(structure),
    "Response schema:",
    JSON.stringify({
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
  ].join("\n\n");
}

type PolzaMessage = {
  role: "system" | "user";
  content: string;
};

async function requestPolzaJson<T>(messages: PolzaMessage[], errorMessage: string, normalize: (value: unknown) => T): Promise<T> {
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
      messages,
    }),
  });

  if (!response.ok) {
    throw new Error(`${errorMessage}: HTTP ${response.status}.`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error(`${errorMessage}: пустой ответ.`);
  }

  return normalize(JSON.parse(content));
}

export function getInvoiceGeminiModel() {
  return process.env.POLZA_AI_MODEL?.trim() || "google/gemini-3.1-flash-lite";
}

export async function parseInvoiceWithGemini(rawText: string): Promise<InvoiceGeminiFullParseResult> {
  const systemPrompt =
    "You extract structure and product rows from Russian invoice OCR. Always return strict JSON only. Never add markdown.";

  const structure = await requestPolzaJson(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: buildStructurePrompt(rawText) },
    ],
    "Gemini не смог определить структуру накладной",
    normalizeStructureResult,
  );

  if (!structure.tableDetected) {
    return {
      structure,
      tableRows: [],
      items: [],
    };
  }

  const tableRows = await requestPolzaJson(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: buildTableRowsPrompt(rawText, structure) },
    ],
    "Gemini не смог выделить строки таблицы",
    normalizeTableRowsResult,
  );

  if (tableRows.length === 0) {
    return {
      structure,
      tableRows,
      items: [],
    };
  }

  const items = await requestPolzaJson(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: buildItemsPrompt(tableRows, structure) },
    ],
    "Gemini не смог разобрать строки таблицы",
    normalizeItemsResult,
  );

  return {
    structure,
    tableRows,
    items,
  };
}
