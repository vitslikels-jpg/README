import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { type DocumentSourceFormat, type DocumentStatus, type DocumentType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const UPLOAD_ROOT = path.join(/* turbopackIgnore: true */ process.cwd(), "storage", "documents");

const extensionToFormat: Record<string, DocumentSourceFormat> = {
  ".xls": "excel",
  ".xlsx": "excel",
  ".pdf": "pdf",
  ".doc": "word",
  ".docx": "word",
  ".csv": "csv",
  ".jpg": "image",
  ".jpeg": "image",
  ".png": "image",
  ".webp": "image",
  ".zip": "archive",
};

const mimeToFormat: Record<string, DocumentSourceFormat> = {
  "application/pdf": "pdf",
  "application/msword": "word",
  "application/vnd.ms-excel": "excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "word",
  "text/csv": "csv",
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "application/zip": "archive",
  "application/x-zip-compressed": "archive",
};

export type ScopedSupplier = {
  id: string;
  enterpriseId: string;
  name: string;
  phone: string | null;
  managerName: string | null;
  email: string | null;
  comment: string | null;
  minOrderAmount?: unknown;
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateStoredDocumentInput = {
  enterpriseId: string;
  supplierId: string;
  file: File;
};

export type DocumentListItem = {
  id: string;
  enterpriseId: string;
  supplierId: string;
  type: DocumentType;
  sourceFormat: DocumentSourceFormat;
  originalFileName: string;
  storedFilePath: string;
  mimeType: string;
  fileSize: number;
  status: DocumentStatus;
  uploadedAt: string;
  createdAt: string;
  updatedAt: string;
  isCurrent: boolean;
  qualityReport?: {
    id: string;
    qualityStatus: "good" | "warning" | "bad";
    totalRows: number;
    parsedProductsCount: number;
    rowsWithoutPrice: number;
    rowsWithoutUnit: number;
    rowsWithoutName: number;
    rowsWithoutArticle: number;
    newSupplierOffersCount: number;
    unmappedOffersCount: number;
    autoMappedOffersCount: number;
    lowConfidenceMappingsCount: number;
    manualMappedOffersCount: number;
    currentPriceSnapshotsCount: number;
    warningMessage: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
};

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function detectDocumentSourceFormat(fileName: string, mimeType: string) {
  const extension = path.extname(fileName).toLowerCase();
  const mime = mimeType.trim().toLowerCase();

  return extensionToFormat[extension] ?? mimeToFormat[mime] ?? "unknown";
}

export async function getScopedSupplier(
  enterpriseId: string,
  supplierId: string,
  options?: { includeArchived?: boolean },
) {
  return prisma.supplier.findFirst({
    where: {
      id: supplierId,
      enterpriseId,
      ...(options?.includeArchived ? {} : { archivedAt: null }),
    },
    select: {
      id: true,
      enterpriseId: true,
      name: true,
      phone: true,
      managerName: true,
      email: true,
      comment: true,
      minOrderAmount: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function getScopedDocument(enterpriseId: string, documentId: string) {
  return prisma.document.findFirst({
    where: {
      id: documentId,
      enterpriseId,
    },
    include: {
      qualityReport: true,
    },
  });
}

export async function listSupplierDocuments(enterpriseId: string, supplierId: string) {
  return prisma.document.findMany({
    where: {
      enterpriseId,
      supplierId,
    },
    include: {
      qualityReport: true,
    },
    orderBy: {
      uploadedAt: "desc",
    },
  });
}

export async function createStoredDocument({ enterpriseId, supplierId, file }: CreateStoredDocumentInput) {
  const originalFileName = file.name.trim();

  if (!originalFileName) {
    throw new Error("Не удалось определить имя файла.");
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const sourceFormat = detectDocumentSourceFormat(originalFileName, file.type);
  const extension = path.extname(originalFileName).toLowerCase();
  const safeName = sanitizeFileName(path.basename(originalFileName, extension));
  const storedFileName = `${Date.now()}-${randomUUID()}-${safeName || "document"}${extension}`;
  const relativeDirectory = path.join(enterpriseId, supplierId);
  const absoluteDirectory = path.join(UPLOAD_ROOT, relativeDirectory);
  const absolutePath = path.join(absoluteDirectory, storedFileName);
  const storedFilePath = path.join("storage", "documents", relativeDirectory, storedFileName).replaceAll("\\", "/");

  await mkdir(absoluteDirectory, { recursive: true });
  await writeFile(absolutePath, buffer);

  return prisma.document.create({
    data: {
      enterpriseId,
      supplierId,
      type: "price_list",
      sourceFormat,
      originalFileName,
      storedFilePath,
      mimeType: file.type || "application/octet-stream",
      fileSize: buffer.byteLength,
      status: "uploaded",
      isCurrent: false,
    },
  });
}
