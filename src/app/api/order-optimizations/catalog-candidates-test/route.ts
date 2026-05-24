import { jsonUtf8 } from "@/lib/http";
import { findCatalogCandidateProducts, findPreferredSmartOrderProductCandidates } from "@/lib/order-optimization-matching";
import { ensureEnterpriseExists } from "@/lib/orders";
import type { OrderOptimizationItem } from "@prisma/client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();
  const query = searchParams.get("query")?.trim() ?? "";
  const limitParam = searchParams.get("limit")?.trim() ?? "";
  const limitNumber = Number(limitParam);
  const limit =
    Number.isFinite(limitNumber) && limitNumber > 0 ? Math.min(Math.floor(limitNumber), 20) : 10;

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  if (!query) {
    return jsonUtf8({ message: "Параметр query обязателен." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  const probeItem: OrderOptimizationItem = {
    id: "catalog-candidates-test",
    optimizationId: "catalog-candidates-test",
    sourceLine: query,
    requestedSupplierName: null,
    lockSupplier: false,
    parsedName: query,
    parsedQuantity: null,
    parsedUnit: null,
    requestedAmount: null,
    selectedCandidateId: null,
    selectionMode: null,
    matchStatus: "pending",
    notes: null,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const preferredSearch = await findPreferredSmartOrderProductCandidates(probeItem, enterpriseId, {
    searchText: query,
    maxProducts: limit,
  });

  const results =
    preferredSearch.candidateSource === "catalog"
      ? (
          await findCatalogCandidateProducts(probeItem, enterpriseId, {
            searchText: query,
            maxProducts: limit,
          })
        ).map((candidate) => ({
          supplierOfferId: candidate.supplierOfferId,
          supplierName: candidate.supplierName,
          offerName: candidate.name,
          productMasterId: candidate.productMaster?.id ?? candidate.mapping?.productMasterId ?? null,
          productMasterName: candidate.productMaster?.name ?? null,
          category: candidate.productMaster?.category ?? null,
          priceSnapshotId: candidate.currentPriceSnapshot?.id ?? null,
          price: candidate.currentPriceSnapshot?.price?.toString() ?? null,
          unit: candidate.unit,
          rawDataExists: candidate.rawData !== null && candidate.rawData !== undefined,
          mappingConfidence: candidate.mapping?.confidence?.toString() ?? null,
          mappingSource: candidate.mapping?.matchSource ?? null,
        }))
      : preferredSearch.candidates.map((candidate) => ({
          supplierOfferId: null,
          supplierName: candidate.product.supplier.name,
          offerName: candidate.product.name,
          productMasterId: null,
          productMasterName: null,
          category: null,
          priceSnapshotId: null,
          price: candidate.product.price?.toString() ?? null,
          unit: candidate.product.unit,
          rawDataExists: candidate.product.rawData !== null && candidate.product.rawData !== undefined,
          mappingConfidence: null,
          mappingSource: null,
        }));

  return jsonUtf8({
    query,
    enterpriseId,
    candidateSource: preferredSearch.candidateSource,
    count: results.length,
    results,
  });
}
