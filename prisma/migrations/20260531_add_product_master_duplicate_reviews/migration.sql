CREATE TYPE "ProductMasterDuplicateReviewStatus" AS ENUM ('needs_review', 'duplicate', 'not_duplicate');

CREATE TABLE "ProductMasterDuplicateReview" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "masterIds" JSONB NOT NULL,
    "status" "ProductMasterDuplicateReviewStatus" NOT NULL DEFAULT 'needs_review',
    "comment" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMasterDuplicateReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductMasterDuplicateReview_enterpriseId_idx"
ON "ProductMasterDuplicateReview"("enterpriseId");

CREATE INDEX "ProductMasterDuplicateReview_enterpriseId_normalizedName_idx"
ON "ProductMasterDuplicateReview"("enterpriseId", "normalizedName");

CREATE UNIQUE INDEX "ProductMasterDuplicateReview_enterpriseId_normalizedName_key"
ON "ProductMasterDuplicateReview"("enterpriseId", "normalizedName");

ALTER TABLE "ProductMasterDuplicateReview"
ADD CONSTRAINT "ProductMasterDuplicateReview_enterpriseId_fkey"
FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
