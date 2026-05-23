"use client";
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";
import { CatalogProductsView } from "@/features/products/components/catalog-products-view";
import type { OrderItem, OrderListItem } from "@/features/orders/types";
import type { ProductListItem } from "@/features/products/types";
import type { Supplier } from "@/features/suppliers/types";

function formatDecimal(value: string | null, suffix?: string) {
  if (!value) {
    return "—";
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return suffix ? `${value} ${suffix}` : value;
  }

  const formatted = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: numberValue % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 3,
  }).format(numberValue);

  return suffix ? `${formatted} ${suffix}` : formatted;
}

function formatPrice(value: string | null) {
  return value ? `${formatDecimal(value)} ₽` : "—";
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function matchesProduct(product: ProductListItem, search: string) {
  const normalizedSearch = normalizeSearch(search);

  if (!normalizedSearch) {
    return true;
  }

  return [product.name, product.article, product.brand]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalizedSearch));
}

function getEffectiveMinimum(product: ProductListItem) {
  return product.minOrderQuantity ?? (product.shipByBoxesOnly ? product.unitsPerPack : null) ?? product.orderStep ?? null;
}

function getEffectiveStep(product: ProductListItem) {
  if (product.shipByBoxesOnly && product.unitsPerPack) {
    return product.unitsPerPack;
  }

  return product.orderStep ?? (product.allowFractionalOrder ? "0.001" : "1");
}

function getDefaultQuantity(product: ProductListItem) {
  return getEffectiveMinimum(product) ?? getEffectiveStep(product) ?? "1";
}

function decimalStringToNumber(value: string | null | undefined, fallback = 0) {
  const numberValue = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeQuantityNumber(value: number) {
  return value
    .toFixed(3)
    .replace(/\.?0+$/, "");
}

function getIncrementedQuantity(product: ProductListItem, currentQuantity: string) {
  const step = decimalStringToNumber(getEffectiveStep(product), product.allowFractionalOrder ? 0.001 : 1);
  const current = decimalStringToNumber(currentQuantity);
  return normalizeQuantityNumber(current + step);
}

function getDecrementedQuantity(product: ProductListItem, currentQuantity: string) {
  const step = decimalStringToNumber(getEffectiveStep(product), product.allowFractionalOrder ? 0.001 : 1);
  const minimum = decimalStringToNumber(getEffectiveMinimum(product), step);
  const nextQuantity = decimalStringToNumber(currentQuantity) - step;

  if (nextQuantity < minimum || nextQuantity <= 0) {
    return null;
  }

  return normalizeQuantityNumber(nextQuantity);
}

function getProductMetaLine(product: ProductListItem) {
  return [product.brand, product.country].filter(Boolean).join(" • ") || "Без бренда и страны";
}

function getMinimumOrderLabel(product: ProductListItem) {
  return formatDecimal(getEffectiveMinimum(product) ?? "1", product.unit || undefined);
}

type ProductsBySupplier = Record<string, ProductListItem[] | undefined>;
type OrdersBySupplier = Record<string, OrderListItem | null | undefined>;

type ProductNameCellProps = {
  name: string;
  meta: string;
};

const ProductNameCell = memo(function ProductNameCell({ name, meta }: ProductNameCellProps) {
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  function handlePointerEnter() {
    if (typeof window === "undefined" || !window.matchMedia("(min-width: 1024px)").matches) {
      return;
    }

    const element = titleRef.current;

    if (!element) {
      return;
    }

    setShowTooltip(element.scrollWidth > element.clientWidth);
  }

  function handlePointerLeave() {
    setShowTooltip(false);
  }

  return (
    <div className="compactProductMain">
      <div
        className="compactProductTitleWrap"
        onMouseEnter={handlePointerEnter}
        onMouseLeave={handlePointerLeave}
      >
        <h3 ref={titleRef}>{name}</h3>
        {showTooltip ? (
          <div className="productNameTooltip" role="tooltip">
            {name}
          </div>
        ) : null}
      </div>
      <p>{meta}</p>
    </div>
  );
});

type ProductRowProps = {
  supplierId: string;
  product: ProductListItem;
  orderId: string | null;
  orderItem: OrderItem | null;
  isCompared: boolean;
  pendingProductId: string | null;
  pendingItemId: string | null;
  onToggleCompare: (productId: string) => void;
  onAddToOrder: (supplierId: string, product: ProductListItem, quantity: string) => Promise<void>;
  onUpdateOrderItem: (supplierId: string, orderId: string, item: OrderItem, quantity: string) => Promise<void>;
  onDeleteOrderItem: (supplierId: string, orderId: string, itemId: string) => Promise<void>;
};

const ProductRow = memo(function ProductRow({
  supplierId,
  product,
  orderId,
  orderItem,
  isCompared,
  pendingProductId,
  pendingItemId,
  onToggleCompare,
  onAddToOrder,
  onUpdateOrderItem,
  onDeleteOrderItem,
}: ProductRowProps) {
  const defaultQuantity = getDefaultQuantity(product);
  const isAdding = pendingProductId === product.id;
  const isUpdating = orderItem ? pendingItemId === orderItem.id : false;
  const isPending = isAdding || isUpdating;
  const displayedQuantity = orderItem ? formatDecimal(orderItem.quantity, product.unit || undefined) : "0";

  function handleIncrease() {
    if (orderId && orderItem) {
      void onUpdateOrderItem(supplierId, orderId, orderItem, getIncrementedQuantity(product, orderItem.quantity));
      return;
    }

    void onAddToOrder(supplierId, product, defaultQuantity);
  }

  function handleDecrease() {
    if (!orderId || !orderItem) {
      return;
    }

    const nextQuantity = getDecrementedQuantity(product, orderItem.quantity);

    if (!nextQuantity) {
      void onDeleteOrderItem(supplierId, orderId, orderItem.id);
      return;
    }

    void onUpdateOrderItem(supplierId, orderId, orderItem, nextQuantity);
  }

  return (
    <article className="compactProductRow">
      <ProductNameCell name={product.name} meta={getProductMetaLine(product)} />

      <div className="compactProductFact">
        <span className="compactProductFactLabel">Мин. заказ</span>
        <strong>{getMinimumOrderLabel(product)}</strong>
      </div>

      <div className="compactProductFact compactProductUnit">
        <span className="compactProductFactLabel">Единица</span>
        <strong>{product.unit || "—"}</strong>
      </div>

      <div className="compactProductFact compactProductPrice">
        <span className="compactProductFactLabel">Цена</span>
        <strong>{formatPrice(product.price)}</strong>
      </div>

      <div className="compactProductActions">
        <button
          type="button"
          className={`secondaryButton compactButton ${isCompared ? "compareButtonActive" : ""}`}
          onClick={() => onToggleCompare(product.id)}
        >
          {isCompared ? "В сравнении" : "Сравнить"}
        </button>

        <div className={`compactQuantityControl ${orderItem ? "compactQuantityControlActive" : ""}`}>
          <button
            type="button"
            className="secondaryButton compactQuantityButton"
            onClick={handleDecrease}
            disabled={!orderItem || isPending}
            aria-label={`Уменьшить количество: ${product.name}`}
          >
            −
          </button>
          <span className="compactQuantityValue" aria-live="polite">
            {isPending ? "..." : displayedQuantity}
          </span>
          <button
            type="button"
            className="primaryButton compactQuantityButton"
            onClick={handleIncrease}
            disabled={isPending}
            aria-label={`Увеличить количество: ${product.name}`}
          >
            +
          </button>
        </div>
      </div>
    </article>
  );
});

type SupplierAccordionItemProps = {
  supplier: Supplier;
  isExpanded: boolean;
  supplierProducts: ProductListItem[] | undefined;
  isLoadingProducts: boolean;
  order: OrderListItem | null;
  isLoadingOrder: boolean;
  orderError: string;
  productsError: string;
  onToggleSupplier: (supplierId: string) => void;
  onAddToOrder: (supplierId: string, product: ProductListItem, quantity: string) => Promise<void>;
  onUpdateOrderItem: (supplierId: string, orderId: string, item: OrderItem, quantity: string) => Promise<void>;
  onDeleteOrderItem: (supplierId: string, orderId: string, itemId: string) => Promise<void>;
  pendingProductId: string | null;
  pendingItemId: string | null;
};

const SupplierAccordionItem = memo(function SupplierAccordionItem({
  supplier,
  isExpanded,
  supplierProducts,
  isLoadingProducts,
  order,
  isLoadingOrder,
  orderError,
  productsError,
  onToggleSupplier,
  onAddToOrder,
  onUpdateOrderItem,
  onDeleteOrderItem,
  pendingProductId,
  pendingItemId,
}: SupplierAccordionItemProps) {
  const [productSearchInput, setProductSearchInput] = useState("");
  const deferredProductSearch = useDeferredValue(productSearchInput);
  const [comparedProductIds, setComparedProductIds] = useState<string[]>([]);

  const orderItemsByProductId = useMemo(() => {
    return new Map(
      (order?.items ?? [])
        .filter((item) => item.productId)
        .map((item) => [item.productId as string, item]),
    );
  }, [order]);

  const filteredProducts = useMemo(() => {
    return (supplierProducts ?? []).filter((product) => matchesProduct(product, deferredProductSearch));
  }, [deferredProductSearch, supplierProducts]);

  const suggestions = useMemo(() => {
    if (!productSearchInput.trim()) {
      return [];
    }

    return filteredProducts.slice(0, 8);
  }, [filteredProducts, productSearchInput]);

  const toggleComparedProduct = useCallback((productId: string) => {
    setComparedProductIds((current) => {
      if (current.includes(productId)) {
        return current.filter((id) => id !== productId);
      }

      return [...current, productId];
    });
  }, []);

  return (
    <article className="supplierAccordionCard">
      <button
        type="button"
        className={`supplierRow supplierAccordionToggle ${isExpanded ? "supplierRowActive" : ""}`}
        onClick={() => onToggleSupplier(supplier.id)}
      >
        <div className="supplierRowMain">
          <h3>{supplier.name}</h3>
          <p>{supplier.phone || "Телефон не указан"}</p>
        </div>

        <div className="supplierRowMeta">
          <span>{supplier.managerName || "Менеджер не указан"}</span>
          <span>{supplier.email || "Email не указан"}</span>
        </div>
      </button>

      {isExpanded ? (
        <div className="supplierAccordionBody">
          <div className="supplierAccordionSummary">
            <div className="supplierAccordionMeta">
              <span>Мин. сумма заказа</span>
              <strong>{supplier.minOrderAmount ? formatPrice(supplier.minOrderAmount) : "—"}</strong>
            </div>
            <div className="supplierAccordionMeta">
              <span>Товаров в актуальном прайсе</span>
              <strong>{supplierProducts?.length ?? 0}</strong>
            </div>
          </div>

          <div className="supplierProductsToolbar">
            <label className="field supplierProductSearchField">
              <span>Быстрый поиск по товарам</span>
              <div className="searchSuggest">
                <input
                  value={productSearchInput}
                  onChange={(event) => setProductSearchInput(event.target.value)}
                  placeholder="Название, артикул или бренд"
                />

                {productSearchInput.trim() && suggestions.length > 0 ? (
                  <div className="searchSuggestDropdown">
                    {suggestions.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        className="searchSuggestOption"
                        onClick={() => setProductSearchInput(product.name)}
                      >
                        <strong>{product.name}</strong>
                        <span>
                          {[product.article, product.brand].filter(Boolean).join(" • ") || "Без артикула и бренда"}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </label>
          </div>

          {orderError ? <p className="errorText">{orderError}</p> : null}
          {productsError ? <p className="errorText">{productsError}</p> : null}
          {isLoadingOrder ? <p className="panelText">Проверяю черновик заказа для этого поставщика.</p> : null}

          <div className="supplierProductsPane">
            {isLoadingProducts ? (
              <div className="emptyState">
                <p className="emptyStateTitle">Загрузка товаров</p>
                <p className="emptyStateText">Список товаров загружается.</p>
              </div>
            ) : !supplierProducts || supplierProducts.length === 0 ? (
              <div className="emptyState">
                <p className="emptyStateTitle">Товаров пока нет</p>
                <p className="emptyStateText">
                  Для этого поставщика еще не разобран актуальный Excel или CSV-прайс.
                </p>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="emptyState">
                <p className="emptyStateTitle">Нет совпадений</p>
                <p className="emptyStateText">Попробуйте другой запрос по названию, артикулу или бренду.</p>
              </div>
            ) : (
              <div className="compactProductsList">
                {filteredProducts.map((product) => {
                  const orderItem = orderItemsByProductId.get(product.id) ?? null;

                  return (
                    <ProductRow
                      key={product.id}
                      supplierId={supplier.id}
                      product={product}
                      orderId={order?.id ?? null}
                      orderItem={orderItem}
                      isCompared={comparedProductIds.includes(product.id)}
                      pendingProductId={pendingProductId}
                      pendingItemId={pendingItemId}
                      onToggleCompare={toggleComparedProduct}
                      onAddToOrder={onAddToOrder}
                      onUpdateOrderItem={onUpdateOrderItem}
                      onDeleteOrderItem={onDeleteOrderItem}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
});

export function ProductsPage() {
  const searchParams = useSearchParams();
  const { enterprises, activeEnterprise, activeEnterpriseId, selectEnterprise } = useEnterprise();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [productsBySupplier, setProductsBySupplier] = useState<ProductsBySupplier>({});
  const [ordersBySupplier, setOrdersBySupplier] = useState<OrdersBySupplier>({});
  const [expandedSupplierId, setExpandedSupplierId] = useState<string | null>(null);
  const [loadingSupplierId, setLoadingSupplierId] = useState<string | null>(null);
  const [loadingOrderSupplierId, setLoadingOrderSupplierId] = useState<string | null>(null);
  const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(false);
  const [listError, setListError] = useState("");
  const [productsError, setProductsError] = useState("");
  const [supplierSearchInput, setSupplierSearchInput] = useState("");
  const [orderErrors, setOrderErrors] = useState<Record<string, string>>({});
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const draftOrderRequestsRef = useRef<Record<string, Promise<OrderListItem | null> | undefined>>({});

  const enterpriseIdFromUrl = searchParams.get("enterpriseId")?.trim() || "";
  const supplierIdFromUrl = searchParams.get("supplierId")?.trim() || "";
  const sourceFromUrl = searchParams.get("source")?.trim() || "";
  const useCatalog = searchParams.get("useCatalog")?.trim() === "true";
  const effectiveEnterpriseId = enterpriseIdFromUrl || activeEnterpriseId || enterprises[0]?.id || "";
  const deferredSupplierSearch = useDeferredValue(supplierSearchInput);
  const isCatalogMode = sourceFromUrl === "catalog" || useCatalog;

  useEffect(() => {
    if (!enterpriseIdFromUrl || enterpriseIdFromUrl === activeEnterpriseId) {
      return;
    }

    if (!enterprises.some((enterprise) => enterprise.id === enterpriseIdFromUrl)) {
      return;
    }

    selectEnterprise(enterpriseIdFromUrl);
  }, [activeEnterpriseId, enterpriseIdFromUrl, enterprises, selectEnterprise]);

  useEffect(() => {
    setSuppliers([]);
    setProductsBySupplier({});
    setOrdersBySupplier({});
    setExpandedSupplierId(null);
    setListError("");
    setProductsError("");
    setOrderErrors({});

    if (!effectiveEnterpriseId) {
      return;
    }

    async function loadSuppliers() {
      setIsLoadingSuppliers(true);

      try {
        const response = await fetch(`/api/suppliers?enterpriseId=${encodeURIComponent(effectiveEnterpriseId)}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Не удалось получить список поставщиков.");
        }

        const data = (await response.json()) as Supplier[];
        setSuppliers(data);

        const preferredSupplierId =
          (supplierIdFromUrl && data.some((supplier) => supplier.id === supplierIdFromUrl) && supplierIdFromUrl) ||
          data[0]?.id ||
          null;

        setExpandedSupplierId(preferredSupplierId);
      } catch (error) {
        setListError(error instanceof Error ? error.message : "Ошибка загрузки поставщиков.");
      } finally {
        setIsLoadingSuppliers(false);
      }
    }

    void loadSuppliers();
  }, [effectiveEnterpriseId, supplierIdFromUrl]);

  useEffect(() => {
    if (!effectiveEnterpriseId || !expandedSupplierId || productsBySupplier[expandedSupplierId] !== undefined) {
      return;
    }

    const supplierId = expandedSupplierId;

    async function loadProducts() {
      setLoadingSupplierId(supplierId);
      setProductsError("");

      try {
        const params = new URLSearchParams({
          enterpriseId: effectiveEnterpriseId,
          supplierId,
        });

        const response = await fetch(`/api/products?${params.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Не удалось получить товары поставщика.");
        }

        const data = (await response.json()) as ProductListItem[];

        setProductsBySupplier((current) => ({
          ...current,
          [supplierId]: data,
        }));
      } catch (error) {
        setProductsError(error instanceof Error ? error.message : "Ошибка загрузки товаров.");
      } finally {
        setLoadingSupplierId(null);
      }
    }

    void loadProducts();
  }, [effectiveEnterpriseId, expandedSupplierId, productsBySupplier]);

  const filteredSuppliers = useMemo(() => {
    const normalizedSearch = normalizeSearch(deferredSupplierSearch);

    if (!normalizedSearch) {
      return suppliers;
    }

    return suppliers.filter((supplier) => {
      return [supplier.name, supplier.phone, supplier.managerName, supplier.email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    });
  }, [deferredSupplierSearch, suppliers]);

  const syncOrderState = useCallback((supplierId: string, order: OrderListItem | null) => {
    setOrdersBySupplier((current) => ({
      ...current,
      [supplierId]: order,
    }));
  }, []);

  const loadDraftOrder = useCallback(async (supplierId: string) => {
    if (!effectiveEnterpriseId) {
      return null;
    }

    const existingRequest = draftOrderRequestsRef.current[supplierId];

    if (existingRequest) {
      return existingRequest;
    }

    const request = (async () => {
      setLoadingOrderSupplierId(supplierId);
      setOrderErrors((current) => ({ ...current, [supplierId]: "" }));

      try {
        const params = new URLSearchParams({
          enterpriseId: effectiveEnterpriseId,
          supplierId,
          status: "draft",
        });

        const response = await fetch(`/api/orders?${params.toString()}`, { cache: "no-store" });

        if (!response.ok) {
          throw new Error("Не удалось получить текущий заказ.");
        }

        const orders = (await response.json()) as OrderListItem[];
        const draftOrder = orders[0] ?? null;
        syncOrderState(supplierId, draftOrder);
        return draftOrder;
      } catch (error) {
        setOrderErrors((current) => ({
          ...current,
          [supplierId]: error instanceof Error ? error.message : "Ошибка загрузки заказа.",
        }));
        return null;
      } finally {
        delete draftOrderRequestsRef.current[supplierId];
        setLoadingOrderSupplierId((current) => (current === supplierId ? null : current));
      }
    })();

    draftOrderRequestsRef.current[supplierId] = request;
    return request;
  }, [effectiveEnterpriseId, syncOrderState]);

  useEffect(() => {
    if (!effectiveEnterpriseId || !expandedSupplierId || ordersBySupplier[expandedSupplierId] !== undefined) {
      return;
    }

    void loadDraftOrder(expandedSupplierId);
  }, [effectiveEnterpriseId, expandedSupplierId, ordersBySupplier, loadDraftOrder]);

  const ensureDraftOrder = useCallback(async (supplierId: string) => {
    const existingOrder = ordersBySupplier[supplierId];

    if (existingOrder) {
      return existingOrder;
    }

    const loadedOrder = await loadDraftOrder(supplierId);

    if (loadedOrder) {
      return loadedOrder;
    }

    const response = await fetch("/api/orders", {
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

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(data?.message || "Не удалось создать заказ.");
    }

    const createdOrder = (await response.json()) as OrderListItem;
    syncOrderState(supplierId, createdOrder);
    return createdOrder;
  }, [effectiveEnterpriseId, loadDraftOrder, ordersBySupplier, syncOrderState]);

  const toggleSupplier = useCallback((supplierId: string) => {
    setProductsError("");
    setExpandedSupplierId((current) => (current === supplierId ? null : supplierId));
  }, []);

  const handleAddToOrder = useCallback(async (supplierId: string, product: ProductListItem, quantity: string) => {
    if (!effectiveEnterpriseId) {
      return;
    }

    setPendingProductId(product.id);
    setOrderErrors((current) => ({ ...current, [supplierId]: "" }));

    try {
      const order = await ensureDraftOrder(supplierId);

      const response = await fetch(`/api/orders/${order.id}/items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enterpriseId: effectiveEnterpriseId,
          productId: product.id,
          quantity,
        }),
      });

      const data = (await response.json()) as OrderListItem | { message?: string };

      if (!response.ok) {
        throw new Error("message" in data ? data.message || "Не удалось добавить товар в заказ." : "Не удалось добавить товар.");
      }

      syncOrderState(supplierId, data as OrderListItem);
    } catch (error) {
      setOrderErrors((current) => ({
        ...current,
        [supplierId]: error instanceof Error ? error.message : "Не удалось добавить товар в заказ.",
      }));
    } finally {
      setPendingProductId(null);
    }
  }, [effectiveEnterpriseId, ensureDraftOrder, syncOrderState]);

  const handleUpdateOrderItem = useCallback(async (supplierId: string, orderId: string, item: OrderItem, quantity: string) => {
    if (!effectiveEnterpriseId) {
      return;
    }

    setPendingItemId(item.id);
    setOrderErrors((current) => ({ ...current, [supplierId]: "" }));

    try {
      const response = await fetch(`/api/orders/${orderId}/items/${item.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enterpriseId: effectiveEnterpriseId,
          quantity,
        }),
      });

      const data = (await response.json()) as OrderListItem | { message?: string };

      if (!response.ok) {
        throw new Error("message" in data ? data.message || "Не удалось обновить количество." : "Не удалось обновить количество.");
      }

      syncOrderState(supplierId, data as OrderListItem);
    } catch (error) {
      setOrderErrors((current) => ({
        ...current,
        [supplierId]: error instanceof Error ? error.message : "Не удалось обновить количество.",
      }));
    } finally {
      setPendingItemId(null);
    }
  }, [effectiveEnterpriseId, syncOrderState]);

  const handleDeleteOrderItem = useCallback(async (supplierId: string, orderId: string, itemId: string) => {
    if (!effectiveEnterpriseId) {
      return;
    }

    setPendingItemId(itemId);
    setOrderErrors((current) => ({ ...current, [supplierId]: "" }));

    try {
      const params = new URLSearchParams({
        enterpriseId: effectiveEnterpriseId,
      });

      const response = await fetch(`/api/orders/${orderId}/items/${itemId}?${params.toString()}`, {
        method: "DELETE",
      });

      const data = (await response.json()) as OrderListItem | { message?: string };

      if (!response.ok) {
        throw new Error("message" in data ? data.message || "Не удалось удалить позицию." : "Не удалось удалить позицию.");
      }

      syncOrderState(supplierId, data as OrderListItem);
    } catch (error) {
      setOrderErrors((current) => ({
        ...current,
        [supplierId]: error instanceof Error ? error.message : "Не удалось удалить позицию.",
      }));
    } finally {
      setPendingItemId(null);
    }
  }, [effectiveEnterpriseId, syncOrderState]);

  if (isCatalogMode) {
    return <CatalogProductsView />;
  }

  return (
    <div className="pageStack">
      {!effectiveEnterpriseId ? (
        <>
          <section className="heroCard">
            <p className="panelEyebrow">Товары</p>
            <h2 className="pageTitle">Товары по поставщикам</h2>
            <p className="pageDescription">
              Раскройте поставщика, быстро найдите товар внутри его прайса и сразу добавьте позицию в текущий заказ.
            </p>
          </section>

          <section className="card pagePlaceholder">
            <p className="panelEyebrow">Товары</p>
            <h2 className="pageTitle">Сначала выберите предприятие</h2>
            <p className="pageDescription">
              Чтобы посмотреть товары и собрать заказ, выберите активное предприятие в верхней панели.
            </p>
          </section>
        </>
      ) : (
        <>
          <div className="productsStickyStack">
            <section className="heroCard">
              <p className="panelEyebrow">Товары</p>
              <h2 className="pageTitle">Товары по поставщикам</h2>
              <p className="pageDescription">
                Раскройте поставщика, быстро найдите товар внутри его прайса и сразу добавьте позицию в текущий заказ.
              </p>
            </section>

            <section className="card productsWorkspaceCard">
              <div className="productsWorkspaceHeader">
                <div className="cardHeader">
                  <div>
                    <p className="panelEyebrow">Активное предприятие</p>
                    <h2 className="sectionTitle">{activeEnterprise?.name ?? "Предприятие"}</h2>
                  </div>
                </div>

                <div className="suppliersToolbar">
                  <label className="field">
                    <span>Поиск поставщика</span>
                    <input
                      value={supplierSearchInput}
                      onChange={(event) => setSupplierSearchInput(event.target.value)}
                      placeholder="Название, телефон, менеджер или email"
                    />
                  </label>
                </div>

                <p className="pageDescription productsWorkspaceDescription">
                  Поставщики остаются в аккордеоне, а внутри каждого раскрытого блока теперь можно быстро искать товар и собирать заказ.
                </p>

                {listError ? <p className="errorText">{listError}</p> : null}
              </div>
            </section>
          </div>

          <section className="card productsListCard">
            <div className="supplierAccordionList">
              {isLoadingSuppliers ? (
                <div className="emptyState">
                  <p className="emptyStateTitle">Загрузка поставщиков</p>
                  <p className="emptyStateText">Список поставщиков загружается.</p>
                </div>
              ) : filteredSuppliers.length === 0 && suppliers.length === 0 ? (
                <div className="emptyState">
                  <p className="emptyStateTitle">Поставщиков пока нет</p>
                  <p className="emptyStateText">
                    Сначала добавьте поставщика и загрузите ему прайс во вкладке поставщиков.
                  </p>
                </div>
              ) : filteredSuppliers.length === 0 ? (
                <div className="emptyState">
                  <p className="emptyStateTitle">Ничего не найдено</p>
                  <p className="emptyStateText">По текущему запросу поставщики не найдены.</p>
                </div>
              ) : (
                filteredSuppliers.map((supplier) => (
                  <SupplierAccordionItem
                    key={supplier.id}
                    supplier={supplier}
                    isExpanded={supplier.id === expandedSupplierId}
                    supplierProducts={productsBySupplier[supplier.id]}
                    isLoadingProducts={loadingSupplierId === supplier.id}
                    order={ordersBySupplier[supplier.id] ?? null}
                    isLoadingOrder={loadingOrderSupplierId === supplier.id}
                    orderError={orderErrors[supplier.id] ?? ""}
                    productsError={supplier.id === expandedSupplierId ? productsError : ""}
                    onToggleSupplier={toggleSupplier}
                    onAddToOrder={handleAddToOrder}
                    onUpdateOrderItem={handleUpdateOrderItem}
                    onDeleteOrderItem={handleDeleteOrderItem}
                    pendingProductId={pendingProductId}
                    pendingItemId={pendingItemId}
                  />
                ))
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
