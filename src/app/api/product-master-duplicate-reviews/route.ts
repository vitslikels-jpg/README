import { ProductMasterDuplicateReviewStatus } from "@prisma/client";
import { jsonUtf8 } from "@/lib/http";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type PutBody = {
  enterpriseId?: string;
  normalizedName?: string;
  masterIds?: unknown;
  status?: string;
  comment?: string | null;
  reviewedBy?: string | null;
};

function normalizeString(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeMasterIds(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const ids = Array.from(
    new Set(
      value
        .map((item) => String(item ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));

  return ids.length > 0 ? ids : null;
}

function parseStatus(value: string | undefined) {
  if (value === ProductMasterDuplicateReviewStatus.duplicate) {
    return ProductMasterDuplicateReviewStatus.duplicate;
  }

  if (value === ProductMasterDuplicateReviewStatus.not_duplicate) {
    return ProductMasterDuplicateReviewStatus.not_duplicate;
  }

  if (value === ProductMasterDuplicateReviewStatus.needs_review) {
    return ProductMasterDuplicateReviewStatus.needs_review;
  }

  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  const reviews = await prisma.productMasterDuplicateReview.findMany({
    where: {
      enterpriseId,
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  return jsonUtf8(reviews);
}

export async function PUT(request: Request) {
  const body = (await request.json()) as PutBody;
  const enterpriseId = body.enterpriseId?.trim();
  const normalizedName = body.normalizedName?.trim();
  const status = parseStatus(body.status);
  const masterIds = normalizeMasterIds(body.masterIds);
  const comment = normalizeString(body.comment);
  const reviewedBy = normalizeString(body.reviewedBy);

  if (!enterpriseId) {
    return jsonUtf8({ message: "Поле enterpriseId обязательно." }, { status: 400 });
  }

  if (!normalizedName) {
    return jsonUtf8({ message: "Поле normalizedName обязательно." }, { status: 400 });
  }

  if (!status) {
    return jsonUtf8({ message: "Поле status должно быть duplicate, not_duplicate или needs_review." }, { status: 400 });
  }

  if (!masterIds) {
    return jsonUtf8({ message: "Поле masterIds должно содержать хотя бы один id." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  const reviewedAt = status === ProductMasterDuplicateReviewStatus.needs_review ? null : new Date();

  const review = await prisma.productMasterDuplicateReview.upsert({
    where: {
      enterpriseId_normalizedName: {
        enterpriseId,
        normalizedName,
      },
    },
    create: {
      enterpriseId,
      normalizedName,
      masterIds,
      status,
      comment,
      reviewedAt,
      reviewedBy,
    },
    update: {
      masterIds,
      status,
      comment,
      reviewedAt,
      reviewedBy,
    },
  });

  return jsonUtf8(review);
}
