import { Prisma } from "@prisma/client";
import { jsonUtf8 } from "@/lib/http";
import { ensureEnterpriseExists } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function pricesAreEqual(left: Prisma.Decimal | null, right: Prisma.Decimal) {
  if (!left) {
    return false;
  }

  return left.toDecimalPlaces(2).equals(right.toDecimalPlaces(2));
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    enterpriseId?: string;
  };

  const enterpriseId = body.enterpriseId?.trim();

  if (!enterpriseId) {
    return jsonUtf8({ message: "Поле enterpriseId обязательно." }, { status: 400 });
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
      items: {
        where: {
          matchedProductId: {
            not: null,
          },
          priceWithVat: {
            not: null,
          },
        },
        include: {
          matchedProduct: {
            select: {
              id: true,
              supplierId: true,
              price: true,
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

  let createdPriceChangesCount = 0;
  let skippedItemsCount = 0;

  await prisma.$transaction(async (tx) => {
    await tx.invoicePriceChange.deleteMany({
      where: {
        invoiceDocumentId: id,
        status: "pending",
      },
    });

    for (const item of invoice.items) {
      if (!item.matchedProduct || !item.priceWithVat) {
        continue;
      }

      const supplierId = invoice.supplierId ?? item.matchedProduct.supplierId ?? null;

      if (!supplierId) {
        skippedItemsCount += 1;
        await tx.invoiceItem.update({
          where: {
            id: item.id,
          },
          data: {
            needsReview: true,
          },
        });
        continue;
      }

      const oldPrice = item.matchedProduct.price;
      const newPrice = item.priceWithVat;

      if (pricesAreEqual(oldPrice, newPrice)) {
        continue;
      }

      const differenceAmount = oldPrice ? newPrice.minus(oldPrice).toDecimalPlaces(2) : null;
      const differencePercent =
        oldPrice && oldPrice.gt(0)
          ? newPrice
              .minus(oldPrice)
              .div(oldPrice)
              .mul(100)
              .toDecimalPlaces(2)
          : null;

      await tx.invoicePriceChange.create({
        data: {
          invoiceDocumentId: id,
          invoiceItemId: item.id,
          productId: item.matchedProduct.id,
          supplierId,
          oldPrice,
          newPrice,
          differenceAmount,
          differencePercent,
          status: "pending",
        },
      });

      createdPriceChangesCount += 1;
    }

    const reviewItemsCount = await tx.invoiceItem.count({
      where: {
        invoiceDocumentId: id,
        needsReview: true,
      },
    });

    await tx.invoiceDocument.update({
      where: {
        id,
      },
      data: {
        status: createdPriceChangesCount > 0 || reviewItemsCount > 0 ? "needs_review" : "parsed",
      },
    });
  });

  return jsonUtf8({
    invoiceId: id,
    createdPriceChangesCount,
    skippedItemsCount,
  });
}
