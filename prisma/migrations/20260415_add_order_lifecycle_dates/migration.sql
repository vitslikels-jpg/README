ALTER TABLE "Order"
ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);

UPDATE "Order"
SET "submittedAt" = COALESCE("submittedAt", "updatedAt")
WHERE "status" = 'submitted';

UPDATE "Order"
SET "cancelledAt" = COALESCE("cancelledAt", "updatedAt")
WHERE "status" = 'cancelled';
