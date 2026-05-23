ALTER TABLE "OrderOptimizationResult"
ADD COLUMN "coverageMode" TEXT,
ADD COLUMN "requiredAmount" DECIMAL(14, 3),
ADD COLUMN "packSize" DECIMAL(14, 3),
ADD COLUMN "suggestedPacksCount" INTEGER,
ADD COLUMN "totalCoveredAmount" DECIMAL(14, 3),
ADD COLUMN "overage" DECIMAL(14, 3),
ADD COLUMN "shortage" DECIMAL(14, 3);
