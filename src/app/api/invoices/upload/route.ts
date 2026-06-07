import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { jsonUtf8 } from "@/lib/http";
import { detectInvoiceDocumentMetadata } from "@/lib/invoice-document-detector";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 10;
const UPLOAD_DIRECTORY = path.join(/* turbopackIgnore: true */ process.cwd(), "public", "uploads", "invoices");

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const extensionByMimeType: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

export async function POST(request: Request) {
  const formData = await request.formData();
  const enterpriseId = String(formData.get("enterpriseId") ?? "").trim();
  const files = [...formData.getAll("file"), ...formData.getAll("files")]
    .filter((file): file is File => file instanceof File);

  if (!enterpriseId) {
    return jsonUtf8({ message: "Поле enterpriseId обязательно." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  if (files.length === 0) {
    return jsonUtf8({ message: "Файл обязателен." }, { status: 400 });
  }

  if (files.length > MAX_FILES_PER_UPLOAD) {
    return jsonUtf8({ message: "За одну загрузку можно добавить максимум 10 файлов." }, { status: 400 });
  }

  for (const file of files) {
    if (file.size === 0) {
      return jsonUtf8({ message: `Файл «${file.name || "без имени"}» пустой.` }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return jsonUtf8({ message: `Файл «${file.name || "без имени"}» слишком большой. Максимум 15 MB.` }, { status: 400 });
    }

    if (!allowedMimeTypes.has(file.type)) {
      return jsonUtf8({ message: `Файл «${file.name || "без имени"}» не подходит. Поддерживаются только JPG, PNG, WEBP и PDF.` }, { status: 400 });
    }
  }

  try {
    await mkdir(UPLOAD_DIRECTORY, { recursive: true });
    const storedFiles = [];

    for (const [index, file] of files.entries()) {
      const extension = extensionByMimeType[file.type];
      const storedFileName = `invoice_${Date.now()}_${randomUUID()}${extension}`;
      const storageKey = path.join("uploads", "invoices", storedFileName).replaceAll("\\", "/");
      const fileUrl = `/${storageKey}`;
      const absolutePath = path.join(UPLOAD_DIRECTORY, storedFileName);
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      await writeFile(absolutePath, buffer);
      storedFiles.push({
        fileUrl,
        storageKey,
        originalFileName: file.name.trim() || storedFileName,
        mimeType: file.type || null,
        pageIndex: index,
      });
    }

    const firstFile = storedFiles[0];

    const invoice = await prisma.invoiceDocument.create({
      data: {
        enterpriseId,
        originalFileName: firstFile?.originalFileName ?? null,
        fileUrl: firstFile?.fileUrl ?? null,
        storageKey: firstFile?.storageKey ?? null,
        status: "uploaded",
        files: {
          create: storedFiles,
        },
      },
      select: {
        id: true,
        status: true,
      },
    });

    for (const file of storedFiles) {
      try {
        const metadata = await detectInvoiceDocumentMetadata(file);
        console.info("[invoice-document-detector]", {
          fileName: file.originalFileName,
          invoiceNumber: metadata?.invoiceNumber ?? null,
          invoiceDate: metadata?.invoiceDate ?? null,
          supplierName: metadata?.supplierName ?? null,
          totalAmount: metadata?.totalAmount ?? null,
          confidence: metadata?.confidence ?? null,
        });
      } catch (error) {
        console.warn("[invoice-document-detector:failed]", {
          fileName: file.originalFileName,
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return jsonUtf8(
      {
        invoice: {
          ...invoice,
          filesCount: storedFiles.length,
        },
      },
      { status: 201 },
    );
  } catch {
    return jsonUtf8({ message: "Не удалось загрузить накладную." }, { status: 500 });
  }
}
