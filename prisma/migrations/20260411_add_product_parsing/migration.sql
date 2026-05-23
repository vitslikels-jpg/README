-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "article" TEXT,
    "brand" TEXT,
    "unit" TEXT,
    "price" DECIMAL(14,2),
    "stock" DECIMAL(14,3),
    "sourceRow" INTEGER NOT NULL,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_enterpriseId_idx" ON "Product"("enterpriseId");

-- CreateIndex
CREATE INDEX "Product_supplierId_idx" ON "Product"("supplierId");

-- CreateIndex
CREATE INDEX "Product_documentId_idx" ON "Product"("documentId");

-- CreateIndex
CREATE INDEX "Product_enterpriseId_supplierId_idx" ON "Product"("enterpriseId", "supplierId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
