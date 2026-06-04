import { jsonUtf8 } from "@/lib/http";
import { filterInvoiceItems } from "@/lib/invoice-item-filter";
import { parseInvoiceItemsFromText } from "@/lib/invoice-item-parser";
import { sanitizeMoney, sanitizeQuantity } from "@/lib/invoice-number-sanitize";
import { matchInvoiceProduct } from "@/lib/invoice-product-match";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type ProductMatchStatus = "matched" | "ambiguous" | "not_found";

function normalizeSearchText(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/С‘/g, "Рµ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSearchWords(value: string) {
  return normalizeSearchText(value)
    .split(" ")
    .filter((token) => token.length > 1);
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
    return jsonUtf8({ message: "РџР°СЂР°РјРµС‚СЂ enterpriseId РѕР±СЏР·Р°С‚РµР»РµРЅ." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "РџСЂРµРґРїСЂРёСЏС‚РёРµ РЅРµ РЅР°Р№РґРµРЅРѕ." }, { status: 404 });
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
    return jsonUtf8({ message: "РќР°РєР»Р°РґРЅР°СЏ РЅРµ РЅР°Р№РґРµРЅР°." }, { status: 404 });
  }

  const rawText = invoice.rawText?.trim() ?? "";

  if (!rawText) {
    return jsonUtf8({ message: "РЈ РЅР°РєР»Р°РґРЅРѕР№ РЅРµС‚ С‚РµРєСЃС‚Р° РґР»СЏ СЂР°Р·Р±РѕСЂР°." }, { status: 400 });
  }

  const invoiceLines = parseInvoiceItemsFromText(rawText);
  const filteredLines = filterInvoiceItems(invoiceLines);

  if (filteredLines.accepted.length === 0) {
    await prisma.invoiceItem.deleteMany({
      where: {
        invoiceDocumentId: id,
      },
    });

    await prisma.invoiceDocument.update({
      where: {
        id,
      },
      data: {
        status: "needs_review",
      },
    });

    return jsonUtf8(
      {
        message: "РўРѕРІР°СЂРЅС‹Рµ СЃС‚СЂРѕРєРё РЅРµ РЅР°Р№РґРµРЅС‹. РџРѕРїСЂРѕР±СѓР№С‚Рµ Р±РѕР»РµРµ С‡С‘С‚РєРѕРµ С„РѕС‚Рѕ РёР»Рё РІРЅРµСЃРёС‚Рµ СЃС‚СЂРѕРєРё РІСЂСѓС‡РЅСѓСЋ.",
        itemsBeforeFilter: invoiceLines.length,
        filteredItemsCount: 0,
        rejectedItems: filteredLines.rejected,
      },
      { status: 400 },
    );
  }

  const parsedItems = await Promise.all(
    filteredLines.accepted.map(async (parsedItem) => {
      const sanitizedQuantity = sanitizeQuantity(parsedItem.quantity);
      const sanitizedPriceWithVat = sanitizeMoney(parsedItem.priceWithVat);
      const sanitizedLineTotal = sanitizeMoney(parsedItem.lineTotal);
      const forcedReview = sanitizedQuantity.forcedReview || sanitizedPriceWithVat.forcedReview || sanitizedLineTotal.forcedReview;

      const productMatch = await matchInvoiceProduct({
        enterpriseId,
        supplierId: invoice.supplierId,
        productNameRaw: parsedItem.productNameRaw,
      });

      const structuredParsed =
        sanitizedQuantity.value !== null && Boolean(parsedItem.unit) && sanitizedPriceWithVat.value !== null;

      const baseItem = {
        ...parsedItem,
        quantity: sanitizedQuantity.value,
        priceWithVat: sanitizedPriceWithVat.value,
        lineTotal: sanitizedLineTotal.value,
      };

      if (productMatch.status === "matched") {
        return {
          ...baseItem,
          matchedProductId: productMatch.matchedProductId,
          confidence: forcedReview ? 0.5 : structuredParsed ? (productMatch.confidence ?? 0.85) : 0.5,
          needsReview: forcedReview || !structuredParsed,
        };
      }

      if (productMatch.status === "ambiguous") {
        return {
          ...baseItem,
          matchedProductId: null,
          confidence: 0.5,
          needsReview: true,
        };
      }

      return {
        ...baseItem,
        matchedProductId: null,
        confidence: forcedReview ? 0.5 : Math.min(parsedItem.confidence, 0.35),
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
    itemsBeforeFilter: invoiceLines.length,
    filteredItemsCount: parsedItems.length,
    rejectedItems: filteredLines.rejected,
  });
}
