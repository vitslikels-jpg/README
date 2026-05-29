import { jsonUtf8 } from "@/lib/http";
import {
  calculateRequestedAmount,
  getOrderOptimizationWithDetails,
  normalizeOptionalString,
  normalizeOrderOptimizationUnit,
  parseNullablePositiveDecimal,
  rebuildOrderOptimizationItems,
  serializeOrderOptimization,
} from "@/lib/order-optimizations";
import { suggestOrderOptimizationItem } from "@/lib/order-optimization-ai";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { isSmartOrderAiParseEnabled, requestSmartOrderAiParse } from "@/lib/smart-order-ai-parse";

type RouteContext = {
  params: Promise<{
    optimizationId: string;
  }>;
};

function logSmartOrderParse(params: {
  optimizationId: string;
  enterpriseId: string;
  source: "ai" | "regex";
  fallback: boolean;
  itemCount?: number;
  reason?: string | null;
}) {
  const parts = [
    "[smart-order][parse]",
    `optimizationId=${params.optimizationId}`,
    `enterpriseId=${params.enterpriseId}`,
    `source=${params.source}`,
    `fallback=${params.fallback ? "true" : "false"}`,
  ];

  if (typeof params.itemCount === "number") {
    parts.push(`items=${params.itemCount}`);
  }

  if (params.reason) {
    parts.push(`reason=${params.reason}`);
  }

  console.info(parts.join(" "));
}

async function buildAiParsedItems(sourceText: string) {
  const aiResponse = await requestSmartOrderAiParse(sourceText);

  return aiResponse.items.map((item, index) => {
    let parsedQuantity = null as ReturnType<typeof parseNullablePositiveDecimal> | null;

    try {
      if (item.quantity) {
        parsedQuantity = parseNullablePositiveDecimal(item.quantity, "quantity");
      }
    } catch {
      parsedQuantity = null;
    }

    const parsedUnit = normalizeOrderOptimizationUnit(item.unit);
    const parsedName = normalizeOptionalString(item.parsedName) ?? item.originalLine.trim() ?? sourceText.trim();
    const requestedSupplierName = normalizeOptionalString(item.requestedSupplierName);
    const isReview = item.needsReview || item.confidence < 0.75;

    return {
      sourceLine: item.originalLine.trim() || sourceText.trim(),
      requestedSupplierName,
      lockSupplier: false,
      parsedName,
      parsedQuantity,
      parsedUnit,
      requestedAmount: calculateRequestedAmount(parsedQuantity, parsedUnit),
      sortOrder: index + 1,
      matchStatus: isReview ? ("review" as const) : ("pending" as const),
      notes: null,
    };
  });
}

async function applyAiParsingFixes(optimizationId: string, enterpriseId: string) {
  const optimization = await prisma.orderOptimization.findFirst({
    where: {
      id: optimizationId,
      enterpriseId,
    },
    include: {
      items: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  if (!optimization?.items.length) {
    return;
  }

  const updates = (
    await Promise.all(
      optimization.items.map(async (item) => {
        const needsAiFix =
          !item.parsedName?.trim() ||
          item.parsedName.trim() === item.sourceLine.trim() ||
          !item.parsedQuantity ||
          !item.parsedUnit;

        if (!needsAiFix) {
          return null;
        }

        const suggestion = await suggestOrderOptimizationItem(item);

        if (suggestion.source === "local") {
          return null;
        }

        const nextName = normalizeOptionalString(suggestion.suggestedName) ?? item.parsedName ?? item.sourceLine;
        const nextSupplierName = item.requestedSupplierName ?? normalizeOptionalString(suggestion.suggestedSupplierName);
        const nextUnit = item.parsedUnit ?? normalizeOrderOptimizationUnit(suggestion.suggestedUnit);

        let nextQuantity = item.parsedQuantity;

        try {
          if (!item.parsedQuantity && suggestion.suggestedQuantity) {
            nextQuantity = parseNullablePositiveDecimal(suggestion.suggestedQuantity, "suggestedQuantity");
          }
        } catch {
          nextQuantity = item.parsedQuantity;
        }

        const hasChanges =
          nextName !== item.parsedName ||
          nextSupplierName !== item.requestedSupplierName ||
          String(nextQuantity?.toString() ?? "") !== String(item.parsedQuantity?.toString() ?? "") ||
          nextUnit !== item.parsedUnit;

        if (!hasChanges) {
          return null;
        }

        return {
          id: item.id,
          requestedSupplierName: nextSupplierName,
          parsedName: nextName,
          parsedQuantity: nextQuantity?.toString() ?? null,
          parsedUnit: nextUnit,
          requestedAmount: calculateRequestedAmount(nextQuantity, nextUnit)?.toString() ?? null,
        };
      }),
    )
  ).filter(
    (
      update,
    ): update is {
      id: string;
      requestedSupplierName: string | null;
      parsedName: string;
      parsedQuantity: string | null;
      parsedUnit: string | null;
      requestedAmount: string | null;
    } => Boolean(update),
  );

  if (updates.length === 0) {
    return;
  }

  await prisma.$transaction(
    updates.map((update) =>
      prisma.orderOptimizationItem.update({
        where: {
          id: update.id,
        },
        data: {
          requestedSupplierName: update.requestedSupplierName,
          parsedName: update.parsedName,
          parsedQuantity: update.parsedQuantity,
          parsedUnit: update.parsedUnit,
          requestedAmount: update.requestedAmount,
        },
      }),
    ),
  );
}

export async function POST(request: Request, context: RouteContext) {
  const { optimizationId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    enterpriseId?: string;
    title?: string | null;
    sourceText?: string;
  };
  const enterpriseId = body.enterpriseId?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "РџРѕР»Рµ enterpriseId РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "РџСЂРµРґРїСЂРёСЏС‚РёРµ РЅРµ РЅР°Р№РґРµРЅРѕ." }, { status: 404 });
  }

  const existingOptimization = await prisma.orderOptimization.findFirst({
    where: {
      id: optimizationId,
      enterpriseId,
    },
    select: {
      id: true,
    },
  });

  if (!existingOptimization) {
    return jsonUtf8({ message: "РЈРјРЅС‹Р№ Р·Р°РєР°Р· РЅРµ РЅР°Р№РґРµРЅ." }, { status: 404 });
  }

  const hasTitle = Object.prototype.hasOwnProperty.call(body, "title");
  const hasSourceText = Object.prototype.hasOwnProperty.call(body, "sourceText");

  if (hasTitle || hasSourceText) {
    await prisma.orderOptimization.update({
      where: {
        id: optimizationId,
      },
      data: {
        ...(hasTitle ? { title: normalizeOptionalString(body.title) } : {}),
        ...(hasSourceText ? { sourceText: String(body.sourceText ?? "") } : {}),
      },
    });
  }

  const latestOptimization = await prisma.orderOptimization.findFirst({
    where: {
      id: optimizationId,
      enterpriseId,
    },
    select: {
      id: true,
      sourceText: true,
    },
  });

  if (!latestOptimization) {
    return jsonUtf8({ message: "РЈРјРЅС‹Р№ Р·Р°РєР°Р· РЅРµ РЅР°Р№РґРµРЅ." }, { status: 404 });
  }

  const useAiFirstParse = isSmartOrderAiParseEnabled();
  let optimization = null;

  if (!useAiFirstParse) {
    optimization = await rebuildOrderOptimizationItems(optimizationId, enterpriseId, {
      parseSource: "regex",
    });
  } else {
    try {
      const aiParsedItems = await buildAiParsedItems(latestOptimization.sourceText);

      if (aiParsedItems.length === 0) {
        throw new Error("empty_items");
      }

      optimization = await rebuildOrderOptimizationItems(optimizationId, enterpriseId, {
        parsedItems: aiParsedItems,
        parseSource: "ai",
      });

      logSmartOrderParse({
        optimizationId,
        enterpriseId,
        source: "ai",
        fallback: false,
        itemCount: aiParsedItems.length,
      });
    } catch (error) {
      optimization = await rebuildOrderOptimizationItems(optimizationId, enterpriseId, {
        parseSource: "ai_fallback_regex",
      });

      logSmartOrderParse({
        optimizationId,
        enterpriseId,
        source: "regex",
        fallback: true,
        reason: error instanceof Error ? error.message.slice(0, 80) : "unknown",
      });
    }
  }

  if (!optimization) {
    return jsonUtf8({ message: "РЈРјРЅС‹Р№ Р·Р°РєР°Р· РЅРµ РЅР°Р№РґРµРЅ." }, { status: 404 });
  }

  if (!useAiFirstParse) {
    await applyAiParsingFixes(optimizationId, enterpriseId);
    logSmartOrderParse({
      optimizationId,
      enterpriseId,
      source: "regex",
      fallback: false,
      itemCount: optimization.items.length,
    });
  }

  const updatedOptimization = await getOrderOptimizationWithDetails(optimizationId, enterpriseId);

  return jsonUtf8(serializeOrderOptimization(updatedOptimization ?? optimization));
}
