ALTER TABLE "Supplier"
ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Supplier_enterpriseId_archivedAt_idx"
ON "Supplier"("enterpriseId", "archivedAt");
