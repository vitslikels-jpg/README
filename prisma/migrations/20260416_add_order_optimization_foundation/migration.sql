CREATE TYPE "OrderOptimizationStatus" AS ENUM ('draft', 'processed');

CREATE TABLE "OrderOptimization" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "title" TEXT,
    "sourceText" TEXT NOT NULL,
    "baselineTotal" DECIMAL(14,2),
    "optimizedTotal" DECIMAL(14,2),
    "savingsAmount" DECIMAL(14,2),
    "savingsPercent" DECIMAL(7,2),
    "status" "OrderOptimizationStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderOptimization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderOptimizationItem" (
    "id" TEXT NOT NULL,
    "optimizationId" TEXT NOT NULL,
    "sourceLine" TEXT NOT NULL,
    "requestedSupplierName" TEXT,
    "lockSupplier" BOOLEAN NOT NULL DEFAULT false,
    "parsedName" TEXT,
    "parsedQuantity" DECIMAL(14,3),
    "parsedUnit" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderOptimizationItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderOptimizationResult" (
    "id" TEXT NOT NULL,
    "optimizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "selectedSupplierId" TEXT,
    "selectedProductId" TEXT,
    "baselineUnitPrice" DECIMAL(14,2),
    "optimizedUnitPrice" DECIMAL(14,2),
    "baselineLineTotal" DECIMAL(14,2),
    "optimizedLineTotal" DECIMAL(14,2),
    "isManualOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderOptimizationResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderOptimization_enterpriseId_idx" ON "OrderOptimization"("enterpriseId");
CREATE INDEX "OrderOptimization_enterpriseId_createdAt_idx" ON "OrderOptimization"("enterpriseId", "createdAt");
CREATE INDEX "OrderOptimization_enterpriseId_status_idx" ON "OrderOptimization"("enterpriseId", "status");

CREATE INDEX "OrderOptimizationItem_optimizationId_idx" ON "OrderOptimizationItem"("optimizationId");
CREATE INDEX "OrderOptimizationItem_optimizationId_sortOrder_idx" ON "OrderOptimizationItem"("optimizationId", "sortOrder");

CREATE INDEX "OrderOptimizationResult_optimizationId_idx" ON "OrderOptimizationResult"("optimizationId");
CREATE INDEX "OrderOptimizationResult_itemId_idx" ON "OrderOptimizationResult"("itemId");
CREATE INDEX "OrderOptimizationResult_selectedSupplierId_idx" ON "OrderOptimizationResult"("selectedSupplierId");
CREATE INDEX "OrderOptimizationResult_selectedProductId_idx" ON "OrderOptimizationResult"("selectedProductId");

ALTER TABLE "OrderOptimization"
ADD CONSTRAINT "OrderOptimization_enterpriseId_fkey"
FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderOptimizationItem"
ADD CONSTRAINT "OrderOptimizationItem_optimizationId_fkey"
FOREIGN KEY ("optimizationId") REFERENCES "OrderOptimization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderOptimizationResult"
ADD CONSTRAINT "OrderOptimizationResult_optimizationId_fkey"
FOREIGN KEY ("optimizationId") REFERENCES "OrderOptimization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderOptimizationResult"
ADD CONSTRAINT "OrderOptimizationResult_itemId_fkey"
FOREIGN KEY ("itemId") REFERENCES "OrderOptimizationItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderOptimizationResult"
ADD CONSTRAINT "OrderOptimizationResult_selectedSupplierId_fkey"
FOREIGN KEY ("selectedSupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrderOptimizationResult"
ADD CONSTRAINT "OrderOptimizationResult_selectedProductId_fkey"
FOREIGN KEY ("selectedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
