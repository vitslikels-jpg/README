import { unlink } from "fs/promises";
import path from "path";
import { jsonUtf8 } from "@/lib/http";
import { comparePricesSafely } from "@/lib/invoice-price-normalizer";
import { matchInvoiceSupplier } from "@/lib/invoice-supplier-match";
import { matchInvoiceProduct } from "@/lib/invoice-product-match";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const INVOICE_UPLOAD_DIRECTORY = path.join(process.cwd(), "public", "uploads", "invoices");

function formatMoneyValue(value: { toString(): string } | null | undefined) {
  if (!value) {
    return null;
  }

  const amount = Number(value.toString());

  if (!Number.isFinite(amount)) {
    return value.toString();
  }

  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatPackSizeValue(value: { toString(): string } | null | undefined) {
  if (!value) {
    return null;
  }

  const amount = Number(value.toString());

  if (!Number.isFinite(amount)) {
    return value.toString();
  }

  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 3,
    maximumFractionDigits: 3,
  }).format(amount);
}

function buildPriceComparisonNote(comparison: ReturnType<typeof comparePricesSafely>) {
  if (comparison.reason) {
    return comparison.reason;
  }

  if (!comparison.normalized || !comparison.packSize || !comparison.invoicePrice || !comparison.newPrice) {
    return null;
  }

  const invoicePrice = formatMoneyValue(comparison.invoicePrice);
  const normalizedPrice = formatMoneyValue(comparison.newPrice);
  const packSize = formatPackSizeValue(comparison.packSize);

  if (!invoicePrice || !normalizedPrice || !packSize) {
    return null;
  }

  if (comparison.normalizationMode === "invoice_unit_to_pack") {
    return `${invoicePrice} ₽/шт, упаковка ${packSize} шт = ${normalizedPrice} ₽`;
  }

  if (comparison.normalizationMode === "invoice_pack_to_unit") {
    return `${invoicePrice} ₽ за упаковку ${packSize} шт = ${normalizedPrice} ₽/шт`;
  }

  return null;
}

function getSafeInvoiceFilePath(storageKey: string | null, fileUrl: string | null) {
  const normalizedKey = (storageKey || fileUrl?.replace(/^\/+/u, "") || "").replaceAll("\\", "/");

  if (!normalizedKey.startsWith("uploads/invoices/")) {
    return null;
  }

  const absolutePath = path.join(process.cwd(), "public", normalizedKey);
  const normalizedPath = path.normalize(absolutePath);
  const normalizedRoot = path.normalize(INVOICE_UPLOAD_DIRECTORY + path.sep);

  if (!normalizedPath.startsWith(normalizedRoot)) {
    return null;
  }

  return normalizedPath;
}

async function deleteInvoiceFiles(files: Array<{ storageKey: string | null; fileUrl: string | null }>) {
  for (const file of files) {
    const filePath = getSafeInvoiceFilePath(file.storageKey, file.fileUrl);

    if (!filePath) {
      continue;
    }

    try {
      await unlink(filePath);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        console.error("[invoice-delete:file-delete-failed]", {
          storageKey: file.storageKey,
          fileUrl: file.fileUrl,
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  }
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  const invoice = await prisma.invoiceDocument.findFirst({
    where: {
      id,
      enterpriseId,
    },
    include: {
      files: {
        select: {
          id: true,
          fileUrl: true,
          storageKey: true,
          originalFileName: true,
          mimeType: true,
          pageIndex: true,
        },
        orderBy: {
          pageIndex: "asc",
        },
      },
      supplier: {
        select: {
          id: true,
          name: true,
        },
      },
      items: {
        include: {
          matchedProduct: {
            select: {
              id: true,
              name: true,
              article: true,
              brand: true,
              price: true,
              unit: true,
              unitsPerPack: true,
              rawData: true,
              priceSnapshots: {
                where: {
                  isCurrent: true,
                },
                take: 1,
                select: {
                  legacyUnit: true,
                  supplierOffer: {
                    select: {
                      unitsPerPack: true,
                      legacyUnit: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      },
      priceChanges: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              article: true,
              brand: true,
            },
          },
          invoiceItem: {
            select: {
              id: true,
              productNameRaw: true,
            },
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!invoice) {
    return jsonUtf8({ message: "Накладная не найдена." }, { status: 404 });
  }

  const supplierMatch =
    invoice.rawText && invoice.supplierId ? await matchInvoiceSupplier(invoice.rawText, enterpriseId).catch(() => null) : null;
  const invoiceItems = await Promise.all(
    invoice.items.map(async (item) => {
      const productMatch = item.matchedProductId
        ? { matchedProductId: item.matchedProductId, status: "matched" as const, candidates: [] }
        : await matchInvoiceProduct({
            enterpriseId,
            supplierId: invoice.supplierId,
            productNameRaw: item.productNameRaw,
            limit: 3,
          }).catch(() => ({ matchedProductId: null, status: "not_found" as const, candidates: [] }));

      const productMatchStatus = item.matchedProductId
        ? "matched"
        : productMatch.status === "matched"
          ? "matched"
        : productMatch.status === "ambiguous"
          ? "ambiguous"
          : "new";
      const resolvedMatchedProductId = item.matchedProductId ?? (productMatch.status === "matched" ? productMatch.matchedProductId : null);
      const resolvedMatchedProduct =
        item.matchedProduct ??
        (resolvedMatchedProductId
          ? await prisma.product.findUnique({
              where: {
                id: resolvedMatchedProductId,
              },
              select: {
                id: true,
                name: true,
                article: true,
                brand: true,
                price: true,
                unit: true,
                unitsPerPack: true,
                rawData: true,
                priceSnapshots: {
                  where: {
                    isCurrent: true,
                  },
                  take: 1,
                  select: {
                    legacyUnit: true,
                    supplierOffer: {
                      select: {
                        unitsPerPack: true,
                        legacyUnit: true,
                      },
                    },
                  },
                },
              },
            })
          : null);

      const priceComparison = resolvedMatchedProduct
        ? comparePricesSafely(
            {
              productNameRaw: item.productNameRaw,
              unit: item.unit,
              priceWithVat: item.priceWithVat,
            },
            resolvedMatchedProduct,
            resolvedMatchedProduct.priceSnapshots?.[0]?.supplierOffer ?? null,
          )
        : null;

      return {
        id: item.id,
        productNameRaw: item.productNameRaw,
        matchedProductId: resolvedMatchedProductId,
        matchedProductStatus: productMatchStatus,
        matchedProductName: resolvedMatchedProduct?.name ?? productMatch.candidates[0]?.name ?? null,
        matchedProductArticle: resolvedMatchedProduct?.article ?? productMatch.candidates[0]?.article ?? null,
        matchedProductBrand: resolvedMatchedProduct?.brand ?? productMatch.candidates[0]?.brand ?? null,
        matchedProductPrice: resolvedMatchedProduct?.price?.toString() ?? null,
        productCandidates: productMatchStatus === "ambiguous" ? productMatch.candidates : [],
        quantity: item.quantity?.toString() ?? null,
        unit: item.unit,
        priceWithoutVat: item.priceWithoutVat?.toString() ?? null,
        priceWithVat: item.priceWithVat?.toString() ?? null,
        vatRate: item.vatRate?.toString() ?? null,
        lineTotal: item.lineTotal?.toString() ?? null,
        confidence: item.confidence,
        needsReview: item.needsReview,
        priceComparisonNote: priceComparison ? buildPriceComparisonNote(priceComparison) : null,
        priceComparisonNeedsReview: priceComparison?.needsReview ?? false,
        normalizedComparisonPrice: priceComparison?.newPrice?.toString() ?? null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    }),
  );
  const invoiceItemsById = new Map(invoiceItems.map((item) => [item.id, item]));

  return jsonUtf8({
    id: invoice.id,
    status: invoice.status,
    supplierId: invoice.supplierId,
    supplierName: invoice.supplier?.name ?? null,
    detectedSupplierName: invoice.detectedSupplierName,
    confidence: invoice.confidence,
    supplierMatchType: supplierMatch?.supplierId === invoice.supplierId ? supplierMatch.matchType : null,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    totalAmount: invoice.totalAmount?.toString() ?? null,
    vatAmount: invoice.vatAmount?.toString() ?? null,
    originalFileName: invoice.originalFileName,
    fileUrl: invoice.fileUrl,
    files: invoice.files.map((file) => ({
      id: file.id,
      fileUrl: file.fileUrl,
      storageKey: file.storageKey,
      originalFileName: file.originalFileName,
      mimeType: file.mimeType,
      pageIndex: file.pageIndex,
    })),
    rawText: invoice.rawText,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
    items: invoiceItems,
    priceChanges: invoice.priceChanges.map((change) => ({
      id: change.id,
      invoiceItemId: change.invoiceItemId,
      productId: change.productId,
      productName: change.product?.name ?? change.invoiceItem.productNameRaw,
      oldPrice: change.oldPrice?.toString() ?? null,
      newPrice: change.newPrice.toString(),
      differenceAmount: change.differenceAmount?.toString() ?? null,
      differencePercent: change.differencePercent?.toString() ?? null,
      comparisonNote: invoiceItemsById.get(change.invoiceItemId)?.priceComparisonNote ?? null,
      status: change.status,
      createdAt: change.createdAt,
      approvedAt: change.approvedAt,
    })),
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const enterprise = await ensureEnterpriseExists(enterpriseId);

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  const invoice = await prisma.invoiceDocument.findFirst({
    where: {
      id,
      enterpriseId,
    },
    select: {
      id: true,
      fileUrl: true,
      storageKey: true,
      files: {
        select: {
          storageKey: true,
          fileUrl: true,
        },
      },
    },
  });

  if (!invoice) {
    return jsonUtf8({ message: "Накладная не найдена." }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoicePriceChange.deleteMany({
      where: {
        invoiceDocumentId: id,
      },
    });

    await tx.invoiceItem.deleteMany({
      where: {
        invoiceDocumentId: id,
      },
    });

    await tx.invoiceDocumentFile.deleteMany({
      where: {
        invoiceDocumentId: id,
      },
    });

    await tx.invoiceDocument.delete({
      where: {
        id,
      },
    });
  });

  const filesToDelete =
    invoice.files.length > 0 ? invoice.files : [{ storageKey: invoice.storageKey, fileUrl: invoice.fileUrl }];

  await deleteInvoiceFiles(filesToDelete);

  return jsonUtf8({
    ok: true,
    invoiceId: id,
  });
}
