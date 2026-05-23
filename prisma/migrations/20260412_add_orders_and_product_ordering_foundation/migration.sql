ALTER TABLE "Product"
ADD COLUMN IF NOT EXISTS "unitsPerPack" DECIMAL(14,3),
ADD COLUMN IF NOT EXISTS "orderStep" DECIMAL(14,3),
ADD COLUMN IF NOT EXISTS "allowFractionalOrder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "shipByBoxesOnly" BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderStatus') THEN
    CREATE TYPE "OrderStatus" AS ENUM ('draft', 'submitted', 'cancelled');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Order" (
  "id" TEXT NOT NULL,
  "enterpriseId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'draft',
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OrderItem" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "productId" TEXT,
  "quantity" DECIMAL(14,3) NOT NULL,
  "unit" TEXT,
  "price" DECIMAL(14,2),
  "lineTotal" DECIMAL(14,2) NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Order_enterpriseId_idx" ON "Order"("enterpriseId");
CREATE INDEX IF NOT EXISTS "Order_supplierId_idx" ON "Order"("supplierId");
CREATE INDEX IF NOT EXISTS "Order_enterpriseId_supplierId_status_idx" ON "Order"("enterpriseId", "supplierId", "status");

CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX IF NOT EXISTS "OrderItem_productId_idx" ON "OrderItem"("productId");
CREATE INDEX IF NOT EXISTS "OrderItem_orderId_sortOrder_idx" ON "OrderItem"("orderId", "sortOrder");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'Order_enterpriseId_fkey'
      AND table_name = 'Order'
  ) THEN
    ALTER TABLE "Order"
    ADD CONSTRAINT "Order_enterpriseId_fkey"
    FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'Order_supplierId_fkey'
      AND table_name = 'Order'
  ) THEN
    ALTER TABLE "Order"
    ADD CONSTRAINT "Order_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'OrderItem_orderId_fkey'
      AND table_name = 'OrderItem'
  ) THEN
    ALTER TABLE "OrderItem"
    ADD CONSTRAINT "OrderItem_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'OrderItem_productId_fkey'
      AND table_name = 'OrderItem'
  ) THEN
    ALTER TABLE "OrderItem"
    ADD CONSTRAINT "OrderItem_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
