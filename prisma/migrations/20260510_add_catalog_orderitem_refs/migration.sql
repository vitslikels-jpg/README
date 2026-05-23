ALTER TABLE "OrderItem"
ADD COLUMN "productMasterId" TEXT,
ADD COLUMN "supplierOfferId" TEXT,
ADD COLUMN "priceSnapshotId" TEXT;

CREATE INDEX "OrderItem_productMasterId_idx" ON "OrderItem"("productMasterId");
CREATE INDEX "OrderItem_supplierOfferId_idx" ON "OrderItem"("supplierOfferId");
CREATE INDEX "OrderItem_priceSnapshotId_idx" ON "OrderItem"("priceSnapshotId");

ALTER TABLE "OrderItem"
ADD CONSTRAINT "OrderItem_productMasterId_fkey" FOREIGN KEY ("productMasterId") REFERENCES "ProductMaster"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "OrderItem_supplierOfferId_fkey" FOREIGN KEY ("supplierOfferId") REFERENCES "SupplierOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "OrderItem_priceSnapshotId_fkey" FOREIGN KEY ("priceSnapshotId") REFERENCES "PriceSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
