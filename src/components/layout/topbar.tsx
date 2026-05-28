"use client";

import { Bell, Building2, CalendarDays, ChevronDown, Info, UserCircle } from "lucide-react";
import { LogoutButton } from "@/components/auth/logout-button";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";

export function Topbar() {
  const { enterprises, activeEnterprise, activeEnterpriseId, selectEnterprise, isLoading } = useEnterprise();
  const now = new Date();
  const monthName = new Intl.DateTimeFormat("ru-RU", { month: "long" }).format(now);
  const periodLabel = `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} ${now.getFullYear()}`;

  return (
    <header className="topbar">
      <div className="topbarInner topbarInnerDashboard">
        <div className="topbarControls">
          <label className="topbarSelectWrap">
            <Building2 size={18} strokeWidth={1.9} />
            <select
              className="topbarSelect"
              value={activeEnterpriseId ?? ""}
              onChange={(event) => selectEnterprise(event.target.value)}
              disabled={isLoading || enterprises.length === 0}
              aria-label="Активное предприятие"
            >
              {enterprises.length === 0 ? <option value="">Кафе Цитадель</option> : null}
              {enterprises.map((enterprise) => (
                <option key={enterprise.id} value={enterprise.id}>
                  {enterprise.name}
                </option>
              ))}
            </select>
            <ChevronDown size={16} strokeWidth={2} />
          </label>

          <button className="topbarSelectWrap topbarPeriodButton" type="button">
            <CalendarDays size={18} strokeWidth={1.9} />
            <span>{periodLabel}</span>
            <ChevronDown size={16} strokeWidth={2} />
          </button>

          <div className="topbarIikoStatus">
            <span className="topbarStatusDot" />
            <strong>iiko: данные по закупкам</strong>
            <Info size={17} strokeWidth={1.9} />
          </div>
        </div>

        <div className="topbarMeta topbarMetaDashboard">
          <button className="topbarIconButton" type="button" aria-label="Уведомления">
            <Bell size={21} strokeWidth={1.9} />
          </button>
          <div className="topbarUserWrap" title={activeEnterprise?.name ?? "Пользователь"}>
            <UserCircle size={22} strokeWidth={1.9} />
          </div>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
