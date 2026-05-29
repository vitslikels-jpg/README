import { access, mkdir, readFile } from "fs/promises";
import path from "path";
import { createWorker } from "tesseract.js";

const OCR_LANGS = "rus+eng";
const OCR_CACHE_DIRECTORY = path.join(process.cwd(), ".cache", "tesseract");
const INVOICE_UPLOAD_DIRECTORY = path.join(process.cwd(), "public", "uploads", "invoices");
const PDF_TEXT_THRESHOLD = 24;

type OcrResult = {
  rawText: string;
  source: "image_ocr" | "pdf_text" | "pdf_ocr";
};

function normalizeExtractedText(text: string) {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasEnoughPdfText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length >= PDF_TEXT_THRESHOLD;
}

function getInvoiceFilePath(storageKey: string | null, fileUrl: string | null) {
  const normalizedKey = (storageKey || fileUrl?.replace(/^\/+/, "") || "").replaceAll("\\", "/");

  if (!normalizedKey.startsWith("uploads/invoices/")) {
    throw new Error("Файл накладной вне разрешённой папки.");
  }

  const absolutePath = path.join(process.cwd(), "public", normalizedKey);
  const normalizedPath = path.normalize(absolutePath);
  const normalizedRoot = path.normalize(INVOICE_UPLOAD_DIRECTORY + path.sep);

  if (!normalizedPath.startsWith(normalizedRoot)) {
    throw new Error("Некорректный путь к файлу накладной.");
  }

  return normalizedPath;
}

async function recognizeImage(input: string | Buffer) {
  await mkdir(OCR_CACHE_DIRECTORY, { recursive: true });

  const worker = await createWorker(OCR_LANGS, 1, {
    cachePath: OCR_CACHE_DIRECTORY,
  });

  try {
    await worker.setParameters({
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
    });

    const result = await worker.recognize(input);
    return normalizeExtractedText(result.data.text || "");
  } finally {
    await worker.terminate();
  }
}

async function extractPdfText(buffer: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
  });

  try {
    const document = await loadingTask.promise;
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
        .join(" ")
        .trim();

      if (pageText) {
        pages.push(pageText);
      }
    }

    return {
      document,
      text: normalizeExtractedText(pages.join("\n\n")),
    };
  } catch (error) {
    await loadingTask.destroy();
    throw error;
  }
}

async function renderPdfPagesToImages(document: Awaited<ReturnType<typeof extractPdfText>>["document"]) {
  const dynamicRequire = (0, eval)("require") as (id: string) => { createCanvas: (width: number, height: number) => any };
  const { createCanvas } = dynamicRequire("@napi-rs/canvas");
  const images: Uint8Array[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");

    await page.render({
      canvas: canvas as never,
      canvasContext: context as never,
      viewport,
    }).promise;

    images.push(await canvas.encode("png"));
  }

  return images;
}

export async function extractInvoiceText(storageKey: string | null, fileUrl: string | null, originalFileName: string | null): Promise<OcrResult> {
  const filePath = getInvoiceFilePath(storageKey, fileUrl);
  await access(filePath);

  const lowerName = `${storageKey || ""} ${fileUrl || ""} ${originalFileName || ""}`.toLowerCase();

  if (/\.(jpg|jpeg|png|webp)\b/.test(lowerName)) {
    const rawText = await recognizeImage(filePath);

    if (!rawText) {
      throw new Error("OCR не смог распознать текст на изображении.");
    }

    return {
      rawText,
      source: "image_ocr",
    };
  }

  if (/\.pdf\b/.test(lowerName)) {
    const buffer = await readFile(filePath);
    const extracted = await extractPdfText(buffer);

    try {
      if (hasEnoughPdfText(extracted.text)) {
        return {
          rawText: extracted.text,
          source: "pdf_text",
        };
      }

      const pageImages = await renderPdfPagesToImages(extracted.document);
      const pages: string[] = [];

      for (const pageImage of pageImages) {
        const pageText = await recognizeImage(Buffer.from(pageImage));

        if (pageText) {
          pages.push(pageText);
        }
      }

      const rawText = normalizeExtractedText(pages.join("\n\n"));

      if (!rawText) {
        throw new Error("OCR не смог распознать текст в PDF.");
      }

      return {
        rawText,
        source: "pdf_ocr",
      };
    } finally {
      await extracted.document.cleanup();
      await extracted.document.loadingTask.destroy();
    }
  }

  throw new Error("Неподдерживаемый тип файла накладной.");
}
