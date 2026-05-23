import { LogoutButton } from "@/components/auth/logout-button";
import { EnterpriseSwitcher } from "@/features/enterprises/components/enterprise-switcher";

export function Topbar() {
  return (
    <header className="topbar">
      <div className="topbarInner">
        <div>
          <p className="panelEyebrow">Рабочая панель</p>
          <h2 className="topbarTitle">Прайсы 1.1</h2>
        </div>

        <div className="topbarMeta">
          <span className="topbarNote">Активное предприятие выбирается только на этом клиенте.</span>
          <LogoutButton />
        </div>
      </div>

      <EnterpriseSwitcher />
    </header>
  );
}
