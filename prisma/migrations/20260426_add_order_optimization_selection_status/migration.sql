CREATE TYPE "OrderOptimizationSelectionMode" AS ENUM ('auto', 'manual');
CREATE TYPE "OrderOptimizationMatchStatus" AS ENUM ('pending', 'review', 'not_found');

ALTER TABLE "OrderOptimizationItem"
ADD COLUMN "selectionMode" "OrderOptimizationSelectionMode",
ADD COLUMN "matchStatus" "OrderOptimizationMatchStatus" NOT NULL DEFAULT 'pending';
