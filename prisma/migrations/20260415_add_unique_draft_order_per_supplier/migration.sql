CREATE UNIQUE INDEX IF NOT EXISTS "order_one_draft_per_supplier"
ON "Order" ("enterpriseId", "supplierId")
WHERE "status" = 'draft';
