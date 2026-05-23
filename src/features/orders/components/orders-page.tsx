"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";
import type { OrderItem, OrderItemSourceType, OrderListItem, OrderStatus } from "@/features/orders/types";

const statusTabs: Array<{ status: OrderStatus; label: string; empty: string }> = [
  { status: "draft", label: "Черновики", empty: "Черновиков пока нет." },
  { status: "submitted", label: "Отправленные", empty: "Отправленных заказов пока нет." },
  { status: "cancelled", label: "Отменённые", empty: "Отменённых заказов пока нет." },
];

const statusLabels: Record<OrderStatus, string> = {
  draft: "Черновик",
  submitted: "Отправлен",
  cancelled: "Отменён",
};

const sourceLabels: Record<OrderItemSourceType, string> = {
  legacy: "legacy",
  catalog: "catalog",
};

function formatMoney(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return String(value);
  }

  return `${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numberValue)} ₽`;
}

function formatQuantity(value: string | number | null | undefined, unit?: string | null) {
  if (value === null || value === undefined || value === "") {
    return unit || "—";
  }

  const numberValue = Number(value);
  const formatted = Number.isFinite(numberValue)
    ? new Intl.NumberFormat("ru-RU", {
        minimumFractionDigits: numberValue % 1 === 0 ? 0 : 2,
        maximumFractionDigits: 3,
      }).format(numberValue)
    : String(value);

  return unit ? `${formatted} ${unit}` : formatted;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getOrderTitle(order: OrderListItem) {
  return `${order.supplier.name} · ${formatDate(order.updatedAt)}`;
}

function isCatalogItem(item: OrderItem) {
  return item.sourceType === "catalog";
}

function getItemDisplayName(item: OrderItem) {
  if (item.displayName?.trim()) {
    return item.displayName;
  }

  return item.product?.name ?? item.supplierOffer?.name ?? "Товар удалён из текущего прайса";
}

function getItemMeta(item: OrderItem) {
  if (isCatalogItem(item)) {
    const supplierOfferName =
      item.supplierOffer?.name && item.supplierOffer.name !== getItemDisplayName(item) ? item.supplierOffer.name : null;

    return [supplierOfferName, item.article, item.brand].filter(Boolean).join(" • ");
  }

  return [item.product?.article, item.product?.brand].filter(Boolean).join(" • ");
}

async function writeTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  document.body.appendChild(textArea);
  textArea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("copy command failed");
    }
  } finally {
    document.body.removeChild(textArea);
  }
}

export function OrdersPage() {
  const { activeEnterprise, activeEnterpriseId } = useEnterprise();
  const [activeStatus, setActiveStatus] = useState<OrderStatus>("draft");
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<OrderStatus | null>(null);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [pendingDeleteItemId, setPendingDeleteItemId] = useState<string | null>(null);
  const [draftQuantities, setDraftQuantities] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const ordersRequestIdRef = useRef(0);

  const selectedOrder = useMemo(() => {
    return orders.find((order) => order.id === selectedOrderId) ?? orders[0] ?? null;
  }, [orders, selectedOrderId]);

  useEffect(() => {
    if (!selectedOrder) {
      setDraftQuantities({});
      return;
    }

    setDraftQuantities(
      Object.fromEntries(selectedOrder.items.map((item) => [item.id, String(item.quantity)])),
    );
  }, [selectedOrder]);

  const mergeUpdatedOrder = useCallback((updatedOrder: OrderListItem) => {
    setOrders((currentOrders) =>
      currentOrders.map((order) => (order.id === updatedOrder.id ? updatedOrder : order)),
    );
    setSelectedOrderId(updatedOrder.id);
  }, []);

  const loadOrders = useCallback(async (enterpriseId: string, status: OrderStatus, preferredOrderId?: string) => {
    const requestId = ordersRequestIdRef.current + 1;
    ordersRequestIdRef.current = requestId;
    setIsLoading(true);
    setOrders([]);
    setSelectedOrderId(null);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const params = new URLSearchParams({
        enterpriseId,
        status,
      });

      const response = await fetch(`/api/orders?${params.toString()}`, { cache: "no-store" });

      if (!response.ok) {
        const responseBody = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(responseBody?.message ?? "Не удалось загрузить заказы.");
      }

      const data = (await response.json()) as OrderListItem[];

      if (ordersRequestIdRef.current !== requestId) {
        return;
      }

      setOrders(data);

      const nextSelectedOrder =
        (preferredOrderId && data.find((order) => order.id === preferredOrderId)) || data[0] || null;

      setSelectedOrderId(nextSelectedOrder?.id ?? null);
    } catch (error) {
      if (ordersRequestIdRef.current !== requestId) {
        return;
      }

      setOrders([]);
      setSelectedOrderId(null);
      setErrorMessage(error instanceof Error ? error.message : "Ошибка загрузки заказов.");
    } finally {
      if (ordersRequestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!activeEnterpriseId) {
      setOrders([]);
      setSelectedOrderId(null);
      return;
    }

    void loadOrders(activeEnterpriseId, activeStatus);
  }, [activeEnterpriseId, activeStatus, loadOrders]);

  async function updateOrderStatus(order: OrderListItem, status: "submitted" | "cancelled") {
    if (!activeEnterpriseId) {
      return;
    }

    const confirmText =
      status === "submitted"
        ? `Отправить заказ поставщику «${order.supplier.name}»? После отправки он будет доступен только для просмотра.`
        : `Отменить заказ поставщику «${order.supplier.name}»? После отмены он будет доступен только для просмотра.`;

    if (!window.confirm(confirmText)) {
      return;
    }

    setPendingStatus(status);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const params = new URLSearchParams({
        enterpriseId: activeEnterpriseId,
      });

      const response = await fetch(`/api/orders/${order.id}?${params.toString()}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
      });

      const responseBody = (await response.json().catch(() => null)) as OrderListItem | { message?: string } | null;

      if (!response.ok) {
        throw new Error(
          responseBody && "message" in responseBody
            ? responseBody.message || "Не удалось изменить статус заказа."
            : "Не удалось изменить статус заказа.",
        );
      }

      setSuccessMessage(status === "submitted" ? "Заказ отправлен." : "Заказ отменён.");
      await loadOrders(activeEnterpriseId, activeStatus);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Ошибка изменения статуса заказа.");
    } finally {
      setPendingStatus(null);
    }
  }

  async function saveItemQuantity(item: OrderItem) {
    if (!activeEnterpriseId || !selectedOrder) {
      return;
    }

    setPendingItemId(item.id);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const quantity = draftQuantities[item.id] ?? String(item.quantity);
      const response = await fetch(`/api/orders/${selectedOrder.id}/items/${item.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enterpriseId: activeEnterpriseId,
          quantity,
        }),
      });

      const responseBody = (await response.json().catch(() => null)) as OrderListItem | { message?: string } | null;

      if (!response.ok) {
        throw new Error(
          responseBody && "message" in responseBody
            ? responseBody.message || "Не удалось обновить количество."
            : "Не удалось обновить количество.",
        );
      }

      mergeUpdatedOrder(responseBody as OrderListItem);
      setSuccessMessage("Количество обновлено.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Ошибка обновления количества.");
    } finally {
      setPendingItemId(null);
    }
  }

  async function deleteItem(item: OrderItem) {
    if (!activeEnterpriseId || !selectedOrder) {
      return;
    }

    if (!window.confirm(`Удалить позицию «${getItemDisplayName(item)}» из черновика?`)) {
      return;
    }

    setPendingDeleteItemId(item.id);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const params = new URLSearchParams({
        enterpriseId: activeEnterpriseId,
      });

      const response = await fetch(`/api/orders/${selectedOrder.id}/items/${item.id}?${params.toString()}`, {
        method: "DELETE",
      });

      const responseBody = (await response.json().catch(() => null)) as OrderListItem | { message?: string } | null;

      if (!response.ok) {
        throw new Error(
          responseBody && "message" in responseBody
            ? responseBody.message || "Не удалось удалить позицию."
            : "Не удалось удалить позицию.",
        );
      }

      mergeUpdatedOrder(responseBody as OrderListItem);
      setSuccessMessage("Позиция удалена.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Ошибка удаления позиции.");
    } finally {
      setPendingDeleteItemId(null);
    }
  }

  async function copyOrder(order: OrderListItem, mode: "simple" | "extended") {
    setCopyMessage("");
    setErrorMessage("");

    const lines = order.items.map((item) => {
      const productName = getItemDisplayName(item);
      const quantity = formatQuantity(item.quantity, item.unit);

      if (mode === "simple") {
        return `${productName} — ${quantity}`;
      }

      return `${productName} — ${quantity} — ${formatMoney(item.price)} — ${formatMoney(item.lineTotal)}`;
    });

    const text =
      mode === "simple"
        ? lines.join("\n")
        : [`Поставщик: ${order.supplier.name}`, "", ...lines, "", `Итого: ${formatMoney(order.total)}`].join("\n");

    try {
      await writeTextToClipboard(text);
      setCopyMessage(mode === "simple" ? "Заказ скопирован." : "Расширенный заказ скопирован.");
    } catch {
      setErrorMessage("Не удалось скопировать заказ в буфер обмена.");
    }
  }

  return (
    <div className="pageStack">
      <section className="heroCard">
        <p className="panelEyebrow">Заказы</p>
        <h2 className="pageTitle">Мои заказы</h2>
        <p className="pageDescription">
          Здесь можно смотреть черновики, отправленные и отменённые заказы, открывать состав заказа и менять статус черновика.
        </p>
      </section>

      {!activeEnterpriseId ? (
        <section className="card pagePlaceholder">
          <p className="panelEyebrow">Заказы</p>
          <h2 className="pageTitle">Сначала выберите предприятие</h2>
          <p className="pageDescription">
            Чтобы открыть заказы, выберите активное предприятие в верхней панели.
          </p>
        </section>
      ) : (
        <section className="ordersWorkspace">
          <div className="card ordersListCard">
            <div className="cardHeader">
              <div>
                <p className="panelEyebrow">Активное предприятие</p>
                <h2 className="sectionTitle">{activeEnterprise?.name ?? "Предприятие"}</h2>
              </div>
            </div>

            <div className="ordersStatusTabs" role="tablist" aria-label="Статусы заказов">
              {statusTabs.map((tab) => (
                <button
                  key={tab.status}
                  type="button"
                  className={`ordersStatusTab ${activeStatus === tab.status ? "ordersStatusTabActive" : ""}`}
                  onClick={() => setActiveStatus(tab.status)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {errorMessage ? <p className="errorText">{errorMessage}</p> : null}
            {successMessage ? <p className="successText">{successMessage}</p> : null}

            <div className="ordersList">
              {isLoading ? (
                <div className="emptyState">
                  <p className="emptyStateTitle">Загрузка заказов</p>
                  <p className="emptyStateText">Список заказов загружается.</p>
                </div>
              ) : orders.length === 0 ? (
                <div className="emptyState">
                  <p className="emptyStateTitle">{statusTabs.find((tab) => tab.status === activeStatus)?.empty}</p>
                  <p className="emptyStateText">Добавлять товары в черновик сейчас можно на странице «Товары».</p>
                </div>
              ) : (
                orders.map((order) => {
                  const isActive = order.id === selectedOrder?.id;

                  return (
                    <article key={order.id} className={`orderListCard ${isActive ? "orderListCardActive" : ""}`}>
                      <button type="button" className="orderListButton" onClick={() => setSelectedOrderId(order.id)}>
                        <div>
                          <h3>{order.supplier.name}</h3>
                          <p>Обновлён: {formatDate(order.updatedAt)}</p>
                        </div>
                        <span className={`statusPill orderStatusPill orderStatus-${order.status}`}>
                          {statusLabels[order.status]}
                        </span>
                      </button>

                      <div className="orderListMeta">
                        <span>{order.itemsCount} поз.</span>
                        <strong>{formatMoney(order.total)}</strong>
                        <button
                          type="button"
                          className="secondaryButton compactButton"
                          onClick={() => setSelectedOrderId(order.id)}
                        >
                          Открыть
                        </button>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>

          <aside className="card orderDetailsCard">
            {!selectedOrder ? (
              <div className="emptyState">
                <p className="emptyStateTitle">Заказ не выбран</p>
                <p className="emptyStateText">Выберите заказ из списка слева.</p>
              </div>
            ) : (
              <>
                <div className="orderDetailsHeader">
                  <div>
                    <p className="panelEyebrow">Заказ</p>
                    <h2 className="sectionTitle">{selectedOrder.supplier.name}</h2>
                    <p className="panelText">{getOrderTitle(selectedOrder)}</p>
                  </div>
                  <span className={`statusPill orderStatusPill orderStatus-${selectedOrder.status}`}>
                    {statusLabels[selectedOrder.status]}
                  </span>
                </div>

                <div className="orderDetailsMeta">
                  <div className="supplierMetaItem">
                    <span>Создан</span>
                    <strong>{formatDate(selectedOrder.createdAt)}</strong>
                  </div>
                  <div className="supplierMetaItem">
                    <span>Обновлён</span>
                    <strong>{formatDate(selectedOrder.updatedAt)}</strong>
                  </div>
                  {selectedOrder.submittedAt ? (
                    <div className="supplierMetaItem">
                      <span>Отправлен</span>
                      <strong>{formatDate(selectedOrder.submittedAt)}</strong>
                    </div>
                  ) : null}
                  {selectedOrder.cancelledAt ? (
                    <div className="supplierMetaItem">
                      <span>Отменён</span>
                      <strong>{formatDate(selectedOrder.cancelledAt)}</strong>
                    </div>
                  ) : null}
                  <div className="supplierMetaItem">
                    <span>Позиций</span>
                    <strong>{selectedOrder.itemsCount}</strong>
                  </div>
                </div>

                {selectedOrder.comment ? (
                  <div className="orderCommentBox">
                    <span>Комментарий</span>
                    <p>{selectedOrder.comment}</p>
                  </div>
                ) : null}

                {selectedOrder.status === "draft" ? (
                  <div className="orderDetailsActions">
                    <button
                      type="button"
                      className="primaryButton compactButton"
                      disabled={pendingStatus !== null}
                      onClick={() => void updateOrderStatus(selectedOrder, "submitted")}
                    >
                      {pendingStatus === "submitted" ? "Отправляем..." : "Отправить"}
                    </button>
                    <button
                      type="button"
                      className="secondaryButton compactButton archiveButton"
                      disabled={pendingStatus !== null}
                      onClick={() => void updateOrderStatus(selectedOrder, "cancelled")}
                    >
                      {pendingStatus === "cancelled" ? "Отменяем..." : "Отменить"}
                    </button>
                  </div>
                ) : (
                  <p className="panelText">Этот заказ доступен только для просмотра.</p>
                )}

                <div className="orderCopyActions">
                  <button
                    type="button"
                    className="secondaryButton compactButton"
                    onClick={() => void copyOrder(selectedOrder, "simple")}
                    disabled={selectedOrder.items.length === 0}
                  >
                    Скопировать
                  </button>
                  <button
                    type="button"
                    className="secondaryButton compactButton"
                    onClick={() => void copyOrder(selectedOrder, "extended")}
                    disabled={selectedOrder.items.length === 0}
                  >
                    Скопировать расширенный
                  </button>
                  {copyMessage ? <span className="copyFeedback">{copyMessage}</span> : null}
                </div>

                <div className="orderItemsTableWrap">
                  <table className="orderItemsTable">
                    <thead>
                      <tr>
                        <th>Товар</th>
                        <th>Количество</th>
                        <th>Цена</th>
                        <th>Сумма</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOrder.items.length === 0 ? (
                        <tr>
                          <td colSpan={4}>В заказе пока нет позиций.</td>
                        </tr>
                      ) : (
                        selectedOrder.items.map((item) => {
                          const metaLine = getItemMeta(item);
                          const isDraft = selectedOrder.status === "draft";
                          const isSaving = pendingItemId === item.id;
                          const isDeleting = pendingDeleteItemId === item.id;

                          return (
                            <tr key={item.id}>
                              <td>
                                <strong>{getItemDisplayName(item)}</strong>
                                <span className="orderItemSourceRow">
                                  <span className="orderItemSourceBadge">{sourceLabels[item.sourceType]}</span>
                                  {item.supplierName ? <span>{item.supplierName}</span> : null}
                                </span>
                                {metaLine ? <span>{metaLine}</span> : null}
                              </td>
                              <td>
                                {isDraft ? (
                                  <div className="orderItemQuantityEditor">
                                    <input
                                      type="number"
                                      inputMode="decimal"
                                      min="0.001"
                                      step="0.001"
                                      className="orderItemQuantityInput"
                                      value={draftQuantities[item.id] ?? String(item.quantity)}
                                      onChange={(event) =>
                                        setDraftQuantities((current) => ({
                                          ...current,
                                          [item.id]: event.target.value,
                                        }))
                                      }
                                    />
                                    <span>{item.unit ?? "ед."}</span>
                                    <div className="orderItemActions">
                                      <button
                                        type="button"
                                        className="secondaryButton compactButton"
                                        disabled={isSaving || isDeleting}
                                        onClick={() => void saveItemQuantity(item)}
                                      >
                                        {isSaving ? "Сохраняем..." : "Сохранить"}
                                      </button>
                                      <button
                                        type="button"
                                        className="dangerButton compactButton"
                                        disabled={isSaving || isDeleting}
                                        onClick={() => void deleteItem(item)}
                                      >
                                        {isDeleting ? "Удаляем..." : "Удалить"}
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  formatQuantity(item.quantity, item.unit)
                                )}
                              </td>
                              <td>{formatMoney(item.price)}</td>
                              <td>{formatMoney(item.lineTotal)}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="orderDetailsSummary">
                  <div>
                    <span>Всего позиций</span>
                    <strong>{selectedOrder.itemsCount}</strong>
                  </div>
                  <div>
                    <span>Итого</span>
                    <strong>{formatMoney(selectedOrder.total)}</strong>
                  </div>
                </div>
              </>
            )}
          </aside>
        </section>
      )}
    </div>
  );
}
