"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { BadgePercent, Building2, ReceiptText, TriangleAlert, TrendingUp } from "lucide-react";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";
import type {
  HomeIconName,
  HomeOverviewAttentionItem,
  HomeOverviewHeroFact,
  HomeOverviewLossRow,
  HomeOverviewPayload,
  HomeOverviewSummaryCard,
  HomeOverviewWorkflowStat,
} from "@/features/home/types";

const iconMap: Record<HomeIconName, LucideIcon> = {
  upload: ReceiptText,
  badgePercent: BadgePercent,
  building2: Building2,
  fileSpreadsheet: ReceiptText,
  package: ReceiptText,
  receiptText: ReceiptText,
  shoppingCart: ReceiptText,
  triangleAlert: TriangleAlert,
  trendingUp: TrendingUp,
};

const emptyOverview: HomeOverviewPayload = {
  periodLabel: "",
  summaryCards: [],
  heroFacts: [],
  workflowStats: [],
  lossRows: [],
  attentionItems: [],
};

const previewOverview: HomeOverviewPayload = {
  periodLabel: "Май 2026",
  summaryCards: [
    {
      label: "Закупки за месяц",
      value: "1 248 000 ₽",
      detail: "18 заказов проведено",
      tone: "accent",
      icon: "receiptText",
    },
    {
      label: "Экономия",
      value: "92 400 ₽",
      detail: "Относительно прошлой закупочной цены",
      tone: "success",
      icon: "badgePercent",
    },
    {
      label: "Упущенная экономия",
      value: "37 900 ₽",
      detail: "Разница до лучшей текущей цены",
      tone: "warning",
      icon: "trendingUp",
    },
    {
      label: "Проблемы",
      value: "14",
      detail: "Ошибки, пустые цены и невыгодные покупки",
      tone: "danger",
      icon: "triangleAlert",
    },
    {
      label: "Рост цен",
      value: "9",
      detail: "Позиции с ростом против прошлого снимка",
      tone: "warning",
      icon: "trendingUp",
    },
  ],
  heroFacts: [
    {
      label: "Поставщиков в работе",
      value: "24",
      detail: "Активные поставщики в системе",
    },
    {
      label: "Закуплено позиций",
      value: "312",
      detail: "Строк заказа за текущий месяц",
    },
    {
      label: "Закупки проведены через",
      value: "11",
      detail: "Поставщиков в этом месяце",
    },
  ],
  workflowStats: [
    {
      label: "Заказано",
      value: "312",
      detail: "18 заказов за май 2026",
      tone: "accent",
    },
    {
      label: "Выгодно распределено",
      value: "226",
      detail: "Купили по лучшей текущей цене",
      tone: "success",
    },
    {
      label: "Купили не по лучшей цене",
      value: "41",
      detail: "Потеряли 37 900 ₽",
      tone: "warning",
    },
    {
      label: "Без актуальной цены",
      value: "12",
      detail: "Нужно проверить поставщика или сопоставление",
      tone: "danger",
    },
  ],
  lossRows: [
    {
      title: "Сыр Креметте 2 кг",
      supplier: "Меридиан",
      purchasePrice: "1 920 ₽",
      bestPrice: "1 760 ₽",
      quantity: "12 шт",
      loss: "1 920 ₽",
      tone: "danger",
    },
    {
      title: "Лосось филе охл.",
      supplier: "Фудлайн",
      purchasePrice: "1 480 ₽",
      bestPrice: "1 390 ₽",
      quantity: "18 кг",
      loss: "1 620 ₽",
      tone: "danger",
    },
    {
      title: "Авокадо Хасс",
      supplier: "Восток-Запад",
      purchasePrice: "690 ₽",
      bestPrice: "640 ₽",
      quantity: "14 кг",
      loss: "700 ₽",
      tone: "warning",
    },
    {
      title: "Сливки 33%",
      supplier: "Меридиан",
      purchasePrice: "412 ₽",
      bestPrice: "389 ₽",
      quantity: "20 шт",
      loss: "460 ₽",
      tone: "warning",
    },
    {
      title: "Рис для суши",
      supplier: "Фудлайн",
      purchasePrice: "218 ₽",
      bestPrice: "204 ₽",
      quantity: "25 кг",
      loss: "350 ₽",
      tone: "accent",
    },
  ],
  attentionItems: [
    {
      title: "Есть прайсы, которые требуют ручной проверки",
      description: "В текущих документах найдены ошибки разбора, блокировки или слабые сопоставления.",
      value: "4",
      tone: "danger",
      icon: "triangleAlert",
    },
    {
      title: "Не у всех закупленных позиций есть актуальная цена",
      description: "Часть строк заказа не привязана к актуальному прайсу. Это мешает честно считать выгоду.",
      value: "12",
      tone: "warning",
      icon: "receiptText",
    },
    {
      title: "Есть закупки, где уже видно потерю денег",
      description: "По части позиций купили дороже, чем лучшая текущая цена у другого поставщика.",
      value: "37 900 ₽",
      tone: "warning",
      icon: "badgePercent",
    },
    {
      title: "Лосось филе охл. вырос в цене",
      description: "Фудлайн: было 1 330 ₽, стало 1 480 ₽.",
      value: "+11%",
      tone: "warning",
      icon: "trendingUp",
    },
  ],
};

function HomeSummaryCard({ item }: { item: HomeOverviewSummaryCard }) {
  const Icon = iconMap[item.icon];

  return (
    <article className="homeSummaryCard">
      <span className={`homeSummaryIcon homeSummaryIcon-${item.tone}`}>
        <Icon size={18} strokeWidth={2} />
      </span>
      <span className="homeSummaryLabel">{item.label}</span>
      <strong className="homeSummaryValue">{item.value}</strong>
      <span className="homeSummaryDetail">{item.detail}</span>
    </article>
  );
}

function HomeHeroFact({ item }: { item: HomeOverviewHeroFact }) {
  return (
    <article className="homeHeroFact">
      <span className="homeHeroFactLabel">{item.label}</span>
      <strong className="homeHeroFactValue">{item.value}</strong>
      <span className="homeHeroFactDetail">{item.detail}</span>
    </article>
  );
}

function HomeWorkflowStat({ item }: { item: HomeOverviewWorkflowStat }) {
  return (
    <article className={`homeFlowCard homeFlowCard-${item.tone}`}>
      <span className="homeFlowLabel">{item.label}</span>
      <strong className="homeFlowValue">{item.value}</strong>
      <span className="homeFlowDetail">{item.detail}</span>
    </article>
  );
}

function HomeAttentionItemCard({ item }: { item: HomeOverviewAttentionItem }) {
  const Icon = iconMap[item.icon];

  return (
    <article className={`homeAttentionCard homeAttentionCard-${item.tone}`}>
      <span className={`homeAttentionIcon homeAttentionIcon-${item.tone}`}>
        <Icon size={16} strokeWidth={2.1} />
      </span>
      <div className="homeAttentionBody">
        <strong>{item.title}</strong>
        <p>{item.description}</p>
      </div>
      <span className={`homeAttentionValue homeAttentionValue-${item.tone}`}>{item.value}</span>
    </article>
  );
}

function HomeLossTable({ rows }: { rows: HomeOverviewLossRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="emptyState">
        <p className="emptyStateTitle">Потерь пока не видно</p>
        <p className="emptyStateText">Когда появятся проведённые закупки с сопоставимыми ценами, здесь покажем конкретные потери.</p>
      </div>
    );
  }

  return (
    <div className="homeLossTable">
      <div className="homeLossTableHead">
        <span>Товар</span>
        <span>Купили у</span>
        <span>Цена покупки</span>
        <span>Лучшая цена</span>
        <span>Объем</span>
        <span>Потеря</span>
      </div>

      {rows.map((row) => (
        <article key={`${row.title}-${row.supplier}-${row.loss}`} className="homeLossRow">
          <span className="homeLossPrimary">{row.title}</span>
          <span>{row.supplier}</span>
          <span>{row.purchasePrice}</span>
          <span>{row.bestPrice}</span>
          <span>{row.quantity}</span>
          <span className={`homeLossValue homeLossValue-${row.tone}`}>{row.loss}</span>
        </article>
      ))}
    </div>
  );
}

export function HomeDashboard() {
  const { activeEnterprise, activeEnterpriseId, enterprises } = useEnterprise();
  const [overview, setOverview] = useState<HomeOverviewPayload>(emptyOverview);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!activeEnterpriseId) {
      return;
    }

    const controller = new AbortController();

    const loadOverview = async () => {
      setIsLoading(true);
      setErrorMessage("");

      try {
        const response = await fetch(`/api/home/overview?enterpriseId=${encodeURIComponent(activeEnterpriseId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Не удалось получить данные главной страницы.");
        }

        const data = (await response.json()) as HomeOverviewPayload;
        setOverview(data);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить главную страницу.");
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void loadOverview();

    return () => controller.abort();
  }, [activeEnterpriseId]);

  const visibleOverview = activeEnterpriseId ? overview : previewOverview;

  return (
    <div className="pageStack homeDashboard homeDashboardV2">
      <section className="heroCard homeHeroV2">
        <div className="homeHeroMain">
          <p className="panelEyebrow">Главная</p>
          <h1 className="homeHeroTitle">Контроль закупок без лишнего шума</h1>
          <p className="homeHeroLead">
            Экран показывает закупки, экономию, потери и рост цен по текущему месяцу. Приоритет у денег, ошибок и
            невыгодных решений.
          </p>

          <div className="homeHeroEnterpriseInline">
            <span className="homeHeroEnterpriseLabel">Активное предприятие</span>
            <strong>{activeEnterprise?.name ?? "Предприятие не выбрано"}</strong>
            <span className="homeHeroEnterpriseMeta">
              {activeEnterprise
                ? `${activeEnterprise.address} • ${activeEnterprise.phone}`
                : enterprises.length === 0
                  ? "Сначала добавьте предприятие."
                  : "Выберите предприятие в верхней панели."}
            </span>
          </div>
        </div>

        <div className="homeHeroAside">
          <div className="homeHeroFacts">
            {visibleOverview.heroFacts.map((item) => (
              <HomeHeroFact key={item.label} item={item} />
            ))}
          </div>

          <div className="homeHeroNoteCard">
            <span className="homeHeroNoteTitle">Как считаем</span>
            <p>
              Экономия считается от прошлой закупочной цены. Упущенная экономия считается как разница между ценой
              покупки и лучшей текущей ценой по сопоставимому товару.
            </p>
            <span className="statusPill">{isLoading ? "Обновляю..." : visibleOverview.periodLabel || "Текущий месяц"}</span>
          </div>
        </div>
      </section>

      {errorMessage ? <p className="errorText">{errorMessage}</p> : null}

      <section className="card homePanel">
        <div className="homeSectionHeader">
          <div>
            <h2 className="sectionTitle">Ключевые показатели</h2>
            <p className="panelText">Только то, что помогает быстро оценить деньги, ошибки и риск потерь.</p>
          </div>
        </div>

        <div className="homeSummaryGrid homeSummaryGridV2">
          {visibleOverview.summaryCards.map((item) => (
            <HomeSummaryCard key={item.label} item={item} />
          ))}
        </div>
      </section>

      <div className="homeInsightGrid">
        <section className="card homePanel">
          <div className="homeSectionHeader">
            <div>
              <h2 className="sectionTitle">Как прошли закупки в этом месяце</h2>
              <p className="panelText">Сводка по проведённым заказам и тому, насколько выгодно они были распределены.</p>
            </div>
          </div>

          <div className="homeFlowGrid">
            {visibleOverview.workflowStats.map((item) => (
              <HomeWorkflowStat key={item.label} item={item} />
            ))}
          </div>
        </section>

        <section className="card homePanel homeContextPanel">
          <div className="homeSectionHeader">
            <div>
              <h2 className="sectionTitle">Контекст месяца</h2>
              <p className="panelText">Коротко про то, что уже закупили и как считать цифры на этом экране.</p>
            </div>
          </div>

          <div className="homeContextList">
            <div className="homeContextRow">
              <span>Что уже купили</span>
              <strong>{visibleOverview.heroFacts[1]?.value ?? "0"} позиций</strong>
            </div>
            <div className="homeContextRow">
              <span>Сколько поставщиков в работе</span>
              <strong>{visibleOverview.heroFacts[0]?.value ?? "0"}</strong>
            </div>
            <div className="homeContextRow">
              <span>Сколько поставщиков уже участвовало в закупках</span>
              <strong>{visibleOverview.heroFacts[2]?.value ?? "0"}</strong>
            </div>
          </div>

          <div className="homeContextCaption">
            Если исторических закупок или сопоставлений мало, экран всё равно строится, но часть цифр будет считаться
            только по текущим данным.
          </div>
        </section>
      </div>

      <section className="card homePanel">
        <div className="homeSectionHeader">
          <div>
            <h2 className="sectionTitle">Где потеряли деньги</h2>
            <p className="panelText">Показываем только реальные строки закупки, где цена покупки хуже лучшей доступной текущей цены.</p>
          </div>
        </div>

        <HomeLossTable rows={visibleOverview.lossRows} />
      </section>

      <section className="card homePanel">
        <div className="homeSectionHeader">
          <div>
            <h2 className="sectionTitle">Что требует внимания</h2>
            <p className="panelText">Сначала видны деньги и потери, здесь уже вторым уровнем идут алерты и сигналы.</p>
          </div>
        </div>

        <div className="homeAttentionList">
          {visibleOverview.attentionItems.map((item) => (
            <HomeAttentionItemCard key={`${item.title}-${item.value}`} item={item} />
          ))}
        </div>
      </section>
    </div>
  );
}
