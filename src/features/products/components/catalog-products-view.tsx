"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";
import type { CatalogProductListItem } from "@/features/products/types";

function formatPrice(value: string | null) {
  if (!value) {
    return "—";
  }

  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return value;
  }

  return `${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: numberValue % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(numberValue)} ₽`;
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function matchesProduct(product: CatalogProductListItem, search: string) {
  const normalized = normalizeSearch(search);

  if (!normalized) {
    return true;
  }

  return [product.name, product.brand, product.category, product.bestOffer?.supplier.name]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalized));
}

function getCatalogOfferDefaultQuantity(product: CatalogProductListItem) {
  const bestOffer = product.bestOffer;

  if (!bestOffer) {
    return "1";
  }

  return (
    bestOffer.minOrderQuantity ??
    (bestOffer.shipByBoxesOnly ? bestOffer.unitsPerPack : null) ??
    bestOffer.orderStep ??
    "1"
  );
}

function getBestOfferUsability(product: CatalogProductListItem) {
  return product.bestOffer?.currentPriceSnapshot?.document?.qualityReport?.usabilityStatus ?? "needs_review";
}

function getBestOfferUsabilityReason(product: CatalogProductListItem) {
  return (
    product.bestOffer?.currentPriceSnapshot?.document?.qualityReport?.usabilityReason ??
    "Для этого прайса нет quality-report. Использовать можно только после проверки."
  );
}

export function CatalogProductsView() {
  const searchParams = useSearchParams();
  const { activeEnterprise, activeEnterpriseId } = useEnterprise();
  const [products, setProducts] = useState<CatalogProductListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [quantityByProductId, setQuantityByProductId] = useState<Record<string, string>>({});
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(searchInput);

  const enterpriseIdFromUrl = searchParams.get("enterpriseId")?.trim() || "";
  const supplierIdFromUrl = searchParams.get("supplierId")?.trim() || "";
  const effectiveEnterpriseId = enterpriseIdFromUrl || activeEnterpriseId || "";

  useEffect(() => {
    setProducts([]);
    setErrorText("");

    if (!effectiveEnterpriseId) {
      return;
    }

    async function loadProducts() {
      setIsLoading(true);

      try {
        const params = new URLSearchParams({
          enterpriseId: effectiveEnterpriseId,
          source: "catalog",
        });

        if (supplierIdFromUrl) {
          params.set("supplierId", supplierIdFromUrl);
        }

        const response = await fetch(`/api/products?${params.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(payload?.message ?? "Не удалось загрузить catalog-товары.");
        }

        const data = (await response.json()) as CatalogProductListItem[];
        setProducts(data);
        setQuantityByProductId((current) => {
          const next = { ...current };

          for (const product of data) {
            if (!next[product.id]) {
              next[product.id] = getCatalogOfferDefaultQuantity(product);
            }
          }

          return next;
        });
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : "Не удалось загрузить catalog-товары.");
      } finally {
        setIsLoading(false);
      }
    }

    void loadProducts();
  }, [effectiveEnterpriseId, supplierIdFromUrl]);

  const filteredProducts = useMemo(
    () => products.filter((product) => matchesProduct(product, deferredSearch)),
    [deferredSearch, products],
  );

  async function handleAddToOrder(product: CatalogProductListItem) {
    if (!effectiveEnterpriseId || !product.bestOffer?.currentPriceSnapshot) {
      return;
    }

    setPendingProductId(product.id);
    setErrorText("");
    setSuccessText("");

    try {
      const quantity = quantityByProductId[product.id] ?? getCatalogOfferDefaultQuantity(product);
      const supplierId = product.bestOffer.supplier.id;
      const usabilityStatus = getBestOfferUsability(product);
      const usabilityReason = getBestOfferUsabilityReason(product);
      const confirmQualityWarning =
        usabilityStatus === "needs_review"
          ? window.confirm(`${usabilityReason}\n\nПодтвердить добавление в заказ?`)
          : false;

      if (usabilityStatus === "needs_review" && !confirmQualityWarning) {
        return;
      }

      const orderResponse = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enterpriseId: effectiveEnterpriseId,
          supplierId,
          reuseDraft: true,
        }),
      });

      const orderPayload = (await orderResponse.json().catch(() => null)) as { id?: string; message?: string } | null;

      if (!orderResponse.ok || !orderPayload?.id) {
        throw new Error(orderPayload?.message ?? "Не удалось создать или получить draft order.");
      }

      const itemResponse = await fetch(`/api/orders/${orderPayload.id}/items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enterpriseId: effectiveEnterpriseId,
          productMasterId: product.id,
          supplierOfferId: product.bestOffer.id,
          priceSnapshotId: product.bestOffer.currentPriceSnapshot.id,
          confirmQualityWarning,
          quantity,
        }),
      });

      const itemPayload = (await itemResponse.json().catch(() => null)) as { message?: string } | null;

      if (!itemResponse.ok) {
        throw new Error(itemPayload?.message ?? "Не удалось добавить позицию в draft order.");
      }

      setSuccessText(`Добавил "${product.name}" в черновик заказа поставщика ${product.bestOffer.supplier.name}.`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Не удалось добавить товар в заказ.");
    } finally {
      setPendingProductId(null);
    }
  }

  return (
    <div className="pageStack">
      <section className="heroCard">
        <p className="panelEyebrow">Товары</p>
        <h2 className="pageTitle">Каталог товаров по ProductMaster</h2>
        <p className="pageDescription">
          Это новый read-model: один внутренний товар, несколько предложений поставщиков, диапазон цен и лучший offer.
          Для catalog-режима теперь действует quality-gate по качеству прайса.
        </p>
        <div className="catalogProductsHeroActions">
          <Link className="secondaryButton compactButton" href="/products">
            Legacy режим
          </Link>
          <Link className="secondaryButton compactButton" href="/catalog">
            Ручное сопоставление
          </Link>
        </div>
      </section>

      {!effectiveEnterpriseId ? (
        <section className="card pagePlaceholder">
          <p className="panelEyebrow">Товары</p>
          <h2 className="pageTitle">Сначала выберите предприятие</h2>
          <p className="pageDescription">Без активного предприятия catalog-read работать не будет.</p>
        </section>
      ) : (
        <>
          <section className="card productsWorkspaceCard">
            <div className="productsWorkspaceHeader">
              <div className="cardHeader">
                <div>
                  <p className="panelEyebrow">Catalog read</p>
                  <h2 className="sectionTitle">{activeEnterprise?.name ?? "Предприятие"}</h2>
                </div>
                <span className="counterBadge">{products.length}</span>
              </div>

              <div className="suppliersToolbar">
                <label className="field">
                  <span>Поиск по ProductMaster</span>
                  <input
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder="Название, бренд, категория, лучший поставщик"
                  />
                </label>
              </div>

              <p className="pageDescription productsWorkspaceDescription">
                В этом режиме `/products` читает новую модель `ProductMaster + SupplierOffer + current PriceSnapshot`.
                Legacy `/products` остался отдельным supplier-based экраном со старыми order-кнопками.
              </p>

              {errorText ? <p className="errorText">{errorText}</p> : null}
              {successText ? <p className="successText">{successText}</p> : null}
            </div>
          </section>

          <section className="card productsListCard">
            {isLoading ? (
              <div className="emptyState">
                <p className="emptyStateTitle">Загрузка каталога</p>
                <p className="emptyStateText">Собираю ProductMaster и предложения поставщиков.</p>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="emptyState">
                <p className="emptyStateTitle">Ничего не найдено</p>
                <p className="emptyStateText">Либо каталог ещё пустой, либо фильтр слишком жёсткий.</p>
              </div>
            ) : (
              <div className="catalogProductsList">
                {filteredProducts.map((product) => {
                  const shouldShowMappingLink = product.offersCount < 2 || product.hasSimilarUnmappedOffers;
                  const quantity = quantityByProductId[product.id] ?? getCatalogOfferDefaultQuantity(product);
                  const bestOffer = product.bestOffer;
                  const usabilityStatus = getBestOfferUsability(product);
                  const usabilityReason = getBestOfferUsabilityReason(product);
                  const hasSnapshot = Boolean(bestOffer?.currentPriceSnapshot);
                  const canOrder = hasSnapshot && usabilityStatus !== "blocked";
                  const shouldShowWarning = shouldShowMappingLink || !hasSnapshot || usabilityStatus !== "usable";

                  return (
                    <article key={product.id} className="catalogProductCard">
                      <div className="catalogProductMain">
                        <div>
                          <h3>{product.name}</h3>
                          <p>
                            {product.brand || "Без бренда"}
                            {product.category ? ` • ${product.category}` : ""}
                            {product.unit?.symbol ? ` • ${product.unit.symbol}` : ""}
                          </p>
                        </div>
                        <div className="catalogProductMeta">
                          <div className="compactProductFact">
                            <span className="compactProductFactLabel">Цена</span>
                            <strong>
                              {formatPrice(product.minCurrentPrice)} — {formatPrice(product.maxCurrentPrice)}
                            </strong>
                          </div>
                          <div className="compactProductFact">
                            <span className="compactProductFactLabel">Предложений</span>
                            <strong>{product.offersCount}</strong>
                          </div>
                          <div className="compactProductFact">
                            <span className="compactProductFactLabel">Лучший поставщик</span>
                            <strong>{bestOffer?.supplier.name ?? "—"}</strong>
                          </div>
                          <div className="compactProductFact">
                            <span className="compactProductFactLabel">Статус прайса</span>
                            <strong>{usabilityStatus}</strong>
                          </div>
                        </div>
                      </div>

                      {shouldShowWarning ? (
                        <div className="emptyState">
                          <p className="emptyStateTitle">Нужна проверка данных</p>
                          <p className="emptyStateText">
                            {!hasSnapshot
                              ? "У лучшего offer нет current price snapshot, поэтому заказ отсюда пока скрыт."
                              : usabilityStatus === "blocked"
                                ? usabilityReason
                                : usabilityStatus === "needs_review"
                                  ? usabilityReason
                                  : "У товара мало offers или рядом есть похожие unmapped позиции. Лучше проверить сопоставление."}
                          </p>
                        </div>
                      ) : null}

                      <div className="catalogProductOffers">
                        {product.currentOffers.map((offer) => (
                          <div key={offer.id} className="catalogProductOfferRow">
                            <div>
                              <strong>{offer.supplier.name}</strong>
                              <p>
                                {offer.name}
                                {offer.article ? ` • ${offer.article}` : ""}
                              </p>
                            </div>
                            <div className="catalogOfferMeta">
                              <span>Цена: {formatPrice(offer.currentPriceSnapshot?.price ?? null)}</span>
                              <span>Остаток: {offer.currentPriceSnapshot?.stock ?? "—"}</span>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="catalogProductFooter">
                        <span className="catalogProductSuppliers">
                          Поставщики: {product.suppliers.map((supplier) => supplier.name).join(", ") || "—"}
                        </span>

                        <div className="catalogProductOrderBox">
                          {hasSnapshot ? (
                            <>
                              <input
                                value={quantity}
                                onChange={(event) =>
                                  setQuantityByProductId((current) => ({
                                    ...current,
                                    [product.id]: event.target.value,
                                  }))
                                }
                              />
                              <button
                                type="button"
                                className="primaryButton compactButton"
                                disabled={pendingProductId === product.id || !canOrder}
                                onClick={() => void handleAddToOrder(product)}
                              >
                                {pendingProductId === product.id
                                  ? "..."
                                  : usabilityStatus === "blocked"
                                    ? "Заблокировано"
                                    : "В заказ"}
                              </button>
                            </>
                          ) : null}

                          {shouldShowMappingLink ? (
                            <Link className="secondaryButton compactButton" href="/catalog">
                              Сопоставить
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
