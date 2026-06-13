"use client";

import { useEffect, useMemo, useState } from "react";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";

type TestConnectionResponse = {
  ok: boolean;
  message: string;
  details?: string;
  serverUrl?: string;
};

type CatalogSummaryResponse = {
  ok: boolean;
  message?: string;
  details?: string;
  storesCount?: number;
  productsCount?: number;
  goodsCount?: number;
  lastSyncedAt?: string | null;
};

type SyncCatalogResponse = {
  ok: boolean;
  message?: string;
  details?: string;
  storesReceived?: number;
  storesCreated?: number;
  storesUpdated?: number;
  productsReceived?: number;
  productsCreated?: number;
  productsUpdated?: number;
  goodsCount?: number;
  errors?: string[];
};

type LinkedProductMaster = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  unit: {
    id: string;
    code: string;
    name: string;
    symbol: string;
  } | null;
};

type IikoProductListItem = {
  id: string;
  externalId: string;
  name: string | null;
  code: string | null;
  type: string | null;
  mainUnit: string | null;
  mapped: boolean;
  productMaster: LinkedProductMaster | null;
};

type IikoProductListResponse = {
  ok: boolean;
  message?: string;
  details?: string;
  items?: IikoProductListItem[];
  total?: number;
  limit?: number;
  offset?: number;
};

type ProductMasterSearchItem = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  unit: {
    id: string;
    code: string;
    name: string;
    symbol: string;
  } | null;
};

type MapResponse = {
  ok: boolean;
  message?: string;
};

function formatDateTime(value?: string | null) {
  if (!value) {
    return "Нет данных";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatMaster(item: LinkedProductMaster | ProductMasterSearchItem | null) {
  if (!item) {
    return "Не связано";
  }

  return [item.name, item.brand, item.unit?.symbol].filter(Boolean).join(" • ");
}

export function IikoConnectionCard({ serverUrl }: { serverUrl: string }) {
  const { activeEnterpriseId } = useEnterprise();
  const [isTesting, setIsTesting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [isMapping, setIsMapping] = useState(false);
  const [result, setResult] = useState<TestConnectionResponse | null>(null);
  const [summary, setSummary] = useState<CatalogSummaryResponse | null>(null);
  const [syncResult, setSyncResult] = useState<SyncCatalogResponse | null>(null);
  const [productsData, setProductsData] = useState<IikoProductListResponse | null>(null);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [mappingSuccess, setMappingSuccess] = useState<string | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [productType, setProductType] = useState("GOODS");
  const [productStatus, setProductStatus] = useState<"all" | "mapped" | "unmapped">("all");
  const [productOffset, setProductOffset] = useState(0);
  const [mappingTargetId, setMappingTargetId] = useState<string | null>(null);
  const [masterSearch, setMasterSearch] = useState("");
  const [masterItems, setMasterItems] = useState<ProductMasterSearchItem[]>([]);
  const [isLoadingMasters, setIsLoadingMasters] = useState(false);

  const products = productsData?.items ?? [];
  const totalProducts = productsData?.total ?? 0;
  const pageSize = productsData?.limit ?? 20;
  const mappingTarget = useMemo(
    () => products.find((item) => item.id === mappingTargetId) ?? null,
    [mappingTargetId, products],
  );

  async function loadSummary(enterpriseId: string) {
    const response = await fetch(
      `/api/integrations/iiko/catalog-summary?enterpriseId=${encodeURIComponent(enterpriseId)}`,
      {
        method: "GET",
        cache: "no-store",
      },
    );
    const data = (await response.json().catch(() => null)) as CatalogSummaryResponse | null;

    setSummary(data ?? { ok: false, message: "Сервер вернул пустой ответ." });
  }

  async function loadProducts(enterpriseId: string, offset = 0) {
    setIsLoadingProducts(true);
    setProductsError(null);

    try {
      const params = new URLSearchParams({
        enterpriseId,
        status: productStatus,
        type: productType,
        limit: "20",
        offset: String(offset),
      });

      if (productQuery.trim()) {
        params.set("q", productQuery.trim());
      }

      const response = await fetch(`/api/integrations/iiko/products?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });
      const data = (await response.json().catch(() => null)) as IikoProductListResponse | null;

      if (!data) {
        setProductsError("Сервер вернул пустой ответ.");
        return;
      }

      if (!response.ok || !data.ok) {
        setProductsError(data.details || data.message || "Не удалось загрузить список товаров iiko.");
        return;
      }

      setProductsData(data);
    } catch {
      setProductsError("Не удалось загрузить список товаров iiko.");
    } finally {
      setIsLoadingProducts(false);
    }
  }

  async function loadProductMasters(enterpriseId: string, search: string) {
    setIsLoadingMasters(true);

    try {
      const params = new URLSearchParams({
        enterpriseId,
        search,
      });
      const response = await fetch(`/api/catalog/product-masters?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });
      const data = (await response.json().catch(() => [])) as ProductMasterSearchItem[];

      if (!response.ok) {
        setMasterItems([]);
        return;
      }

      setMasterItems(data.slice(0, 20));
    } finally {
      setIsLoadingMasters(false);
    }
  }

  useEffect(() => {
    if (!activeEnterpriseId) {
      setSummary(null);
      setProductsData(null);
      setMappingTargetId(null);
      return;
    }

    void loadSummary(activeEnterpriseId);
    void loadProducts(activeEnterpriseId, 0);
  }, [activeEnterpriseId, productQuery, productStatus, productType]);

  useEffect(() => {
    if (!activeEnterpriseId || !mappingTarget) {
      setMasterItems([]);
      return;
    }

    void loadProductMasters(activeEnterpriseId, masterSearch.trim());
  }, [activeEnterpriseId, mappingTarget, masterSearch]);

  async function handleTestConnection() {
    setIsTesting(true);

    try {
      const response = await fetch("/api/integrations/iiko/test-connection", {
        method: "GET",
        cache: "no-store",
      });

      const data = (await response.json().catch(() => null)) as TestConnectionResponse | null;

      if (!data) {
        setResult({
          ok: false,
          message: "Ошибка подключения к iiko",
          details: "Сервер вернул пустой ответ.",
        });
        return;
      }

      setResult(data);
    } catch {
      setResult({
        ok: false,
        message: "Ошибка подключения к iiko",
        details: "Не удалось достучаться до серверного API.",
      });
    } finally {
      setIsTesting(false);
    }
  }

  async function handleSyncCatalog() {
    if (!activeEnterpriseId) {
      setSyncResult({
        ok: false,
        message: "Сначала выберите предприятие.",
      });
      return;
    }

    setIsSyncing(true);
    setSyncResult(null);

    try {
      const response = await fetch("/api/integrations/iiko/sync-catalog", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enterpriseId: activeEnterpriseId }),
      });
      const data = (await response.json().catch(() => null)) as SyncCatalogResponse | null;

      if (!data) {
        setSyncResult({
          ok: false,
          message: "Сервер вернул пустой ответ.",
        });
        return;
      }

      setSyncResult(data);

      if (data.ok) {
        await loadSummary(activeEnterpriseId);
        await loadProducts(activeEnterpriseId, productOffset);
      }
    } catch {
      setSyncResult({
        ok: false,
        message: "Не удалось запустить синхронизацию каталога iiko.",
      });
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleMap(productMasterId: string) {
    if (!activeEnterpriseId || !mappingTarget) {
      return;
    }

    setIsMapping(true);
    setMappingError(null);
    setMappingSuccess(null);

    try {
      const response = await fetch("/api/integrations/iiko/products/map", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enterpriseId: activeEnterpriseId,
          iikoProductId: mappingTarget.id,
          productMasterId,
        }),
      });
      const data = (await response.json().catch(() => null)) as MapResponse | null;

      if (!response.ok || !data?.ok) {
        setMappingError(data?.message || "Не удалось связать товар iiko.");
        return;
      }

      setMappingSuccess("Связь сохранена.");
      setMappingTargetId(null);
      setMasterSearch("");
      await loadProducts(activeEnterpriseId, productOffset);
    } catch {
      setMappingError("Не удалось связать товар iiko.");
    } finally {
      setIsMapping(false);
    }
  }

  async function handleUnmap(iikoProductId: string) {
    if (!activeEnterpriseId) {
      return;
    }

    setIsMapping(true);
    setMappingError(null);
    setMappingSuccess(null);

    try {
      const response = await fetch("/api/integrations/iiko/products/unmap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enterpriseId: activeEnterpriseId,
          iikoProductId,
        }),
      });
      const data = (await response.json().catch(() => null)) as MapResponse | null;

      if (!response.ok || !data?.ok) {
        setMappingError(data?.message || "Не удалось отвязать товар iiko.");
        return;
      }

      setMappingSuccess("Связь удалена.");
      setMappingTargetId(null);
      await loadProducts(activeEnterpriseId, productOffset);
    } catch {
      setMappingError("Не удалось отвязать товар iiko.");
    } finally {
      setIsMapping(false);
    }
  }

  const statusText = isTesting
    ? "Проверяю..."
    : result
      ? result.ok
        ? "Подключено"
        : "Ошибка"
      : "Не проверено";

  return (
    <section className="card settingsComparisonCard">
      <div className="cardHeader">
        <div>
          <p className="panelEyebrow">Интеграции</p>
          <h2 className="sectionTitle">Интеграция iiko</h2>
          <p className="panelText">Проверка идёт только на сервере. Пароль в UI не показывается.</p>
        </div>
        <span className="statusPill">{statusText}</span>
      </div>

      <div className="formGrid">
        <label className="field">
          <span>Сервер</span>
          <input value={result?.serverUrl || serverUrl || "Не настроен"} readOnly />
        </label>
      </div>

      <div className="settingsComparisonActions">
        <button className="primaryButton" type="button" onClick={() => void handleTestConnection()} disabled={isTesting}>
          {isTesting ? "Проверяю..." : "Проверить подключение"}
        </button>
        <button
          className="secondaryButton"
          type="button"
          onClick={() => void handleSyncCatalog()}
          disabled={isSyncing || !activeEnterpriseId}
        >
          {isSyncing ? "Синхронизирую..." : "Синхронизировать каталог iiko"}
        </button>
      </div>

      {result ? (
        result.ok ? (
          <p className="panelText">{result.message}</p>
        ) : (
          <p className="errorText">{result.details || result.message}</p>
        )
      ) : null}

      <div className="placeholderBox">
        <p className="placeholderTitle">Каталог iiko</p>
        <p className="placeholderText">Складов: {summary?.storesCount ?? 0}</p>
        <p className="placeholderText">Товаров всего: {summary?.productsCount ?? 0}</p>
        <p className="placeholderText">Товаров GOODS: {summary?.goodsCount ?? 0}</p>
        <p className="placeholderText">Последнее обновление: {formatDateTime(summary?.lastSyncedAt)}</p>
        <p className="placeholderText">Остатки пока не подключены: endpoint не подтверждён.</p>
      </div>

      {summary && !summary.ok ? (
        <p className="errorText">{summary.details || summary.message || "Не удалось получить сводку каталога iiko."}</p>
      ) : null}

      {syncResult ? (
        syncResult.ok ? (
          <div className="placeholderBox">
            <p className="placeholderTitle">Результат синхронизации</p>
            <p className="placeholderText">Складов получено: {syncResult.storesReceived ?? 0}</p>
            <p className="placeholderText">Складов новых: {syncResult.storesCreated ?? 0}</p>
            <p className="placeholderText">Складов обновлено: {syncResult.storesUpdated ?? 0}</p>
            <p className="placeholderText">Товаров получено: {syncResult.productsReceived ?? 0}</p>
            <p className="placeholderText">Товаров новых: {syncResult.productsCreated ?? 0}</p>
            <p className="placeholderText">Товаров обновлено: {syncResult.productsUpdated ?? 0}</p>
            <p className="placeholderText">GOODS: {syncResult.goodsCount ?? 0}</p>
            {syncResult.errors?.length ? <p className="errorText">{syncResult.errors.join(" ")}</p> : null}
          </div>
        ) : (
          <p className="errorText">{syncResult.details || syncResult.message || "Ошибка синхронизации."}</p>
        )
      ) : null}

      <div className="placeholderBox">
        <p className="placeholderTitle">Сопоставление товаров iiko</p>
        <div className="formGrid">
          <label className="field">
            <span>Поиск по товарам iiko</span>
            <input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Название или код" />
          </label>
          <label className="field">
            <span>Тип</span>
            <select value={productType} onChange={(event) => setProductType(event.target.value)}>
              <option value="GOODS">GOODS</option>
              <option value="PREPARED">PREPARED</option>
              <option value="DISH">DISH</option>
              <option value="MODIFIER">MODIFIER</option>
              <option value="SERVICE">SERVICE</option>
            </select>
          </label>
          <label className="field">
            <span>Статус</span>
            <select
              value={productStatus}
              onChange={(event) => setProductStatus(event.target.value as "all" | "mapped" | "unmapped")}
            >
              <option value="all">Все</option>
              <option value="mapped">Связанные</option>
              <option value="unmapped">Не связанные</option>
            </select>
          </label>
        </div>

        <div className="settingsComparisonActions">
          <button
            className="secondaryButton compactButton"
            type="button"
            disabled={!activeEnterpriseId || isLoadingProducts || productOffset <= 0}
            onClick={() => {
              const nextOffset = Math.max(productOffset - pageSize, 0);
              setProductOffset(nextOffset);
              if (activeEnterpriseId) {
                void loadProducts(activeEnterpriseId, nextOffset);
              }
            }}
          >
            Назад
          </button>
          <button
            className="secondaryButton compactButton"
            type="button"
            disabled={!activeEnterpriseId || isLoadingProducts || productOffset + pageSize >= totalProducts}
            onClick={() => {
              const nextOffset = productOffset + pageSize;
              setProductOffset(nextOffset);
              if (activeEnterpriseId) {
                void loadProducts(activeEnterpriseId, nextOffset);
              }
            }}
          >
            Вперёд
          </button>
          <span className="panelText">
            {totalProducts === 0 ? "0" : `${productOffset + 1}-${Math.min(productOffset + pageSize, totalProducts)} из ${totalProducts}`}
          </span>
        </div>

        {productsError ? <p className="errorText">{productsError}</p> : null}
        {mappingError ? <p className="errorText">{mappingError}</p> : null}
        {mappingSuccess ? <p className="panelText">{mappingSuccess}</p> : null}
        {isLoadingProducts ? <p className="panelText">Загружаю товары iiko...</p> : null}

        {products.map((item) => (
          <div key={item.id} className="placeholderBox">
            <p className="placeholderTitle">{item.name || "Без названия"}</p>
            <p className="placeholderText">Код: {item.code || "—"}</p>
            <p className="placeholderText">Тип: {item.type || "—"}</p>
            <p className="placeholderText">Единица: {item.mainUnit || "—"}</p>
            <p className="placeholderText">Статус: {item.mapped ? "Связан" : "Не связан"}</p>
            <p className="placeholderText">ProductMaster: {formatMaster(item.productMaster)}</p>
            <div className="settingsComparisonActions">
              <button
                className="secondaryButton compactButton"
                type="button"
                onClick={() => {
                  setMappingTargetId(item.id);
                  setMasterSearch(item.name || "");
                  setMappingError(null);
                  setMappingSuccess(null);
                }}
              >
                Связать
              </button>
              <button
                className="secondaryButton compactButton"
                type="button"
                disabled={!item.mapped || isMapping}
                onClick={() => void handleUnmap(item.id)}
              >
                Отвязать
              </button>
            </div>
          </div>
        ))}

        {!isLoadingProducts && products.length === 0 ? <p className="panelText">Товары iiko по текущему фильтру не найдены.</p> : null}
      </div>

      {mappingTarget ? (
        <div className="placeholderBox">
          <p className="placeholderTitle">Связать с ProductMaster</p>
          <p className="placeholderText">Товар iiko: {mappingTarget.name || "Без названия"}</p>
          <label className="field">
            <span>Поиск ProductMaster</span>
            <input value={masterSearch} onChange={(event) => setMasterSearch(event.target.value)} placeholder="Название, бренд, категория" />
          </label>
          {isLoadingMasters ? <p className="panelText">Ищу ProductMaster...</p> : null}
          {masterItems.map((master) => (
            <div key={master.id} className="placeholderBox">
              <p className="placeholderTitle">{formatMaster(master)}</p>
              <p className="placeholderText">Категория: {master.category || "—"}</p>
              <button
                className="primaryButton compactButton"
                type="button"
                disabled={isMapping}
                onClick={() => void handleMap(master.id)}
              >
                Выбрать и связать
              </button>
            </div>
          ))}
          {!isLoadingMasters && masterItems.length === 0 ? <p className="panelText">ProductMaster по текущему поиску не найден.</p> : null}
        </div>
      ) : null}
    </section>
  );
}
