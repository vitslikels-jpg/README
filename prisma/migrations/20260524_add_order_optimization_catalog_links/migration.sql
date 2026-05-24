ALTER TABLE "OrderOptimizationResult"
ADD COLUMN "selectedSupplierOfferId" TEXT,
ADD COLUMN "selectedProductMasterId" TEXT,
ADD COLUMN "selectedPriceSnapshotId" TEXT;

CREATE INDEX "OrderOptimizationResult_selectedSupplierOfferId_idx"
ON "OrderOptimizationResult"("selectedSupplierOfferId");

CREATE INDEX "OrderOptimizationResult_selectedProductMasterId_idx"
ON "OrderOptimizationResult"("selectedProductMasterId");

CREATE INDEX "OrderOptimizationResult_selectedPriceSnapshotId_idx"
ON "OrderOptimizationResult"("selectedPriceSnapshotId");

ALTER TABLE "OrderOptimizationResult"
ADD CONSTRAINT "OrderOptimizationResult_selectedSupplierOfferId_fkey"
FOREIGN KEY ("selectedSupplierOfferId") REFERENCES "SupplierOffer"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrderOptimizationResult"
ADD CONSTRAINT "OrderOptimizationResult_selectedProductMasterId_fkey"
FOREIGN KEY ("selectedProductMasterId") REFERENCES "ProductMaster"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrderOptimizationResult"
ADD CONSTRAINT "OrderOptimizationResult_selectedPriceSnapshotId_fkey"
FOREIGN KEY ("selectedPriceSnapshotId") REFERENCES "PriceSnapshot"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
