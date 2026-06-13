-- AlterTable
ALTER TABLE "IikoProduct" ADD COLUMN "productMasterId" TEXT;

-- CreateIndex
CREATE INDEX "IikoProduct_productMasterId_idx" ON "IikoProduct"("productMasterId");

-- AddForeignKey
ALTER TABLE "IikoProduct" ADD CONSTRAINT "IikoProduct_productMasterId_fkey" FOREIGN KEY ("productMasterId") REFERENCES "ProductMaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
