-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "managerName" TEXT,
    "email" TEXT,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Supplier_enterpriseId_idx" ON "Supplier"("enterpriseId");

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

