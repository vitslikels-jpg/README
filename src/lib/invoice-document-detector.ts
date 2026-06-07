import { access, readFile, stat } from "fs/promises";
import path from "path";
import type { InvoiceVisionInputFile } from "@/lib/invoice-gemini-vision-parser";

const INVOICE_UPLOAD_DIRECTORY = path.join(process.cwd(), "public", "uploads", "invoices");
const MAX_UPLOAD_FILE_SIZE_BYTES = 15 * 1024 * 1024;

export type InvoiceDocumentMetadata = {
  invoiceNumber: string | null;
  invoiceDate: string | null;
  supplierName: string | null;
  totalAmount: number | null;
  confidence: number | null;
};

function joinApiUrl(baseUrl: string, routePath: string) {
  return `${baseUrl.replace(/\/+$/u, "")}/${routePath.replace(/^\/+/u, "")}`;
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

function clampConfidence(value: unknown) {
  const numericValue = normalizeNumber(value);

  if (numericValue === null) {
    return null;
  }

  return Math.max(0, Math.min(1, numericValue));
}

function normalizeMetadata(value: unknown): InvoiceDocumentMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invoice detector returned invalid JSON.");
  }

  const result = value as Record<string, unknown>;

  return {
    invoiceNumber: normalizeText(result.invoiceNumber),
    invoiceDate: normalizeText(result.invoiceDate),
    supplierName: normalizeText(result.supplierName),
    totalAmount: normalizeNumber(result.totalAmount),
    confidence: clampConfidence(result.confidence),
  };
}

function getInvoiceFilePath(storageKey: string | null, fileUrl: string | null) {
  const normalizedKey = (storageKey || fileUrl?.replace(/^\/+/, "") || "").replaceAll("\\", "/");

  if (!normalizedKey.startsWith("uploads/invoices/")) {
    throw new Error("Invoice file is outside uploads/invoices.");
  }

  const absolutePath = path.join(process.cwd(), "public", normalizedKey);
  const normalizedPath = path.normalize(absolutePath);
  const normalizedRoot = path.normalize(INVOICE_UPLOAD_DIRECTORY + path.sep);

  if (!normalizedPath.startsWith(normalizedRoot)) {
    throw new Error("Invalid invoice file path.");
  }

  return normalizedPath;
}

function detectImageMimeType(file: InvoiceVisionInputFile) {
  const explicitMimeType = file.mimeType?.trim().toLowerCase();

  if (explicitMimeType && /^image\//u.test(explicitMimeType)) {
    return explicitMimeType;
  }

  const candidate = `${file.storageKey || ""} ${file.fileUrl || ""} ${file.originalFileName || ""}`.toLowerCase();

  if (candidate.includes(".png")) {
    return "image/png";
  }

  if (candidate.includes(".webp")) {
    return "image/webp";
  }

  if (candidate.includes(".jpg") || candidate.includes(".jpeg")) {
    return "image/jpeg";
  }

  return null;
}

function buildMetadataPrompt(fileName: string | null) {
  return [
    "Разбери одно фото русской накладной.",
    "Верни только строгий JSON без markdown.",
    "Нужно определить только метаданные документа, не товары.",
    "Если значение не видно или неуверенно, верни null.",
    "invoiceDate верни в формате YYYY-MM-DD, если можешь определить надёжно.",
    "confidence верни числом от 0 до 1 — насколько ты уверен, что это именно номер/дата/поставщик этой накладной.",
    fileName ? `Имя файла: ${fileName}` : "Имя файла: неизвестно",
    "JSON schema:",
    JSON.stringify({
      invoiceNumber: null,
      invoiceDate: null,
      supplierName: null,
      totalAmount: null,
      confidence: null,
    }),
  ].join("\n\n");
}

export async function detectInvoiceDocumentMetadata(file: InvoiceVisionInputFile): Promise<InvoiceDocumentMetadata | null> {
  const provider = getPolzaProvider();

  if (!provider) {
    return null;
  }

  const mimeType = detectImageMimeType(file);

  if (!mimeType) {
    return null;
  }

  const filePath = getInvoiceFilePath(file.storageKey, file.fileUrl);
  await access(filePath);
  const fileStat = await stat(filePath);

  if (fileStat.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
    return null;
  }

  const buffer = await readFile(filePath);
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;

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
          content: "Ты извлекаешь только метаданные русской накладной с одного фото. Возвращаешь только JSON.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildMetadataPrompt(file.originalFileName),
            },
            {
              type: "image_url",
              image_url: {
                url: dataUrl,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Invoice detector failed: HTTP ${response.status}.`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Invoice detector returned empty response.");
  }

  return normalizeMetadata(JSON.parse(content));
}
