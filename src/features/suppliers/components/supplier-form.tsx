import type { ReactNode } from "react";
import type { SupplierFormValues } from "@/features/suppliers/types";

type SupplierFormProps = {
  values: SupplierFormValues;
  disabled?: boolean;
  errorMessage: string;
  submitLabel: string;
  title: string;
  description: string;
  children?: ReactNode;
  onChange: (field: keyof SupplierFormValues, value: string) => void;
  onSubmit: () => void;
};

export function SupplierForm({
  values,
  disabled,
  errorMessage,
  submitLabel,
  title,
  description,
  children,
  onChange,
  onSubmit,
}: SupplierFormProps) {
  return (
    <div className="supplierPanelContent">
      <div className="cardHeader supplierPanelHeader">
        <div>
          <p className="panelEyebrow">Поставщик</p>
          <h2 className="sectionTitle">{title}</h2>
          <p className="panelText">{description}</p>
        </div>
      </div>

      <div className="formGrid">
        <label className="field">
          <span>Название</span>
          <input
            value={values.name}
            onChange={(event) => onChange("name", event.target.value)}
            placeholder="ООО Надёжный поставщик"
          />
        </label>

        <label className="field">
          <span>Телефон</span>
          <input
            value={values.phone}
            onChange={(event) => onChange("phone", event.target.value)}
            placeholder="+7 (900) 000-00-00"
          />
        </label>

        <label className="field">
          <span>Менеджер</span>
          <input
            value={values.managerName}
            onChange={(event) => onChange("managerName", event.target.value)}
            placeholder="Иван Петров"
          />
        </label>

        <label className="field">
          <span>Email</span>
          <input
            value={values.email}
            onChange={(event) => onChange("email", event.target.value)}
            placeholder="manager@example.com"
          />
        </label>

        <label className="field">
          <span>Мин. сумма заказа</span>
          <input
            value={values.minOrderAmount}
            onChange={(event) => onChange("minOrderAmount", event.target.value)}
            placeholder="10000"
          />
        </label>

        <label className="field">
          <span>Комментарий</span>
          <textarea
            className="fieldTextarea"
            value={values.comment}
            onChange={(event) => onChange("comment", event.target.value)}
            placeholder="Комментарий по работе с поставщиком"
            rows={5}
          />
        </label>

        {errorMessage ? <p className="errorText">{errorMessage}</p> : null}

        <button className="primaryButton" type="button" disabled={disabled} onClick={onSubmit}>
          {submitLabel}
        </button>
      </div>

      {children}
    </div>
  );
}
