ALTER TABLE "OrderOptimizationItem" ADD COLUMN "selectedCandidateId" TEXT;

CREATE INDEX "OrderOptimizationItem_selectedCandidateId_idx" ON "OrderOptimizationItem"("selectedCandidateId");

ALTER TABLE "OrderOptimizationItem"
ADD CONSTRAINT "OrderOptimizationItem_selectedCandidateId_fkey"
FOREIGN KEY ("selectedCandidateId")
REFERENCES "OrderOptimizationResult"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
