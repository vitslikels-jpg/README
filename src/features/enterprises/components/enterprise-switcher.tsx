"use client";

import { useEnterprise } from "@/features/enterprises/components/enterprise-context";

export function EnterpriseSwitcher() {
  const { enterprises, activeEnterprise, activeEnterpriseId, selectEnterprise, isLoading } =
    useEnterprise();

  return (
    <div className="enterpriseSwitcher">
      <div>
        <p className="panelEyebrow">Активное предприятие</p>
        <h2 className="panelTitle">
          {activeEnterprise ? activeEnterprise.name : "Предприятие не выбрано"}
        </h2>
      </div>

      <select
        className="enterpriseSelect"
        value={activeEnterpriseId ?? ""}
        onChange={(event) => selectEnterprise(event.target.value)}
        disabled={isLoading || enterprises.length === 0}
      >
        {enterprises.length === 0 ? <option value="">Сначала создайте предприятие</option> : null}

        {enterprises.map((enterprise) => (
          <option key={enterprise.id} value={enterprise.id}>
            {enterprise.name}
          </option>
        ))}
      </select>
    </div>
  );
}
