"use client";

import { useEffect, useState } from "react";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";
import type { Supplier } from "@/features/suppliers/types";

function formatArchiveDate(value: string | null) {
  if (!value) {
    return "Дата не указана";
  }

  return new Date(value).toLocaleString("ru-RU");
}

export function SuppliersArchivePage() {
  const { activeEnterprise, activeEnterpriseId } = useEnterprise();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [pendingSupplierId, setPendingSupplierId] = useState<string | null>(null);

  useEffect(() => {
    setSuppliers([]);
    setErrorMessage("");
    setSuccessMessage("");

    if (!activeEnterpriseId) {
      return;
    }

    void loadArchivedSuppliers(activeEnterpriseId);
  }, [activeEnterpriseId]);

  async function loadArchivedSuppliers(enterpriseId: string) {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const response = await fetch(
        `/api/suppliers?enterpriseId=${encodeURIComponent(enterpriseId)}&archived=only`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        throw new Error("Не удалось получить архив поставщиков.");
      }

      const data = (await response.json()) as Supplier[];
      setSuppliers(data);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Ошибка загрузки архива поставщиков.");
    } finally {
      setIsLoading(false);
    }
  }

  async function restoreSupplier(supplier: Supplier) {
    if (!activeEnterpriseId) {
      return;
    }

    const confirmed = window.confirm(
      `Восстановить поставщика «${supplier.name}» из архива? Он снова появится в активной работе вместе с товарами и документами.`,
    );

    if (!confirmed) {
      return;
    }

    setPendingSupplierId(supplier.id);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await fetch(`/api/suppliers/${supplier.id}/restore`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enterpriseId: activeEnterpriseId }),
      });

      const responseBody = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(responseBody?.message ?? "Не удалось восстановить поставщика.");
      }

      setSuppliers((current) => current.filter((item) => item.id !== supplier.id));
      setSuccessMessage(`Поставщик «${supplier.name}» восстановлен из архива.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Ошибка восстановления поставщика.");
    } finally {
      setPendingSupplierId(null);
    }
  }

  return (
    <div className="pageStack">
      <section className="heroCard">
        <p className="panelEyebrow">Архив</p>
        <h2 className="pageTitle">Архив поставщиков</h2>
        <p className="pageDescription">
          Здесь лежат поставщики, которых убрали из активной работы. Восстановление возвращает их обратно в обычный
          список вместе с товарами и документами.
        </p>
      </section>

      {!activeEnterpriseId ? (
        <section className="card pagePlaceholder">
          <p className="panelEyebrow">Архив</p>
          <h2 className="pageTitle">Сначала выберите предприятие</h2>
          <p className="pageDescription">
            Чтобы открыть архив поставщиков, выберите активное предприятие в верхней панели.
          </p>
        </section>
      ) : (
        <section className="card">
          <div className="cardHeader">
            <div>
              <p className="panelEyebrow">Активное предприятие</p>
              <h2 className="sectionTitle">{activeEnterprise?.name ?? "Предприятие"}</h2>
              <p className="panelText">Архивные поставщики скрыты из активного интерфейса, но данные не удалены.</p>
            </div>
          </div>

          {errorMessage ? <p className="errorText">{errorMessage}</p> : null}
          {successMessage ? <p className="successText">{successMessage}</p> : null}

          <div className="archiveList">
            {isLoading ? (
              <div className="emptyState">
                <p className="emptyStateTitle">Загрузка архива</p>
                <p className="emptyStateText">Список архивных поставщиков загружается.</p>
              </div>
            ) : suppliers.length === 0 ? (
              <div className="emptyState">
                <p className="emptyStateTitle">Архив пуст</p>
                <p className="emptyStateText">Для выбранного предприятия пока нет архивных поставщиков.</p>
              </div>
            ) : (
              suppliers.map((supplier) => (
                <article key={supplier.id} className="archiveCard">
                  <div className="archiveCardMain">
                    <div>
                      <h3>{supplier.name}</h3>
                      <p>{supplier.phone || supplier.email || "Контакты не указаны"}</p>
                    </div>
                    <div className="archiveCardMeta">
                      <span>Архивирован</span>
                      <strong>{formatArchiveDate(supplier.archivedAt)}</strong>
                    </div>
                  </div>

                  <div className="archiveCardActions">
                    <button
                      type="button"
                      className="secondaryButton compactButton"
                      disabled={pendingSupplierId === supplier.id}
                      onClick={() => void restoreSupplier(supplier)}
                    >
                      {pendingSupplierId === supplier.id ? "Восстанавливаем..." : "Восстановить"}
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
}
