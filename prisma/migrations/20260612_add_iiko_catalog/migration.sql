-- CreateTable
CREATE TABLE "IikoStore" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT,
    "code" TEXT,
    "rawData" JSONB NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IikoStore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IikoProduct" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT,
    "code" TEXT,
    "type" TEXT,
    "mainUnit" TEXT,
    "parentId" TEXT,
    "parentName" TEXT,
    "estimatedPurchasePrice" DECIMAL(14,2),
    "defaultSalePrice" DECIMAL(14,2),
    "rawData" JSONB NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IikoProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IikoStore_enterpriseId_externalId_key" ON "IikoStore"("enterpriseId", "externalId");

-- CreateIndex
CREATE INDEX "IikoStore_enterpriseId_idx" ON "IikoStore"("enterpriseId");

-- CreateIndex
CREATE UNIQUE INDEX "IikoProduct_enterpriseId_externalId_key" ON "IikoProduct"("enterpriseId", "externalId");

-- CreateIndex
CREATE INDEX "IikoProduct_enterpriseId_idx" ON "IikoProduct"("enterpriseId");

-- CreateIndex
CREATE INDEX "IikoProduct_enterpriseId_type_idx" ON "IikoProduct"("enterpriseId", "type");

-- AddForeignKey
ALTER TABLE "IikoStore" ADD CONSTRAINT "IikoStore_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IikoProduct" ADD CONSTRAINT "IikoProduct_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
