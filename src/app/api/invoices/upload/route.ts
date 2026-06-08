import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { jsonUtf8 } from "@/lib/http";
import { detectInvoiceDocumentMetadata } from "@/lib/invoice-document-detector";
import { runInvoiceProcessingPipeline } from "@/lib/invoice-processing-pipeline";
import { matchInvoiceSupplier } from "@/lib/invoice-supplier-match";
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

type StoredFile = {
  fileUrl: string;
  storageKey: string;
  originalFileName: string;
  mimeType: string | null;
  pageIndex: number;
};

type DetectedFileMetadata = {
  invoiceNumber: string | null;
  invoiceDate: string | null;
  supplierName: string | null;
  totalAmount: number | null;
  confidence: number | null;
};

type GroupedStoredFile = StoredFile & {
  detectedMetadata: DetectedFileMetadata | null;
};

function buildGroupKey(metadata: DetectedFileMetadata | null) {
  if (!metadata?.invoiceNumber) {
    return "unknown";
  }

  return [
    metadata.supplierName?.trim().toLowerCase() || "",
    metadata.invoiceNumber.trim().toLowerCase(),
    metadata.invoiceDate?.trim().toLowerCase() || "",
  ].join("::");
}

function pickGroupMetadata(files: GroupedStoredFile[]) {
  return files
    .map((file) => file.detectedMetadata)
    .filter((metadata): metadata is DetectedFileMetadata => Boolean(metadata))
    .sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0))[0] ?? null;
}

function parseDetectedInvoiceDate(value: string | null) {
  if (!value) {
    return null;
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    const parsedDate = new Date(`${normalizedValue}T00:00:00.000Z`);
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  }

  const fallbackDate = new Date(normalizedValue);
  return Number.isNaN(fallbackDate.getTime()) ? null : fallbackDate;
}

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
    const storedFiles: StoredFile[] = [];

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

    const detectedFiles: GroupedStoredFile[] = [];

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
        detectedFiles.push({
          ...file,
          detectedMetadata: metadata,
        });
      } catch (error) {
        console.warn("[invoice-document-detector:failed]", {
          fileName: file.originalFileName,
          message: error instanceof Error ? error.message : "Unknown error",
        });
        detectedFiles.push({
          ...file,
          detectedMetadata: null,
        });
      }
    }

    const groupedFiles =
      detectedFiles.length <= 1
        ? new Map<string, GroupedStoredFile[]>([["single", detectedFiles]])
        : detectedFiles.reduce((groups, file) => {
            const groupKey = buildGroupKey(file.detectedMetadata);
            const current = groups.get(groupKey);

            if (current) {
              current.push(file);
            } else {
              groups.set(groupKey, [file]);
            }

            return groups;
          }, new Map<string, GroupedStoredFile[]>());

    const createdInvoices = [];

    for (const groupFiles of groupedFiles.values()) {
      const normalizedFiles = groupFiles
        .sort((left, right) => left.pageIndex - right.pageIndex)
        .map((file, index) => ({
          fileUrl: file.fileUrl,
          storageKey: file.storageKey,
          originalFileName: file.originalFileName,
          mimeType: file.mimeType,
          pageIndex: index,
        }));
      const firstFile = normalizedFiles[0];
      const groupMetadata = pickGroupMetadata(groupFiles);
      const supplierMatch = groupMetadata?.supplierName ? await matchInvoiceSupplier(groupMetadata.supplierName, enterpriseId).catch(() => null) : null;

      const invoice = await prisma.invoiceDocument.create({
        data: {
          enterpriseId,
          supplierId: supplierMatch?.supplierId ?? null,
          originalFileName: firstFile?.originalFileName ?? null,
          fileUrl: firstFile?.fileUrl ?? null,
          storageKey: firstFile?.storageKey ?? null,
          status: "uploaded",
          detectedSupplierName: groupMetadata?.supplierName ?? null,
          confidence: supplierMatch?.confidence ?? groupMetadata?.confidence ?? null,
          invoiceNumber: groupMetadata?.invoiceNumber ?? null,
          invoiceDate: parseDetectedInvoiceDate(groupMetadata?.invoiceDate ?? null),
          totalAmount: groupMetadata?.totalAmount ?? null,
          files: {
            create: normalizedFiles,
          },
        },
        select: {
          id: true,
          status: true,
          invoiceNumber: true,
        },
      });

      createdInvoices.push({
        ...invoice,
        filesCount: normalizedFiles.length,
      });
    }

    const baseUrl = new URL(request.url).origin;
    const cookieHeader = request.headers.get("cookie");
    const processedInvoices = [];

    for (const invoice of createdInvoices) {
      const processedInvoice = await runInvoiceProcessingPipeline({
        invoiceId: invoice.id,
        enterpriseId,
        baseUrl,
        cookieHeader,
      });

      processedInvoices.push({
        ...invoice,
        invoiceNumber: processedInvoice.invoiceNumber ?? invoice.invoiceNumber,
        status: processedInvoice.status ?? invoice.status,
        itemsCount: processedInvoice.itemsCount,
        reviewItemsCount: processedInvoice.reviewItemsCount,
        priceChangesCount: processedInvoice.priceChangesCount,
        processingError: processedInvoice.processingError,
      });
    }

    const processedCount = processedInvoices.filter((invoice) => !invoice.processingError).length;
    const failedCount = processedInvoices.length - processedCount;

    console.info("[invoice-upload:grouping]", {
      filesCount: storedFiles.length,
      detectedDocumentsCount: createdInvoices.length,
      invoiceNumbers: createdInvoices.map((invoice) => invoice.invoiceNumber ?? null),
      splitApplied: storedFiles.length > 1 && createdInvoices.length > 1,
      processedCount,
      failedCount,
    });

    return jsonUtf8(
      {
        invoice: processedInvoices[0] ?? null,
        invoices: processedInvoices,
        createdCount: processedInvoices.length,
        processedCount,
        failedCount,
        splitApplied: storedFiles.length > 1 && createdInvoices.length > 1,
      },
      { status: 201 },
    );
  } catch {
    return jsonUtf8({ message: "Не удалось загрузить накладную." }, { status: 500 });
  }
}
