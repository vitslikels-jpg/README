-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "baseUnitCode" TEXT NOT NULL,
    "multiplier" DECIMAL(14,6) NOT NULL,
    "aliases" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMaster" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "unitId" TEXT,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "brand" TEXT,
    "normalizedBrand" TEXT,
    "category" TEXT,
    "legacyUnit" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierOffer" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "unitId" TEXT,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "article" TEXT,
    "normalizedArticle" TEXT,
    "brand" TEXT,
    "normalizedBrand" TEXT,
    "country" TEXT,
    "legacyUnit" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "unitsPerPack" DECIMAL(14,3),
    "minOrderQuantity" DECIMAL(14,3),
    "orderStep" DECIMAL(14,3),
    "allowFractionalOrder" BOOLEAN NOT NULL DEFAULT false,
    "shipByBoxesOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceSnapshot" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierOfferId" TEXT NOT NULL,
    "documentId" TEXT,
    "legacyProductId" TEXT,
    "unitId" TEXT,
    "legacyUnit" TEXT,
    "price" DECIMAL(14,2),
    "stock" DECIMAL(14,3),
    "sourceRow" INTEGER,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMapping" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "supplierOfferId" TEXT NOT NULL,
    "productMasterId" TEXT,
    "iikoProductExternalId" TEXT,
    "confidence" DECIMAL(5,4),
    "matchKey" TEXT,
    "matchSource" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Unit_code_key" ON "Unit"("code");

-- CreateIndex
CREATE INDEX "Unit_kind_idx" ON "Unit"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMaster_enterpriseId_dedupeKey_key" ON "ProductMaster"("enterpriseId", "dedupeKey");

-- CreateIndex
CREATE INDEX "ProductMaster_enterpriseId_idx" ON "ProductMaster"("enterpriseId");

-- CreateIndex
CREATE INDEX "ProductMaster_enterpriseId_normalizedName_idx" ON "ProductMaster"("enterpriseId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierOffer_supplierId_dedupeKey_key" ON "SupplierOffer"("supplierId", "dedupeKey");

-- CreateIndex
CREATE INDEX "SupplierOffer_enterpriseId_idx" ON "SupplierOffer"("enterpriseId");

-- CreateIndex
CREATE INDEX "SupplierOffer_supplierId_idx" ON "SupplierOffer"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierOffer_supplierId_normalizedName_idx" ON "SupplierOffer"("supplierId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "PriceSnapshot_legacyProductId_key" ON "PriceSnapshot"("legacyProductId");

-- CreateIndex
CREATE INDEX "PriceSnapshot_enterpriseId_idx" ON "PriceSnapshot"("enterpriseId");

-- CreateIndex
CREATE INDEX "PriceSnapshot_supplierId_idx" ON "PriceSnapshot"("supplierId");

-- CreateIndex
CREATE INDEX "PriceSnapshot_supplierOfferId_isCurrent_idx" ON "PriceSnapshot"("supplierOfferId", "isCurrent");

-- CreateIndex
CREATE INDEX "PriceSnapshot_documentId_idx" ON "PriceSnapshot"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMapping_supplierOfferId_productMasterId_key" ON "ProductMapping"("supplierOfferId", "productMasterId");

-- CreateIndex
CREATE INDEX "ProductMapping_enterpriseId_idx" ON "ProductMapping"("enterpriseId");

-- CreateIndex
CREATE INDEX "ProductMapping_supplierOfferId_idx" ON "ProductMapping"("supplierOfferId");

-- CreateIndex
CREATE INDEX "ProductMapping_productMasterId_idx" ON "ProductMapping"("productMasterId");

-- AddForeignKey
ALTER TABLE "ProductMaster" ADD CONSTRAINT "ProductMaster_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMaster" ADD CONSTRAINT "ProductMaster_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOffer" ADD CONSTRAINT "SupplierOffer_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOffer" ADD CONSTRAINT "SupplierOffer_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOffer" ADD CONSTRAINT "SupplierOffer_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_supplierOfferId_fkey" FOREIGN KEY ("supplierOfferId") REFERENCES "SupplierOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_legacyProductId_fkey" FOREIGN KEY ("legacyProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMapping" ADD CONSTRAINT "ProductMapping_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMapping" ADD CONSTRAINT "ProductMapping_supplierOfferId_fkey" FOREIGN KEY ("supplierOfferId") REFERENCES "SupplierOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMapping" ADD CONSTRAINT "ProductMapping_productMasterId_fkey" FOREIGN KEY ("productMasterId") REFERENCES "ProductMaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
