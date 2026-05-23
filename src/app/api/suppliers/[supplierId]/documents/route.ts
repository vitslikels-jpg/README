import { jsonUtf8 } from "@/lib/http";
import { createStoredDocument, getScopedSupplier, listSupplierDocuments } from "@/lib/documents";
import { parsePriceDocument } from "@/lib/price-parser";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    supplierId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { supplierId } = await context.params;
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const supplier = await getScopedSupplier(enterpriseId, supplierId);

  if (!supplier) {
    return jsonUtf8(
      { message: "Поставщик не найден для выбранного предприятия." },
      { status: 404 },
    );
  }

  const documents = await listSupplierDocuments(enterpriseId, supplierId);
  return jsonUtf8(documents);
}

export async function POST(request: Request, context: RouteContext) {
  const { supplierId } = await context.params;
  const formData = await request.formData();
  const enterpriseId = String(formData.get("enterpriseId") ?? "").trim();
  const file = formData.get("file");

  if (!enterpriseId) {
    return jsonUtf8({ message: "Поле enterpriseId обязательно." }, { status: 400 });
  }

  const supplier = await getScopedSupplier(enterpriseId, supplierId);

  if (!supplier) {
    return jsonUtf8(
      { message: "Поставщик не найден для выбранного предприятия." },
      { status: 404 },
    );
  }

  if (!(file instanceof File)) {
    return jsonUtf8({ message: "Файл обязателен." }, { status: 400 });
  }

  if (file.size === 0) {
    return jsonUtf8({ message: "Нельзя загрузить пустой файл." }, { status: 400 });
  }

  try {
    const document = await createStoredDocument({
      enterpriseId,
      supplierId,
      file,
    });

    const parseResult = await parsePriceDocument(document.id);

    const updatedDocument = await listSupplierDocuments(enterpriseId, supplierId).then(
      (documents) => documents.find((item) => item.id === document.id) ?? document,
    );

    if (parseResult.status === "failed") {
      return jsonUtf8(
        {
          message: parseResult.message ?? "Не удалось разобрать прайс.",
          document: updatedDocument,
        },
        { status: 500 },
      );
    }

    if (parseResult.message) {
      return jsonUtf8(
        {
          message: parseResult.message,
          document: updatedDocument,
        },
        { status: 500 },
      );
    }

    return jsonUtf8(updatedDocument, { status: 201 });
  } catch (error) {
    return jsonUtf8(
      {
        message: error instanceof Error ? error.message : "Не удалось загрузить и разобрать прайс.",
      },
      { status: 500 },
    );
  }
}
