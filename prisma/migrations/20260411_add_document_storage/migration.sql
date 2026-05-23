-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('price_list');

-- CreateEnum
CREATE TYPE "DocumentSourceFormat" AS ENUM ('excel', 'pdf', 'word', 'csv', 'image', 'archive', 'unknown');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('uploaded', 'processing', 'parsed', 'parsed_with_errors', 'failed');

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "sourceFormat" "DocumentSourceFormat" NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "storedFilePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "status" "DocumentStatus" NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Document_enterpriseId_idx" ON "Document"("enterpriseId");

-- CreateIndex
CREATE INDEX "Document_supplierId_idx" ON "Document"("supplierId");

-- CreateIndex
CREATE INDEX "Document_enterpriseId_supplierId_idx" ON "Document"("enterpriseId", "supplierId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
