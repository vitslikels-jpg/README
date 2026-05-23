"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";

type CatalogUnit = {
  id: string;
  code: string;
  name: string;
  symbol: string;
} | null;

type CatalogSnapshot = {
  id: string;
  price: string | null;
  stock: string | null;
  sourceRow: number | null;
  capturedAt: string;
} | null;

type CatalogMappingInfo = {
  id: string;
  productMasterId: string;
  confidence: string | null;
  matchSource: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  productMaster: {
    id: string;
    name: string;
    brand: string | null;
    category: string | null;
    unit: CatalogUnit;
  };
};

type CatalogOfferBase = {
  id: string;
  supplierId: string;
  name: string;
  normalizedName: string;
  article: string | null;
  brand: string | null;
  legacyUnit: string | null;
  supplier: {
    id: string;
    name: string;
    archivedAt: string | null;
  };
  unit: CatalogUnit;
  currentPriceSnapshot: CatalogSnapshot;
  lastSeenAt: string | null;
  mappingStatus: "mapped" | "unmapped";
};

type UnmappedOffer = CatalogOfferBase & {
  activeMapping: null;
};

type MappedOffer = CatalogOfferBase & {
  activeMapping: CatalogMappingInfo | null;
  mappings: CatalogMappingInfo[];
};

type ProductMaster = {
  id: string;
  name: string;
  normalizedName: string;
  brand: string | null;
  category: string | null;
  offersCount: number;
  minCurrentPrice: string | null;
  maxCurrentPrice: string | null;
  unit: CatalogUnit;
};

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

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function matchesMaster(master: ProductMaster, search: string) {
  const normalized = normalizeSearch(search);

  if (!normalized) {
    return true;
  }

  return [master.name, master.brand, master.category, master.unit?.symbol]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalized));
}

export function CatalogMappingPage() {
  const { activeEnterpriseId, activeEnterprise } = useEnterprise();
  const [tab, setTab] = useState<"unmapped" | "mapped">("unmapped");
  const [unmappedOffers, setUnmappedOffers] = useState<UnmappedOffer[]>([]);
  const [mappedOffers, setMappedOffers] = useState<MappedOffer[]>([]);
  const [productMasters, setProductMasters] = useState<ProductMaster[]>([]);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [offerSearch, setOfferSearch] = useState("");
  const [masterSearch, setMasterSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [createName, setCreateName] = useState("");
  const [createBrand, setCreateBrand] = useState("");
  const [createCategory, setCreateCategory] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);

  const visibleOffers = tab === "unmapped" ? unmappedOffers : mappedOffers;

  const selectedOffer = useMemo(
    () => visibleOffers.find((offer) => offer.id === selectedOfferId) ?? null,
    [visibleOffers, selectedOfferId],
  );

  const filteredMasters = useMemo(
    () => productMasters.filter((master) => matchesMaster(master, masterSearch)),
    [productMasters, masterSearch],
  );

  const supplierOptions = useMemo(() => {
    const allOffers = [...unmappedOffers, ...mappedOffers];
    return Array.from(new Map(allOffers.map((offer) => [offer.supplier.id, offer.supplier])).values()).sort((a, b) =>
      a.name.localeCompare(b.name, "ru-RU"),
    );
  }, [mappedOffers, unmappedOffers]);

  const unitOptions = useMemo(() => {
    const allOffers = [...unmappedOffers, ...mappedOffers].filter((offer) => offer.unit);
    return Array.from(new Map(allOffers.map((offer) => [offer.unit!.id, offer.unit!])).values()).sort((a, b) =>
      a.symbol.localeCompare(b.symbol, "ru-RU"),
    );
  }, [mappedOffers, unmappedOffers]);

  const loadData = useCallback(async () => {
    if (!activeEnterpriseId) {
      setUnmappedOffers([]);
      setMappedOffers([]);
      setProductMasters([]);
      setSelectedOfferId(null);
      return;
    }

    setIsLoading(true);
    setErrorText(null);

    try {
      const params = new URLSearchParams({ enterpriseId: activeEnterpriseId });

      if (offerSearch.trim()) {
        params.set("search", offerSearch.trim());
      }

      if (supplierFilter) {
        params.set("supplierId", supplierFilter);
      }

      if (unitFilter) {
        params.set("unitId", unitFilter);
      }

      const masterParams = new URLSearchParams({ enterpriseId: activeEnterpriseId });
      if (masterSearch.trim()) {
        masterParams.set("search", masterSearch.trim());
      }

      const [offersResponse, mappedResponse, mastersResponse] = await Promise.all([
        fetch(`/api/catalog/unmapped-offers?${params.toString()}`, { cache: "no-store" }),
        fetch(`/api/catalog/mapped-offers?${params.toString()}`, { cache: "no-store" }),
        fetch(`/api/catalog/product-masters?${masterParams.toString()}`, { cache: "no-store" }),
      ]);

      if (!offersResponse.ok) {
        const payload = (await offersResponse.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? "Не удалось загрузить unmapped offers.");
      }

      if (!mappedResponse.ok) {
        const payload = (await mappedResponse.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? "Не удалось загрузить mapped offers.");
      }

      if (!mastersResponse.ok) {
        const payload = (await mastersResponse.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? "Не удалось загрузить ProductMaster.");
      }

      const nextUnmapped = (await offersResponse.json()) as UnmappedOffer[];
      const nextMapped = (await mappedResponse.json()) as MappedOffer[];
      const nextMasters = (await mastersResponse.json()) as ProductMaster[];

      setUnmappedOffers(nextUnmapped);
      setMappedOffers(nextMapped);
      setProductMasters(nextMasters);

      const nextVisible = tab === "unmapped" ? nextUnmapped : nextMapped;
      setSelectedOfferId((current) =>
        current && nextVisible.some((offer) => offer.id === current) ? current : nextVisible[0]?.id ?? null,
      );
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Не удалось загрузить catalog mapping.");
    } finally {
      setIsLoading(false);
    }
  }, [activeEnterpriseId, masterSearch, offerSearch, supplierFilter, tab, unitFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const nextVisible = tab === "unmapped" ? unmappedOffers : mappedOffers;
    setSelectedOfferId((current) =>
      current && nextVisible.some((offer) => offer.id === current) ? current : nextVisible[0]?.id ?? null,
    );
  }, [mappedOffers, tab, unmappedOffers]);

  useEffect(() => {
    if (!selectedOffer) {
      setCreateName("");
      setCreateBrand("");
      setCreateCategory("");
      return;
    }

    setMasterSearch(selectedOffer.name);
    setCreateName(selectedOffer.name);
    setCreateBrand(selectedOffer.brand ?? "");
    setCreateCategory("");
  }, [selectedOffer]);

  async function handleMap(productMasterId: string) {
    if (!selectedOffer) {
      return;
    }

    setIsSubmitting(true);
    setErrorText(null);
    setSuccessText(null);

    try {
      const response = await fetch("/api/catalog/mappings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          supplierOfferId: selectedOffer.id,
          productMasterId,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? "Не удалось создать mapping.");
      }

      setSuccessText("Товар связан вручную.");
      setTab("mapped");
      await loadData();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Не удалось создать mapping.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCreateAndMap() {
    if (!selectedOffer || !activeEnterpriseId) {
      return;
    }

    setIsSubmitting(true);
    setErrorText(null);
    setSuccessText(null);

    try {
      const createResponse = await fetch("/api/catalog/product-masters", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enterpriseId: activeEnterpriseId,
          name: createName,
          brand: createBrand || null,
          category: createCategory || null,
          unitId: selectedOffer.unit?.id ?? null,
        }),
      });

      const createPayload = (await createResponse.json().catch(() => null)) as
        | { message?: string; productMaster?: ProductMaster }
        | null;

      if (!createResponse.ok || !createPayload?.productMaster) {
        throw new Error(createPayload?.message ?? "Не удалось создать ProductMaster.");
      }

      const mapResponse = await fetch("/api/catalog/mappings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          supplierOfferId: selectedOffer.id,
          productMasterId: createPayload.productMaster.id,
        }),
      });

      if (!mapResponse.ok) {
        const payload = (await mapResponse.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? "Не удалось связать новый ProductMaster.");
      }

      setSuccessText("Создан новый ProductMaster и сразу связан.");
      setTab("mapped");
      await loadData();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Не удалось создать ProductMaster и mapping.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRevokeManualMapping(mappingId: string) {
    if (!window.confirm("Отменить manual mapping? Если есть старый auto mapping, он вернётся в active.")) {
      return;
    }

    setIsSubmitting(true);
    setErrorText(null);
    setSuccessText(null);

    try {
      const response = await fetch(`/api/catalog/mappings/${mappingId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? "Не удалось отменить manual mapping.");
      }

      setSuccessText("Manual mapping отменён.");
      setTab("unmapped");
      await loadData();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Не удалось отменить manual mapping.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="pageStack">
      <section className="heroCard">
        <p className="panelEyebrow">Catalog</p>
        <h2 className="pageTitle">Ручное сопоставление товаров</h2>
        <p className="pageDescription">
          Здесь можно фильтровать и искать supplier offers, смотреть уже связанные позиции и откатывать manual mapping без
          лома старых данных.
        </p>
      </section>

      <section className="card">
        <div className="cardHeader">
          <div>
            <h3 className="pageTitle">Catalog mapping</h3>
            <p className="pageDescription">Предприятие: {activeEnterprise?.name ?? "не выбрано"}.</p>
          </div>
          <span className="counterBadge">{visibleOffers.length}</span>
        </div>

        {errorText ? <p className="errorText">{errorText}</p> : null}
        {successText ? <p className="successText">{successText}</p> : null}

        {!activeEnterpriseId ? (
          <div className="emptyState">
            <p className="emptyStateTitle">Сначала выберите предприятие</p>
            <p className="emptyStateText">Без active enterprise этот раздел работать не будет.</p>
          </div>
        ) : (
          <>
            <div className="ordersStatusTabs" role="tablist" aria-label="Статусы сопоставления">
              <button
                type="button"
                className={`ordersStatusTab ${tab === "unmapped" ? "ordersStatusTabActive" : ""}`}
                onClick={() => setTab("unmapped")}
              >
                Unmapped
              </button>
              <button
                type="button"
                className={`ordersStatusTab ${tab === "mapped" ? "ordersStatusTabActive" : ""}`}
                onClick={() => setTab("mapped")}
              >
                Mapped
              </button>
            </div>

            <div className="catalogFiltersGrid">
              <label className="field">
                <span>Поиск offers</span>
                <input value={offerSearch} onChange={(event) => setOfferSearch(event.target.value)} />
              </label>
              <label className="field">
                <span>Поиск ProductMaster</span>
                <input value={masterSearch} onChange={(event) => setMasterSearch(event.target.value)} />
              </label>
              <label className="field">
                <span>Поставщик</span>
                <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}>
                  <option value="">Все</option>
                  {supplierOptions.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Unit</span>
                <select value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)}>
                  <option value="">Все</option>
                  {unitOptions.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.symbol} ({unit.code})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="catalogMappingLayout">
              <div className="catalogOffersColumn">
                <div className="catalogColumnHeader">
                  <h3>{tab === "unmapped" ? "Unmapped offers" : "Mapped offers"}</h3>
                  <p>{isLoading ? "Загрузка..." : "Список фильтруется по supplier, unit и поиску."}</p>
                </div>

                {visibleOffers.length === 0 && !isLoading ? (
                  <div className="emptyState">
                    <p className="emptyStateTitle">Пусто</p>
                    <p className="emptyStateText">По текущим фильтрам ничего не найдено.</p>
                  </div>
                ) : (
                  <div className="catalogOffersList">
                    {visibleOffers.map((offer) => {
                      const isActive = selectedOfferId === offer.id;
                      const activeMapping = offer.mappingStatus === "mapped" ? offer.activeMapping : null;

                      return (
                        <button
                          key={offer.id}
                          type="button"
                          className={`catalogOfferCard ${isActive ? "catalogOfferCardActive" : ""}`}
                          onClick={() => setSelectedOfferId(offer.id)}
                        >
                          <div className="catalogOfferCardHeader">
                            <strong>{offer.name}</strong>
                            <span className="statusPill">{offer.supplier.name}</span>
                          </div>
                          <p>
                            {offer.brand || "Без бренда"}
                            {offer.article ? ` • ${offer.article}` : ""}
                            {offer.unit?.symbol ? ` • ${offer.unit.symbol}` : ""}
                          </p>
                          <div className="catalogOfferMeta">
                            <span>Статус: {offer.mappingStatus}</span>
                            <span>Цена: {formatPrice(offer.currentPriceSnapshot?.price ?? null)}</span>
                          </div>
                          {activeMapping ? (
                            <div className="catalogOfferMeta">
                              <span>Источник: {activeMapping.matchSource}</span>
                              <span>Confidence: {activeMapping.confidence ?? "—"}</span>
                            </div>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="catalogPanel">
                {selectedOffer ? (
                  <>
                    <div className="catalogColumnHeader">
                      <h3>Детали offer</h3>
                      <p>Поставщик: {selectedOffer.supplier.name}.</p>
                    </div>

                    <div className="catalogSelectionCard">
                      <div className="catalogSelectionFacts">
                        <div className="compactProductFact">
                          <span className="compactProductFactLabel">Товар поставщика</span>
                          <strong>{selectedOffer.name}</strong>
                        </div>
                        <div className="compactProductFact">
                          <span className="compactProductFactLabel">Артикул / бренд</span>
                          <strong>
                            {selectedOffer.article || "—"} / {selectedOffer.brand || "—"}
                          </strong>
                        </div>
                        <div className="compactProductFact">
                          <span className="compactProductFactLabel">Unit / цена</span>
                          <strong>
                            {selectedOffer.unit?.symbol || selectedOffer.legacyUnit || "—"} /{" "}
                            {formatPrice(selectedOffer.currentPriceSnapshot?.price ?? null)}
                          </strong>
                        </div>
                        <div className="compactProductFact">
                          <span className="compactProductFactLabel">Статус</span>
                          <strong>{selectedOffer.mappingStatus}</strong>
                        </div>
                        <div className="compactProductFact">
                          <span className="compactProductFactLabel">Последний прайс</span>
                          <strong>{formatDate(selectedOffer.lastSeenAt)}</strong>
                        </div>
                      </div>
                    </div>

                    {selectedOffer.mappingStatus === "mapped" && "mappings" in selectedOffer ? (
                      <div className="catalogCreateCard">
                        <div className="catalogColumnHeader">
                          <h3>История mapping</h3>
                          <p>Видно active и superseded связи для выбранного offer.</p>
                        </div>
                        <div className="catalogMastersList">
                          {selectedOffer.mappings.map((mapping) => (
                            <div key={mapping.id} className="catalogMasterCard">
                              <div>
                                <strong>{mapping.productMaster.name}</strong>
                                <p>
                                  {mapping.productMaster.brand || "Без бренда"}
                                  {mapping.productMaster.category ? ` • ${mapping.productMaster.category}` : ""}
                                  {mapping.productMaster.unit?.symbol ? ` • ${mapping.productMaster.unit.symbol}` : ""}
                                </p>
                                <div className="catalogOfferMeta">
                                  <span>status: {mapping.status}</span>
                                  <span>source: {mapping.matchSource}</span>
                                  <span>confidence: {mapping.confidence ?? "—"}</span>
                                </div>
                              </div>
                              {mapping.status === "active" && mapping.matchSource === "manual" ? (
                                <button
                                  type="button"
                                  className="dangerButton compactButton"
                                  disabled={isSubmitting}
                                  onClick={() => void handleRevokeManualMapping(mapping.id)}
                                >
                                  Отменить manual
                                </button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {tab === "unmapped" ? (
                      <>
                        <div className="catalogMastersList">
                          {filteredMasters.map((master) => (
                            <div key={master.id} className="catalogMasterCard">
                              <div>
                                <strong>{master.name}</strong>
                                <p>
                                  {master.brand || "Без бренда"}
                                  {master.category ? ` • ${master.category}` : ""}
                                  {master.unit?.symbol ? ` • ${master.unit.symbol}` : ""}
                                </p>
                                <div className="catalogOfferMeta">
                                  <span>Offers: {master.offersCount}</span>
                                  <span>
                                    Цена: {formatPrice(master.minCurrentPrice)} — {formatPrice(master.maxCurrentPrice)}
                                  </span>
                                </div>
                              </div>
                              <button
                                type="button"
                                className="primaryButton compactButton"
                                disabled={isSubmitting}
                                onClick={() => void handleMap(master.id)}
                              >
                                Связать
                              </button>
                            </div>
                          ))}

                          {filteredMasters.length === 0 ? (
                            <div className="emptyState">
                              <p className="emptyStateTitle">Ничего не найдено</p>
                              <p className="emptyStateText">Либо нет ProductMaster, либо фильтр слишком жёсткий.</p>
                            </div>
                          ) : null}
                        </div>

                        <div className="catalogCreateCard">
                          <div className="catalogColumnHeader">
                            <h3>Создать новый ProductMaster</h3>
                            <p>Минимальная ручная форма без лишней магии.</p>
                          </div>
                          <div className="formGrid">
                            <label className="field">
                              <span>Название</span>
                              <input value={createName} onChange={(event) => setCreateName(event.target.value)} />
                            </label>
                            <label className="field">
                              <span>Бренд</span>
                              <input value={createBrand} onChange={(event) => setCreateBrand(event.target.value)} />
                            </label>
                            <label className="field">
                              <span>Категория</span>
                              <input value={createCategory} onChange={(event) => setCreateCategory(event.target.value)} />
                            </label>
                            <label className="field">
                              <span>Unit</span>
                              <input value={selectedOffer.unit?.symbol || selectedOffer.legacyUnit || ""} disabled />
                            </label>
                          </div>
                          <button
                            type="button"
                            className="primaryButton"
                            disabled={isSubmitting || !createName.trim()}
                            onClick={() => void handleCreateAndMap()}
                          >
                            Создать и связать
                          </button>
                        </div>
                      </>
                    ) : null}
                  </>
                ) : (
                  <div className="emptyState">
                    <p className="emptyStateTitle">Offer не выбран</p>
                    <p className="emptyStateText">
                      Выберите позицию слева, чтобы посмотреть её mapping-статус или связать с master-каталогом.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
