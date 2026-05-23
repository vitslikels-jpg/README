-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN "minOrderAmount" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "Product"
ADD COLUMN "country" TEXT,
ADD COLUMN "minOrderQuantity" DECIMAL(14,3);
