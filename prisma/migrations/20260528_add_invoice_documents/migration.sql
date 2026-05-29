-- CreateEnum
CREATE TYPE "InvoiceDocumentStatus" AS ENUM ('uploaded', 'processing', 'needs_review', 'parsed', 'approved', 'failed');

-- CreateEnum
CREATE TYPE "InvoicePriceChangeStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "InvoiceDocument" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "supplierId" TEXT,
    "fileUrl" TEXT,
    "storageKey" TEXT,
    "originalFileName" TEXT,
    "status" "InvoiceDocumentStatus" NOT NULL DEFAULT 'uploaded',
    "detectedSupplierName" TEXT,
    "confidence" DOUBLE PRECISION,
    "invoiceNumber" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "totalAmount" DECIMAL(12,2),
    "vatAmount" DECIMAL(12,2),
    "rawText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceDocumentId" TEXT NOT NULL,
    "productNameRaw" TEXT NOT NULL,
    "matchedProductId" TEXT,
    "quantity" DECIMAL(12,3),
    "unit" TEXT,
    "priceWithoutVat" DECIMAL(12,2),
    "priceWithVat" DECIMAL(12,2),
    "vatRate" DECIMAL(5,2),
    "lineTotal" DECIMAL(12,2),
    "confidence" DOUBLE PRECISION,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoicePriceChange" (
    "id" TEXT NOT NULL,
    "invoiceDocumentId" TEXT NOT NULL,
    "invoiceItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "oldPrice" DECIMAL(12,2),
    "newPrice" DECIMAL(12,2) NOT NULL,
    "differenceAmount" DECIMAL(12,2),
    "differencePercent" DECIMAL(8,2),
    "status" "InvoicePriceChangeStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "InvoicePriceChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceDocument_enterpriseId_idx" ON "InvoiceDocument"("enterpriseId");

-- CreateIndex
CREATE INDEX "InvoiceDocument_supplierId_idx" ON "InvoiceDocument"("supplierId");

-- CreateIndex
CREATE INDEX "InvoiceDocument_status_idx" ON "InvoiceDocument"("status");

-- CreateIndex
CREATE INDEX "InvoiceDocument_createdAt_idx" ON "InvoiceDocument"("createdAt");

-- CreateIndex
CREATE INDEX "InvoiceItem_invoiceDocumentId_idx" ON "InvoiceItem"("invoiceDocumentId");

-- CreateIndex
CREATE INDEX "InvoiceItem_matchedProductId_idx" ON "InvoiceItem"("matchedProductId");

-- CreateIndex
CREATE INDEX "InvoiceItem_needsReview_idx" ON "InvoiceItem"("needsReview");

-- CreateIndex
CREATE INDEX "InvoicePriceChange_invoiceDocumentId_idx" ON "InvoicePriceChange"("invoiceDocumentId");

-- CreateIndex
CREATE INDEX "InvoicePriceChange_invoiceItemId_idx" ON "InvoicePriceChange"("invoiceItemId");

-- CreateIndex
CREATE INDEX "InvoicePriceChange_productId_idx" ON "InvoicePriceChange"("productId");

-- CreateIndex
CREATE INDEX "InvoicePriceChange_supplierId_idx" ON "InvoicePriceChange"("supplierId");

-- CreateIndex
CREATE INDEX "InvoicePriceChange_status_idx" ON "InvoicePriceChange"("status");

-- AddForeignKey
ALTER TABLE "InvoiceDocument" ADD CONSTRAINT "InvoiceDocument_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceDocument" ADD CONSTRAINT "InvoiceDocument_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceDocumentId_fkey" FOREIGN KEY ("invoiceDocumentId") REFERENCES "InvoiceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_matchedProductId_fkey" FOREIGN KEY ("matchedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePriceChange" ADD CONSTRAINT "InvoicePriceChange_invoiceDocumentId_fkey" FOREIGN KEY ("invoiceDocumentId") REFERENCES "InvoiceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePriceChange" ADD CONSTRAINT "InvoicePriceChange_invoiceItemId_fkey" FOREIGN KEY ("invoiceItemId") REFERENCES "InvoiceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePriceChange" ADD CONSTRAINT "InvoicePriceChange_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePriceChange" ADD CONSTRAINT "InvoicePriceChange_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
