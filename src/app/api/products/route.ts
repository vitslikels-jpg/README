import { jsonUtf8 } from "@/lib/http";
import { listCatalogProductsReadModel } from "@/lib/product-catalog";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();
  const supplierId = searchParams.get("supplierId")?.trim();
  const source = searchParams.get("source")?.trim();
  const useCatalog = searchParams.get("useCatalog")?.trim() === "true";
  const search = searchParams.get("search")?.trim() ?? "";

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const enterprise = await prisma.enterprise.findUnique({
    where: {
      id: enterpriseId,
    },
    select: {
      id: true,
    },
  });

  if (!enterprise) {
    return jsonUtf8({ message: "Предприятие не найдено." }, { status: 404 });
  }

  if (supplierId) {
    const supplier = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        enterpriseId,
        archivedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!supplier) {
      return jsonUtf8(
        { message: "Поставщик не найден в выбранном предприятии." },
        { status: 404 },
      );
    }
  }

  if (source === "catalog" || useCatalog) {
    const products = await listCatalogProductsReadModel({
      enterpriseId,
      supplierId: supplierId || null,
      search,
    });

    return jsonUtf8(products);
  }

  const products = await prisma.product.findMany({
    where: {
      enterpriseId,
      ...(supplierId ? { supplierId } : {}),
      supplier: {
        archivedAt: null,
      },
      document: {
        isCurrent: true,
      },
    },
    select: {
      id: true,
      enterpriseId: true,
      supplierId: true,
      documentId: true,
      name: true,
      article: true,
      brand: true,
      country: true,
      unit: true,
      unitsPerPack: true,
      minOrderQuantity: true,
      orderStep: true,
      allowFractionalOrder: true,
      shipByBoxesOnly: true,
      price: true,
      stock: true,
      sourceRow: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ supplier: { name: "asc" } }, { name: "asc" }],
  });

  return jsonUtf8(products);
}
