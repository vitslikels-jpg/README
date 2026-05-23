"use client";

import { FormEvent, useState } from "react";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";

const emptyForm = {
  name: "",
  address: "",
  phone: "",
};

export function EnterpriseManager() {
  const { enterprises, activeEnterpriseId, createEnterprise, selectEnterprise, isLoading } =
    useEnterprise();
  const [formState, setFormState] = useState(emptyForm);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    const name = formState.name.trim();
    const address = formState.address.trim();
    const phone = formState.phone.trim();

    if (!name || !address || !phone) {
      setErrorMessage("Заполните название, адрес и телефон.");
      return;
    }

    try {
      await createEnterprise({ name, address, phone });
      setFormState(emptyForm);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Ошибка создания предприятия.");
    }
  }

  return (
    <div className="contentGrid">
      <section className="card">
        <div className="cardHeader">
          <div>
            <p className="panelEyebrow">Предприятия</p>
            <h2 className="sectionTitle">Создать предприятие</h2>
          </div>
          <span className="statusPill">{isLoading ? "Сохранение..." : "Готово"}</span>
        </div>

        <form className="formGrid" onSubmit={handleSubmit}>
          <label className="field">
            <span>Название</span>
            <input
              value={formState.name}
              onChange={(event) =>
                setFormState((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="ООО Цитадель"
            />
          </label>

          <label className="field">
            <span>Адрес</span>
            <input
              value={formState.address}
              onChange={(event) =>
                setFormState((current) => ({ ...current, address: event.target.value }))
              }
              placeholder="Москва, ул. Пример, 1"
            />
          </label>

          <label className="field">
            <span>Телефон</span>
            <input
              value={formState.phone}
              onChange={(event) =>
                setFormState((current) => ({ ...current, phone: event.target.value }))
              }
              placeholder="+7 (900) 000-00-00"
            />
          </label>

          {errorMessage ? <p className="errorText">{errorMessage}</p> : null}

          <button className="primaryButton" type="submit" disabled={isLoading}>
            Создать предприятие
          </button>
        </form>
      </section>

      <section className="card">
        <div className="cardHeader">
          <div>
            <p className="panelEyebrow">Список</p>
            <h2 className="sectionTitle">Доступные предприятия</h2>
          </div>
          <span className="counterBadge">{enterprises.length}</span>
        </div>

        <div className="enterpriseList">
          {enterprises.length === 0 ? (
            <div className="emptyState">
              <p className="emptyStateTitle">Предприятий пока нет</p>
              <p className="emptyStateText">
                Создайте первое предприятие. После этого его можно будет выбрать сверху.
              </p>
            </div>
          ) : (
            enterprises.map((enterprise) => {
              const isActive = enterprise.id === activeEnterpriseId;

              return (
                <button
                  key={enterprise.id}
                  type="button"
                  className={`enterpriseCard ${isActive ? "enterpriseCardActive" : ""}`}
                  onClick={() => selectEnterprise(enterprise.id)}
                >
                  <div>
                    <h3>{enterprise.name}</h3>
                    <p>{enterprise.address}</p>
                  </div>
                  <span>{enterprise.phone}</span>
                </button>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
