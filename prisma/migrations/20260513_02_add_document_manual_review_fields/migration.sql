-- CreateEnum
CREATE TYPE "DocumentManualReviewStatus" AS ENUM ('not_reviewed', 'in_review', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "DocumentQualityReport"
ADD COLUMN "manualReviewStatus" "DocumentManualReviewStatus" NOT NULL DEFAULT 'not_reviewed',
ADD COLUMN "manualReviewComment" TEXT,
ADD COLUMN "manualReviewedAt" TIMESTAMP(3),
ADD COLUMN "manualReviewedBy" TEXT;
