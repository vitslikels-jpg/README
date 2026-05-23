import { jsonUtf8 } from "@/lib/http";
import { getScopedDocument } from "@/lib/documents";

type RouteContext = {
  params: Promise<{
    documentId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { documentId } = await context.params;
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const document = await getScopedDocument(enterpriseId, documentId);

  if (!document) {
    return jsonUtf8({ message: "Документ не найден." }, { status: 404 });
  }

  return jsonUtf8(document);
}
