import { jsonUtf8 } from "@/lib/http";
import { getScopedDocument } from "@/lib/documents";
import { prisma } from "@/lib/prisma";

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

  if (!document.qualityReport) {
    return jsonUtf8({ message: "Quality-report для документа пока не рассчитан." }, { status: 404 });
  }

  return jsonUtf8(document.qualityReport);
}

export async function PATCH(request: Request, context: RouteContext) {
  const { documentId } = await context.params;
  const body = (await request.json().catch(() => null)) as
    | {
        enterpriseId?: string;
        manualReviewStatus?: "not_reviewed" | "in_review" | "approved" | "rejected";
        manualReviewComment?: string | null;
        manualReviewedBy?: string | null;
      }
    | null;

  const enterpriseId = body?.enterpriseId?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const document = await getScopedDocument(enterpriseId, documentId);

  if (!document) {
    return jsonUtf8({ message: "Документ не найден." }, { status: 404 });
  }

  if (!document.qualityReport) {
    return jsonUtf8({ message: "Quality-report для документа пока не рассчитан." }, { status: 404 });
  }

  const manualReviewStatus = body?.manualReviewStatus;

  if (!manualReviewStatus || !["not_reviewed", "in_review", "approved", "rejected"].includes(manualReviewStatus)) {
    return jsonUtf8({ message: "Поле manualReviewStatus заполнено некорректно." }, { status: 400 });
  }

  const manualReviewComment =
    typeof body?.manualReviewComment === "string" ? body.manualReviewComment.trim() : body?.manualReviewComment ?? null;
  const manualReviewedBy =
    typeof body?.manualReviewedBy === "string" ? body.manualReviewedBy.trim() : body?.manualReviewedBy ?? null;
  const shouldStampReviewedAt = manualReviewStatus === "approved" || manualReviewStatus === "rejected";

  const updatedReport = await prisma.documentQualityReport.update({
    where: {
      documentId,
    },
    data: {
      manualReviewStatus,
      manualReviewComment: manualReviewComment || null,
      manualReviewedBy: manualReviewedBy || document.qualityReport.manualReviewedBy || null,
      manualReviewedAt: shouldStampReviewedAt ? new Date() : null,
    },
  });

  return jsonUtf8(updatedReport);
}
