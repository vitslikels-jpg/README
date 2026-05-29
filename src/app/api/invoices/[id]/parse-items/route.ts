import { Prisma } from "@prisma/client";
import { jsonUtf8 } from "@/lib/http";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type ProductMatchStatus = "matched" | "ambiguous" | "not_found";

const UNIT_TOKENS = new Set(["кг", "г", "л", "мл", "шт", "уп", "короб", "кор", "бут", "банка"]);

function parseNumericToken(token: string) {
  const normalized = token.trim().replace(",", ".");

  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    return null;
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function normalizeToken(token: string) {
  return token.toLowerCase().replace(/[.,;:!?()]/g, "");
}

function normalizeSearchText(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSearchWords(value: string) {
  return normalizeSearchText(value)
    .split(" ")
    .filter((token) => token.length > 1);
}

function buildDecimal(value: number, scale: number) {
  return new Prisma.Decimal(value).toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP);
}

function parseInvoiceLine(line: string) {
  const trimmedLine = line.trim();
  const tokens = trimmedLine.split(/\s+/).filter(Boolean);
  const normalizedTokens = tokens.map(normalizeToken);

  const unitIndex = normalizedTokens.findIndex((token) => UNIT_TOKENS.has(token));
  const quantityValue = unitIndex > 0 ? parseNumericToken(tokens[unitIndex - 1] ?? "") : null;
  const unitValue = unitIndex >= 0 ? normalizedTokens[unitIndex] : null;

  const numericTokensAfterUnit =
    unitIndex >= 0
      ? tokens
          .slice(unitIndex + 1)
          .map((token) => parseNumericToken(token))
          .filter((value): value is number => value !== null)
      : [];

  const priceWithVatValue =
    numericTokensAfterUnit.length >= 2
      ? numericTokensAfterUnit[numericTokensAfterUnit.length - 2]
      : numericTokensAfterUnit.length === 1
        ? numericTokensAfterUnit[0]
        : null;

  const lineTotalValue =
    numericTokensAfterUnit.length >= 2 ? numericTokensAfterUnit[numericTokensAfterUnit.length - 1] : null;

  const productNameRaw =
    unitIndex > 1 ? tokens.slice(0, unitIndex - 1).join(" ").trim() || trimmedLine : trimmedLine;

  const hasQuantity = quantityValue !== null;
  const hasUnit = Boolean(unitValue);
  const hasPrice = priceWithVatValue !== null;
  const recognizedCount = Number(hasQuantity) + Number(hasUnit) + Number(hasPrice);

  return {
    productNameRaw,
    quantity: hasQuantity ? buildDecimal(quantityValue as number, 3) : null,
    unit: unitValue,
    priceWithVat: hasPrice ? buildDecimal(priceWithVatValue as number, 2) : null,
    lineTotal: lineTotalValue !== null ? buildDecimal(lineTotalValue, 2) : null,
    confidence: recognizedCount === 3 ? 0.8 : recognizedCount > 0 ? 0.5 : 0.2,
    needsReview: recognizedCount < 3,
  };
}

async function matchProduct(params: {
  enterpriseId: string;
  supplierId: string | null;
  productNameRaw: string;
}) {
  const normalizedQuery = normalizeSearchText(params.productNameRaw);
  const searchWords = getSearchWords(params.productNameRaw);

  if (!normalizedQuery) {
    return {
      matchedProductId: null,
      matchStatus: "not_found" as ProductMatchStatus,
    };
  }

  const baseWhere = {
    enterpriseId: params.enterpriseId,
    ...(params.supplierId ? { supplierId: params.supplierId } : {}),
  };

  const exactCandidates = await prisma.product.findMany({
    where: baseWhere,
    select: {
      id: true,
      name: true,
    },
  });

  const exactMatches = exactCandidates.filter((candidate) => normalizeSearchText(candidate.name) === normalizedQuery);

  if (exactMatches.length === 1) {
    return {
      matchedProductId: exactMatches[0].id,
      matchStatus: "matched" as ProductMatchStatus,
    };
  }

  if (exactMatches.length > 1) {
    return {
      matchedProductId: null,
      matchStatus: "ambiguous" as ProductMatchStatus,
    };
  }

  const phraseMatches = await prisma.product.findMany({
    where: {
      ...baseWhere,
      name: {
        contains: params.productNameRaw.trim(),
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      name: true,
    },
    take: 10,
  });

  if (phraseMatches.length === 1) {
    return {
      matchedProductId: phraseMatches[0].id,
      matchStatus: "matched" as ProductMatchStatus,
    };
  }

  if (phraseMatches.length > 1) {
    return {
      matchedProductId: null,
      matchStatus: "ambiguous" as ProductMatchStatus,
    };
  }

  if (searchWords.length === 0) {
    return {
      matchedProductId: null,
      matchStatus: "not_found" as ProductMatchStatus,
    };
  }

  const topWords = searchWords
    .slice()
    .sort((left, right) => right.length - left.length)
    .slice(0, 4);

  const wordCandidates = await prisma.product.findMany({
    where: {
      ...baseWhere,
      OR: topWords.map((word) => ({
        name: {
          contains: word,
          mode: "insensitive",
        },
      })),
    },
    select: {
      id: true,
      name: true,
    },
    take: 25,
  });

  const scoredMatches = wordCandidates
    .map((candidate) => {
      const candidateWords = new Set(getSearchWords(candidate.name));
      let score = 0;

      for (const word of searchWords) {
        if (candidateWords.has(word)) {
          score += 1;
        }
      }

      return {
        id: candidate.id,
        score,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  if (scoredMatches.length === 0) {
    return {
      matchedProductId: null,
      matchStatus: "not_found" as ProductMatchStatus,
    };
  }

  const bestScore = scoredMatches[0]?.score ?? 0;
  const bestMatches = scoredMatches.filter((candidate) => candidate.score === bestScore);

  if (bestScore >= 2 && bestMatches.length === 1) {
    return {
      matchedProductId: bestMatches[0].id,
      matchStatus: "matched" as ProductMatchStatus,
    };
  }

  return {
    matchedProductId: null,
    matchStatus: "ambiguous" as ProductMatchStatus,
  };
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  const invoice = await prisma.invoiceDocument.findFirst({
    where: {
      id,
      enterpriseId,
    },
    select: {
      id: true,
      supplierId: true,
      rawText: true,
    },
  });

  if (!invoice) {
    return jsonUtf8({ message: "Накладная не найдена." }, { status: 404 });
  }

  const rawText = invoice.rawText?.trim() ?? "";

  if (!rawText) {
    return jsonUtf8({ message: "У накладной нет текста для разбора." }, { status: 400 });
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const parsedItems = await Promise.all(
    lines.map(async (line) => {
      const parsedItem = parseInvoiceLine(line);
      const productMatch = await matchProduct({
        enterpriseId,
        supplierId: invoice.supplierId,
        productNameRaw: parsedItem.productNameRaw,
      });

      const structuredParsed =
        parsedItem.quantity !== null && Boolean(parsedItem.unit) && parsedItem.priceWithVat !== null;

      if (productMatch.matchStatus === "matched") {
        return {
          ...parsedItem,
          matchedProductId: productMatch.matchedProductId,
          confidence: structuredParsed ? 0.85 : 0.5,
          needsReview: !structuredParsed,
        };
      }

      if (productMatch.matchStatus === "ambiguous") {
        return {
          ...parsedItem,
          matchedProductId: null,
          confidence: 0.5,
          needsReview: true,
        };
      }

      return {
        ...parsedItem,
        matchedProductId: null,
        confidence: Math.min(parsedItem.confidence, 0.35),
        needsReview: true,
      };
    }),
  );

  const reviewItemsCount = parsedItems.filter((item) => item.needsReview).length;

  await prisma.$transaction(async (tx) => {
    await tx.invoiceItem.deleteMany({
      where: {
        invoiceDocumentId: id,
      },
    });

    for (const item of parsedItems) {
      await tx.invoiceItem.create({
        data: {
          invoiceDocumentId: id,
          productNameRaw: item.productNameRaw,
          matchedProductId: item.matchedProductId,
          quantity: item.quantity,
          unit: item.unit,
          priceWithVat: item.priceWithVat,
          lineTotal: item.lineTotal,
          confidence: item.confidence,
          needsReview: item.needsReview,
        },
      });
    }

    await tx.invoiceDocument.update({
      where: {
        id,
      },
      data: {
        status: reviewItemsCount > 0 ? "needs_review" : "parsed",
      },
    });
  });

  return jsonUtf8({
    invoiceId: id,
    createdItemsCount: parsedItems.length,
    reviewItemsCount,
  });
}
