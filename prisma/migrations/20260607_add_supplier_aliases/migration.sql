CREATE TABLE "SupplierAlias" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "type" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierAlias_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplierAlias_enterpriseId_idx" ON "SupplierAlias"("enterpriseId");
CREATE INDEX "SupplierAlias_supplierId_idx" ON "SupplierAlias"("supplierId");
CREATE INDEX "SupplierAlias_normalizedValue_idx" ON "SupplierAlias"("normalizedValue");

CREATE UNIQUE INDEX "SupplierAlias_enterpriseId_normalizedValue_key"
ON "SupplierAlias"("enterpriseId", "normalizedValue");

ALTER TABLE "SupplierAlias"
ADD CONSTRAINT "SupplierAlias_enterpriseId_fkey"
FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplierAlias"
ADD CONSTRAINT "SupplierAlias_supplierId_fkey"
FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
