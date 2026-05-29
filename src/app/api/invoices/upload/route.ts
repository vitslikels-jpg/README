import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { jsonUtf8 } from "@/lib/http";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 15 * 1024 * 1024;
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
  const file = formData.get("file");

  if (!enterpriseId) {
    return jsonUtf8({ message: "Поле enterpriseId обязательно." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  if (!(file instanceof File)) {
    return jsonUtf8({ message: "Файл обязателен." }, { status: 400 });
  }

  if (file.size === 0) {
    return jsonUtf8({ message: "Нельзя загрузить пустой файл." }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return jsonUtf8({ message: "Файл слишком большой. Максимум 15 MB." }, { status: 400 });
  }

  if (!allowedMimeTypes.has(file.type)) {
    return jsonUtf8({ message: "Поддерживаются только JPG, PNG, WEBP и PDF." }, { status: 400 });
  }

  try {
    const extension = extensionByMimeType[file.type];
    const storedFileName = `invoice_${Date.now()}_${randomUUID()}${extension}`;
    const storageKey = path.join("uploads", "invoices", storedFileName).replaceAll("\\", "/");
    const fileUrl = `/${storageKey}`;
    const absolutePath = path.join(UPLOAD_DIRECTORY, storedFileName);
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    await mkdir(UPLOAD_DIRECTORY, { recursive: true });
    await writeFile(absolutePath, buffer);

    const invoice = await prisma.invoiceDocument.create({
      data: {
        enterpriseId,
        originalFileName: file.name.trim() || storedFileName,
        fileUrl,
        storageKey,
        status: "uploaded",
      },
      select: {
        id: true,
        status: true,
        originalFileName: true,
        fileUrl: true,
        createdAt: true,
      },
    });

    return jsonUtf8({ invoice }, { status: 201 });
  } catch {
    return jsonUtf8({ message: "Не удалось загрузить накладную." }, { status: 500 });
  }
}
