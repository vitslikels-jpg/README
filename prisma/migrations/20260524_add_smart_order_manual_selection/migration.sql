CREATE TABLE "SmartOrderManualSelection" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "sourceLine" TEXT,
    "parsedName" TEXT NOT NULL,
    "normalizedParsedName" TEXT NOT NULL,
    "selectedProductId" TEXT NOT NULL,
    "selectedSupplierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmartOrderManualSelection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SmartOrderManualSelection_enterpriseId_normalizedParsedName_selectedProductId_key"
ON "SmartOrderManualSelection"("enterpriseId", "normalizedParsedName", "selectedProductId");

CREATE INDEX "SmartOrderManualSelection_enterpriseId_normalizedParsedName_idx"
ON "SmartOrderManualSelection"("enterpriseId", "normalizedParsedName");

CREATE INDEX "SmartOrderManualSelection_selectedProductId_idx"
ON "SmartOrderManualSelection"("selectedProductId");

ALTER TABLE "SmartOrderManualSelection"
ADD CONSTRAINT "SmartOrderManualSelection_enterpriseId_fkey"
FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SmartOrderManualSelection"
ADD CONSTRAINT "SmartOrderManualSelection_selectedProductId_fkey"
FOREIGN KEY ("selectedProductId") REFERENCES "Product"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SmartOrderManualSelection"
ADD CONSTRAINT "SmartOrderManualSelection_selectedSupplierId_fkey"
FOREIGN KEY ("selectedSupplierId") REFERENCES "Supplier"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
