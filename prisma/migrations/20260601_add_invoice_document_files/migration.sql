-- CreateTable
CREATE TABLE "InvoiceDocumentFile" (
    "id" TEXT NOT NULL,
    "invoiceDocumentId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFileName" TEXT,
    "mimeType" TEXT,
    "pageIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceDocumentFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceDocumentFile_invoiceDocumentId_idx" ON "InvoiceDocumentFile"("invoiceDocumentId");

-- CreateIndex
CREATE INDEX "InvoiceDocumentFile_pageIndex_idx" ON "InvoiceDocumentFile"("pageIndex");

-- AddForeignKey
ALTER TABLE "InvoiceDocumentFile" ADD CONSTRAINT "InvoiceDocumentFile_invoiceDocumentId_fkey" FOREIGN KEY ("invoiceDocumentId") REFERENCES "InvoiceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
