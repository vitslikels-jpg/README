CREATE TABLE "ProductIdentityRule" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "supplierId" TEXT,
    "article" TEXT,
    "normalizedArticle" TEXT,
    "matchText" TEXT,
    "normalizedMatchText" TEXT,
    "brand" TEXT,
    "normalizedBrand" TEXT,
    "country" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "confidence" DECIMAL(5,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductIdentityRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductIdentityRule_enterpriseId_idx" ON "ProductIdentityRule"("enterpriseId");
CREATE INDEX "ProductIdentityRule_supplierId_idx" ON "ProductIdentityRule"("supplierId");
CREATE INDEX "ProductIdentityRule_normalizedArticle_idx" ON "ProductIdentityRule"("normalizedArticle");
CREATE INDEX "ProductIdentityRule_normalizedBrand_idx" ON "ProductIdentityRule"("normalizedBrand");

CREATE UNIQUE INDEX "ProductIdentityRule_enterpriseId_supplierId_normalizedArticle_normalizedMatchText_normalizedBrand_key"
ON "ProductIdentityRule"("enterpriseId", "supplierId", "normalizedArticle", "normalizedMatchText", "normalizedBrand");

ALTER TABLE "ProductIdentityRule"
ADD CONSTRAINT "ProductIdentityRule_enterpriseId_fkey"
FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductIdentityRule"
ADD CONSTRAINT "ProductIdentityRule_supplierId_fkey"
FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
