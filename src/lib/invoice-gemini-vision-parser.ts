import { access, readFile, stat } from "fs/promises";
import path from "path";

const INVOICE_UPLOAD_DIRECTORY = path.join(process.cwd(), "public", "uploads", "invoices");
const MAX_VISION_IMAGES = 5;
const MAX_UPLOAD_FILE_SIZE_BYTES = 15 * 1024 * 1024;

type InvoiceVisionItem = {
  name: string | null;
  quantity: number | null;
  unit: string | null;
  priceWithVat: number | null;
  priceWithoutVat: number | null;
  vatRate: number | null;
  lineTotal: number | null;
};

export type InvoiceVisionInputFile = {
  storageKey: string | null;
  fileUrl: string | null;
  originalFileName: string | null;
  mimeType: string | null;
  pageIndex: number;
};

export type InvoiceGeminiVisionParseResult = {
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  totalAmount: number | null;
  vatAmount: number | null;
  items: InvoiceVisionItem[];
};

export class InvoiceVisionUnsupportedError extends Error {}

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

  const normalizedValue = String(value)
    .replace(/\s+/g, "")
    .replace("%", "")
    .replace(",", ".");

  const numericValue = typeof value === "number" ? value : Number(normalizedValue);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function normalizeItem(value: unknown): InvoiceVisionItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const item = value as Record<string, unknown>;
  const name = normalizeText(item.name) ?? normalizeText(item.productNameRaw) ?? normalizeText(item.productName);

  if (!name) {
    return null;
  }

  return {
    name,
    quantity: normalizeNumber(item.quantity),
    unit: normalizeText(item.unit),
    priceWithVat: normalizeNumber(item.priceWithVat ?? item.price),
    priceWithoutVat: normalizeNumber(item.priceWithoutVat ?? item.unitPriceWithoutVat),
    vatRate: normalizeNumber(item.vatRate ?? item.vat),
    lineTotal: normalizeNumber(item.lineTotal ?? item.lineTotalWithVat ?? item.amount ?? item.total),
  };
}

function normalizeVisionEntry(value: unknown): InvoiceGeminiVisionParseResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const result = value as Record<string, unknown>;

  return {
    supplierName: normalizeText(result.supplierName),
    invoiceNumber: normalizeText(result.invoiceNumber),
    invoiceDate: normalizeText(result.invoiceDate),
    totalAmount: normalizeNumber(result.totalAmount),
    vatAmount: normalizeNumber(result.vatAmount),
    items: Array.isArray(result.items) ? result.items.map(normalizeItem).filter((item): item is InvoiceVisionItem => Boolean(item)) : [],
  };
}

function normalizeVisionResult(value: unknown): InvoiceGeminiVisionParseResult {
  if (Array.isArray(value)) {
    const entries = value.map(normalizeVisionEntry).filter((entry): entry is InvoiceGeminiVisionParseResult => Boolean(entry));

    if (entries.length === 0) {
      throw new Error("Gemini vision вернул некорректный JSON.");
    }

    return {
      supplierName: entries.find((entry) => entry.supplierName)?.supplierName ?? null,
      invoiceNumber: entries.find((entry) => entry.invoiceNumber)?.invoiceNumber ?? null,
      invoiceDate: entries.find((entry) => entry.invoiceDate)?.invoiceDate ?? null,
      totalAmount: entries.find((entry) => entry.totalAmount !== null)?.totalAmount ?? null,
      vatAmount: entries.find((entry) => entry.vatAmount !== null)?.vatAmount ?? null,
      items: entries.flatMap((entry) => entry.items),
    };
  }

  const entry = normalizeVisionEntry(value);

  if (!entry) {
    throw new Error("Gemini vision вернул некорректный JSON.");
  }

  return entry;
}

function getInvoiceFilePath(storageKey: string | null, fileUrl: string | null) {
  const normalizedKey = (storageKey || fileUrl?.replace(/^\/+/, "") || "").replaceAll("\\", "/");

  if (!normalizedKey.startsWith("uploads/invoices/")) {
    throw new Error("Файл накладной вне разрешенной папки.");
  }

  const absolutePath = path.join(process.cwd(), "public", normalizedKey);
  const normalizedPath = path.normalize(absolutePath);
  const normalizedRoot = path.normalize(INVOICE_UPLOAD_DIRECTORY + path.sep);

  if (!normalizedPath.startsWith(normalizedRoot)) {
    throw new Error("Некорректный путь к файлу накладной.");
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

async function loadVisionImages(files: InvoiceVisionInputFile[]) {
  const imageFiles = files
    .filter((file) => Boolean(detectImageMimeType(file)))
    .sort((left, right) => left.pageIndex - right.pageIndex)
    .slice(0, MAX_VISION_IMAGES);

  const images: string[] = [];

  for (const file of imageFiles) {
    const mimeType = detectImageMimeType(file);

    if (!mimeType) {
      continue;
    }

    const filePath = getInvoiceFilePath(file.storageKey, file.fileUrl);
    await access(filePath);
    const fileStat = await stat(filePath);

    if (fileStat.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
      continue;
    }

    const buffer = await readFile(filePath);
    images.push(`data:${mimeType};base64,${buffer.toString("base64")}`);
  }

  return images;
}

function buildVisionPrompt(rawText: string | null | undefined) {
  const ocrHint = rawText?.trim()
    ? `OCR text hint:\n${rawText.replace(/\s+/g, " ").trim().slice(0, 4000)}`
    : "OCR text hint: not available";

  return [
    "Разбери русскую накладную по изображению.",
    "Верни только строгий JSON без markdown.",
    "Не придумывай данные. Если значение не видно или неясно, верни null.",
    "Нужны только реальные товарные строки. Игнорируй реквизиты, ИНН, адреса, подписи, печати, итоги по документу, заголовки разделов и служебные блоки.",
    "Если строка товара читается частично, все равно верни item с name и null в непонятных числовых полях.",
    "Очень важно: не путай фасовку внутри названия товара с количеством в строке.",
    "Например, '100шт', '1кг/6шт', '110*160', '160*200', '200*300', '72мкм', '75мкм' это часть названия, а не quantity.",
    "Если в колонке количества написано '600,000', '400,000', '500,000', это quantity = 600 / 400 / 500.",
    "Если в таблице есть колонки 'Количество (объем)', 'Цена за единицу измерения', 'Стоимость товаров без налога - всего', 'Налоговая ставка', 'Сумма налога', 'Стоимость товаров с налогом - всего', то маппинг должен быть строгим:",
    "- quantity = колонка количества",
    "- priceWithoutVat = цена за единицу без НДС",
    "- vatRate = ставка НДС",
    "- lineTotal = итоговая сумма строки с НДС, то есть колонка 'Стоимость товаров с налогом - всего'",
    "- priceWithVat = lineTotal / quantity, если видны quantity и lineTotal",
    "Не путай priceWithoutVat, сумму строки без НДС, сумму НДС и итог с НДС.",
    "Для поставщика Horeca / Хорека часто именно такой макет: колонка 4 = цена без НДС за 1 шт, колонка 5 = сумма без НДС по строке, колонка 8 = сумма НДС, колонка 9 = сумма по строке с НДС.",
    "Для Horeca lineTotal нужно брать именно из колонки 9, а не из колонки 5 и не из колонки 8.",
    "JSON schema:",
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
    ocrHint,
  ].join("\n\n");
}

export async function parseInvoiceWithGeminiVision(
  files: InvoiceVisionInputFile[],
  rawText?: string | null,
): Promise<InvoiceGeminiVisionParseResult> {
  const provider = getPolzaProvider();

  if (!provider) {
    throw new Error("POLZA_AI_API_KEY не настроен. AI-разбор накладной недоступен.");
  }

  const imageDataUrls = await loadVisionImages(files);

  if (imageDataUrls.length === 0) {
    throw new InvoiceVisionUnsupportedError("Нет подходящих изображений для AI-разбора.");
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
            "Ты разбираешь русские накладные по изображениям и возвращаешь только JSON. Никаких пояснений, только факты из документа.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildVisionPrompt(rawText),
            },
            ...imageDataUrls.map((url) => ({
              type: "image_url",
              image_url: {
                url,
              },
            })),
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    const normalizedError = responseText.toLowerCase();

    if (
      response.status === 400 ||
      response.status === 404 ||
      response.status === 415 ||
      response.status === 422 ||
      normalizedError.includes("image_url") ||
      normalizedError.includes("unsupported") ||
      normalizedError.includes("vision") ||
      normalizedError.includes("multimodal")
    ) {
      throw new InvoiceVisionUnsupportedError("Текущий AI-провайдер не поддерживает разбор изображения напрямую.");
    }

    throw new Error(`Gemini vision не разобрал накладную: HTTP ${response.status}.`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Gemini vision вернул пустой ответ.");
  }

  return normalizeVisionResult(JSON.parse(content));
}
