"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  BadgePercent,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Info,
  Package,
  RefreshCcw,
  ShoppingCart,
  Tag,
  TrendingUp,
} from "lucide-react";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";
import type {
  HomeIconName,
  HomeOverviewAttentionItem,
  HomeOverviewLossRow,
  HomeOverviewPayload,
  HomeOverviewSummaryCard,
  HomeOverviewWorkflowStat,
} from "@/features/home/types";

const iconMap: Record<HomeIconName, LucideIcon> = {
  upload: Package,
  badgePercent: BadgePercent,
  building2: Package,
  fileSpreadsheet: Package,
  package: Package,
  receiptText: ShoppingCart,
  shoppingCart: ShoppingCart,
  triangleAlert: AlertTriangle,
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
      value: "2 840 000 ₽",
      detail: "Факт по iiko",
      tone: "success",
      icon: "shoppingCart",
    },
    {
      label: "Экономия",
      value: "186 400 ₽",
      detail: "К прошлой цене и лучшим ценам",
      tone: "success",
      icon: "trendingUp",
    },
    {
      label: "Упущенная экономия",
      value: "42 700 ₽",
      detail: "Купили дороже, чем могли",
      tone: "warning",
      icon: "badgePercent",
    },
    {
      label: "Проблемы",
      value: "27",
      detail: "Требуют проверки",
      tone: "danger",
      icon: "triangleAlert",
    },
    {
      label: "Рост цен",
      value: "18 товаров",
      detail: "За последние 30 дней",
      tone: "success",
      icon: "trendingUp",
    },
  ],
  heroFacts: [],
  workflowStats: [
    {
      label: "Заказано",
      value: "428",
      detail: "товаров",
      tone: "success",
    },
    {
      label: "Выгодно распределено",
      value: "361",
      detail: "товар",
      tone: "success",
    },
    {
      label: "Купили не по лучшей цене",
      value: "24",
      detail: "товара",
      tone: "warning",
    },
    {
      label: "Без актуальной цены",
      value: "43",
      detail: "товара",
      tone: "neutral",
    },
  ],
  lossRows: [
    {
      title: "Куриное филе",
      supplier: "Поставщик N2",
      purchasePrice: "320,00 ₽/кг",
      bestPrice: "280,00 ₽/кг",
      quantity: "150 кг",
      loss: "6 000 ₽",
      tone: "danger",
    },
    {
      title: "Масло сливочное",
      supplier: "Поставщик N3",
      purchasePrice: "780,00 ₽/кг",
      bestPrice: "650,00 ₽/кг",
      quantity: "40 кг",
      loss: "5 200 ₽",
      tone: "danger",
    },
    {
      title: "Томаты",
      supplier: "Поставщик N1",
      purchasePrice: "210,00 ₽/кг",
      bestPrice: "175,00 ₽/кг",
      quantity: "60 кг",
      loss: "2 100 ₽",
      tone: "danger",
    },
    {
      title: "Сыр моцарелла",
      supplier: "Поставщик N2",
      purchasePrice: "610,00 ₽/кг",
      bestPrice: "560,00 ₽/кг",
      quantity: "25 кг",
      loss: "1 250 ₽",
      tone: "danger",
    },
  ],
  attentionItems: [
    {
      title: "5 товаров куплены дороже лучшей цены",
      description: "Проверьте распределение перед следующим заказом.",
      value: "Критично",
      tone: "danger",
      icon: "triangleAlert",
    },
    {
      title: "43 товара без актуальной цены",
      description: "Нужно обновить прайсы или сопоставление.",
      value: "Проверить",
      tone: "warning",
      icon: "fileSpreadsheet",
    },
  ],
};

const lossProductIcons = ["🥩", "🧈", "🍅", "🧀", "🥬"];

function HomeSummaryCard({ item }: { item: HomeOverviewSummaryCard }) {
  const Icon = item.icon === "badgePercent" ? RefreshCcw : iconMap[item.icon];

  return (
    <article className="homeMetricCard">
      <div className="homeMetricTop">
        <span className={`homeMetricIcon homeMetricIcon-${item.tone}`}>
          <Icon size={24} strokeWidth={2} />
        </span>
        <span className="homeMetricLabel">{item.label}</span>
      </div>
      <strong className={`homeMetricValue homeMetricValue-${item.tone}`}>{item.value}</strong>
      <span className="homeMetricDetail">{item.detail}</span>
    </article>
  );
}

function getFlowIcon(index: number, tone: HomeOverviewWorkflowStat["tone"]) {
  if (index === 0) {
    return Package;
  }

  if (tone === "success") {
    return CheckCircle2;
  }

  if (tone === "warning") {
    return Tag;
  }

  return CircleHelp;
}

function HomeWorkflow({ items }: { items: HomeOverviewWorkflowStat[] }) {
  return (
    <div className="homeFlowLine">
      {items.map((item, index) => {
        const Icon = getFlowIcon(index, item.tone);

        return (
          <article key={item.label} className={`homeFlowStep homeFlowStep-${item.tone}`}>
            <div className="homeFlowStepTop">
              <span className={`homeFlowStepIcon homeFlowStepIcon-${item.tone}`}>
                <Icon size={24} strokeWidth={2} />
              </span>
              <strong>{item.label}</strong>
            </div>
            <span className="homeFlowPoint" />
            <strong className={`homeFlowStepValue homeFlowStepValue-${item.tone}`}>{item.value}</strong>
            <span className="homeFlowStepDetail">{item.detail}</span>
          </article>
        );
      })}
    </div>
  );
}

function HomeLossTable({ rows }: { rows: HomeOverviewLossRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="emptyState">
        <p className="emptyStateTitle">Потерь пока не видно</p>
        <p className="emptyStateText">Когда появятся закупки с сопоставимыми ценами, здесь будут конкретные потери.</p>
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
        <span />
      </div>

      {rows.map((row, index) => (
        <article key={`${row.title}-${row.supplier}-${row.loss}`} className="homeLossRow">
          <span className="homeLossProduct">
            <span className="homeLossProductIcon" aria-hidden="true">
              {lossProductIcons[index] ?? "□"}
            </span>
            <strong>{row.title}</strong>
          </span>
          <span>{row.supplier}</span>
          <span>{row.purchasePrice}</span>
          <span className="homeLossBest">{row.bestPrice}</span>
          <span>{row.quantity}</span>
          <span className="homeLossValue homeLossValue-danger">{row.loss}</span>
          <span className="homeLossArrow" aria-hidden="true">
            <ChevronRight size={18} strokeWidth={2.2} />
          </span>
        </article>
      ))}

      <button type="button" className="homeShowAllButton">
        Показать все ({Math.max(rows.length, 24)})
        <ChevronDown size={16} strokeWidth={2.2} />
      </button>
    </div>
  );
}

function HomeAttentionItemCard({ item }: { item: HomeOverviewAttentionItem }) {
  const Icon = iconMap[item.icon];

  return (
    <article className={`homeAttentionCard homeAttentionCard-${item.tone}`}>
      <span className={`homeAttentionIcon homeAttentionIcon-${item.tone}`}>
        <Icon size={18} strokeWidth={2.1} />
      </span>
      <div className="homeAttentionBody">
        <strong>{item.title}</strong>
        <p>{item.description}</p>
      </div>
      <span className={`homeAttentionValue homeAttentionValue-${item.tone}`}>{item.value}</span>
      <ChevronRight size={18} strokeWidth={2.2} />
    </article>
  );
}

export function HomeDashboard() {
  const { activeEnterpriseId } = useEnterprise();
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

  const visibleOverview = activeEnterpriseId && overview.summaryCards.length > 0 ? overview : previewOverview;

  return (
    <div className="pageStack homeDashboard homeDashboardV2">
      <section className="homePageHead">
        <div>
          <h1 className="homePageTitle">Главная</h1>
          <p className="homePageSubtitle">Контроль закупок, экономии и распределения заказов</p>
        </div>
      </section>

      {errorMessage ? <p className="errorText">{errorMessage}</p> : null}

      <section className="homeMetricGrid" aria-label="Ключевые показатели">
        {visibleOverview.summaryCards.map((item) => (
          <HomeSummaryCard key={item.label} item={item} />
        ))}
      </section>

      <section className="card homePanel homeFlowPanel">
        <div className="homeSectionHeader homeSectionHeaderCompact">
          <h2 className="sectionTitle">Как прошли закупки в этом месяце</h2>
        </div>
        <HomeWorkflow items={visibleOverview.workflowStats} />
        <div className="homeFlowNote">
          <Info size={16} strokeWidth={2} />
          <span>
            {isLoading
              ? "Обновляем данные..."
              : "Считается по фактическим закупкам iiko и ценам на момент заказа"}
          </span>
        </div>
      </section>

      <section className="card homePanel homeLossPanel">
        <div className="homeSectionHeader homeSectionHeaderCompact">
          <h2 className="sectionTitle">Где потеряли деньги</h2>
        </div>
        <HomeLossTable rows={visibleOverview.lossRows} />
      </section>

      <section className="card homePanel homeAttentionPanel">
        <div className="homeSectionHeader homeSectionHeaderCompact">
          <h2 className="sectionTitle">Что требует внимания</h2>
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
