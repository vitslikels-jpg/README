-- CreateEnum
CREATE TYPE "DocumentUsabilityStatus" AS ENUM ('usable', 'needs_review', 'blocked');

-- AlterTable
ALTER TABLE "DocumentQualityReport"
ADD COLUMN "usabilityStatus" "DocumentUsabilityStatus" NOT NULL DEFAULT 'needs_review',
ADD COLUMN "usabilityReason" TEXT;
