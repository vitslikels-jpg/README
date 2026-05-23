import { EnterpriseManager } from "@/features/enterprises/components/enterprise-manager";

export default function HomePage() {
  return (
    <div className="pageStack">
      <section className="heroCard">
        <p className="panelEyebrow">Главная</p>
        <h2 className="pageTitle">Базовый каркас приложения</h2>
        <p className="pageDescription">
          Здесь собран чистый стартовый интерфейс: фиксированное левое меню, верхняя
          панель с активным предприятием и рабочая область. На этой странице доступен
          только базовый CRUD предприятий.
        </p>
      </section>

      <EnterpriseManager />
    </div>
  );
}
