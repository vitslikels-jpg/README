import { jsonUtf8 } from "@/lib/http";
import { getOrderOptimizationWithDetails, serializeOrderOptimization } from "@/lib/order-optimizations";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { createManualProductMapping } from "@/lib/product-catalog";

type RouteContext = {
  params: Promise<{
    optimizationId: string;
    itemId: string;
  }>;
};

type ManualLearningCandidate = {
  id: string;
  selectedProductId: string | null;
  selectedSupplierOfferId: string | null;
  selectedProductMasterId: string | null;
  selectedPriceSnapshotId: string | null;
};

type ManualLearningItem = {
  id: string;
  sourceLine: string;
  parsedName: string | null;
  notes: string | null;
  results: Array<{
    id: string;
  }>;
};

function buildFallbackManualLearningNote(item: ManualLearningItem, candidate: ManualLearningCandidate) {
  const payload = {
    savedAt: new Date().toISOString(),
    source: "product_fallback_manual_selection",
    sourceLine: item.sourceLine,
    parsedName: item.parsedName,
    selectedProductId: candidate.selectedProductId,
    selectedPriceSnapshotId: candidate.selectedPriceSnapshotId,
  };

  const noteLines = String(item.notes ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("[manual-learning]"));

  noteLines.push(`[manual-learning] ${JSON.stringify(payload)}`);
  return noteLines.join("\n");
}

export async function POST(request: Request, context: RouteContext) {
  const { optimizationId, itemId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    enterpriseId?: string;
    candidateId?: string | null;
  };
  const enterpriseId = body.enterpriseId?.trim();
  const candidateId = body.candidateId?.trim() || null;

  if (!enterpriseId) {
    return jsonUtf8({ message: "Поле enterpriseId обязательно." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  const item = await prisma.orderOptimizationItem.findFirst({
    where: {
      id: itemId,
      optimizationId,
      optimization: {
        enterpriseId,
      },
    },
    select: {
      id: true,
      sourceLine: true,
      parsedName: true,
      notes: true,
      results: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!item) {
    return jsonUtf8({ message: "Позиция умного заказа не найдена." }, { status: 404 });
  }

  if (candidateId) {
    const candidate = await prisma.orderOptimizationResult.findFirst({
      where: {
        id: candidateId,
        itemId,
        optimizationId,
      },
      select: {
        id: true,
        selectedProductId: true,
        selectedSupplierOfferId: true,
        selectedProductMasterId: true,
        selectedPriceSnapshotId: true,
      },
    });

    if (!candidate) {
      return jsonUtf8({ message: "Вариант товара не найден для этой позиции." }, { status: 404 });
    }

    if (candidate.selectedSupplierOfferId && candidate.selectedProductMasterId) {
      await createManualProductMapping({
        supplierOfferId: candidate.selectedSupplierOfferId,
        productMasterId: candidate.selectedProductMasterId,
      });
    } else {
      // TODO: add a dedicated SmartOrderManualSelection model for cross-order learning from Product fallback selections.
      await prisma.orderOptimizationItem.update({
        where: {
          id: itemId,
        },
        data: {
          notes: buildFallbackManualLearningNote(item, candidate),
        },
      });
    }
  }

  await prisma.orderOptimizationItem.update({
    where: {
      id: itemId,
    },
    data: {
      selectedCandidateId: candidateId,
      selectionMode: candidateId ? "manual" : null,
      matchStatus: candidateId ? "review" : item.results.length > 0 ? "review" : "not_found",
    },
  });

  const optimization = await getOrderOptimizationWithDetails(optimizationId, enterpriseId);

  if (!optimization) {
    return jsonUtf8({ message: "Умный заказ не найден." }, { status: 404 });
  }

  return jsonUtf8(serializeOrderOptimization(optimization));
}
