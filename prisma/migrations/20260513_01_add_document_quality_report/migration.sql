-- CreateEnum
CREATE TYPE "DocumentQualityStatus" AS ENUM ('good', 'warning', 'bad');

-- CreateTable
CREATE TABLE "DocumentQualityReport" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "qualityStatus" "DocumentQualityStatus" NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "parsedProductsCount" INTEGER NOT NULL,
    "rowsWithoutPrice" INTEGER NOT NULL,
    "rowsWithoutUnit" INTEGER NOT NULL,
    "rowsWithoutName" INTEGER NOT NULL,
    "rowsWithoutArticle" INTEGER NOT NULL,
    "newSupplierOffersCount" INTEGER NOT NULL,
    "unmappedOffersCount" INTEGER NOT NULL,
    "autoMappedOffersCount" INTEGER NOT NULL,
    "lowConfidenceMappingsCount" INTEGER NOT NULL,
    "manualMappedOffersCount" INTEGER NOT NULL,
    "currentPriceSnapshotsCount" INTEGER NOT NULL,
    "warningMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentQualityReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentQualityReport_documentId_key" ON "DocumentQualityReport"("documentId");

-- CreateIndex
CREATE INDEX "DocumentQualityReport_qualityStatus_idx" ON "DocumentQualityReport"("qualityStatus");

-- AddForeignKey
ALTER TABLE "DocumentQualityReport" ADD CONSTRAINT "DocumentQualityReport_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
