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

type RouteContext = {
  params: Promise<{
    optimizationId: string;
  }>;
};

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
    return jsonUtf8({ message: "Поле enterpriseId обязательно." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
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
    return jsonUtf8({ message: "Умный заказ не найден." }, { status: 404 });
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

  const optimization = await rebuildOrderOptimizationItems(optimizationId, enterpriseId);

  if (!optimization) {
    return jsonUtf8({ message: "Умный заказ не найден." }, { status: 404 });
  }

  await applyAiParsingFixes(optimizationId, enterpriseId);

  const updatedOptimization = await getOrderOptimizationWithDetails(optimizationId, enterpriseId);

  return jsonUtf8(serializeOrderOptimization(updatedOptimization ?? optimization));
}

