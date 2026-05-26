"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BadgePercent,
  BarChart3,
  Building2,
  ChevronRight,
  FileSpreadsheet,
  Package,
  ReceiptText,
  ShoppingCart,
  TriangleAlert,
  TrendingUp,
  Upload,
} from "lucide-react";
import { EnterpriseManager } from "@/features/enterprises/components/enterprise-manager";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";

type HomeAction = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
};

type FocusItem = {
  title: string;
  description: string;
  badge: string;
  href: string;
  tone: "danger" | "warning" | "success" | "accent";
  icon: LucideIcon;
};

type RecentEvent = {
  title: string;
  time: string;
  tone: "danger" | "warning" | "success" | "accent" | "neutral";
  icon: LucideIcon;
};

type SummaryCard = {
  label: string;
  value: string;
  detail: string;
  trend: string;
  tone: "accent" | "success" | "violet" | "warning";
  icon: LucideIcon;
};

const todayActions: HomeAction[] = [
  {
    title: "Загрузить накладную",
    description: "Добавьте новые поставки и разберите их по товарам.",
    href: "/invoice-upload",
    icon: Upload,
  },
  {
    title: "Создать заказ",
    description: "Соберите заказ поставщику по текущим потребностям.",
    href: "/smart-order",
    icon: ShoppingCart,
  },
  {
    title: "Перейти к отчётам",
    description: "Откройте аналитику и посмотрите изменения по закупкам.",
    href: "/reports",
    icon: BarChart3,
  },
];

const focusItems: FocusItem[] = [
  {
    title: "Подорожали товары",
    description: "Сегодня зафиксирован рост цен у 7 товаров от 2 поставщиков",
    badge: "+7 позиций",
    href: "/reports",
    tone: "danger",
    icon: TrendingUp,
  },
  {
    title: "Заканчиваются остатки",
    description: "У 5 товаров остаток меньше минимального",
    badge: "5 товаров",
    href: "/products",
    tone: "warning",
    icon: TriangleAlert,
  },
  {
    title: "Нашли дешевле",
    description: "По 3 товарам можно сэкономить до 15%",
    badge: "3 возможности",
    href: "/catalog",
    tone: "success",
    icon: BadgePercent,
  },
  {
    title: "Не загружены накладные",
    description: "У вас 2 непринятые накладные",
    badge: "Загрузить",
    href: "/invoice-upload",
    tone: "accent",
    icon: ReceiptText,
  },
];

const recentEvents: RecentEvent[] = [
  {
    title: "Продстар поднял цены на курицу",
    time: "10:30",
    tone: "danger",
    icon: TrendingUp,
  },
  {
    title: "У Молокопродукта закончились сливки 20%",
    time: "09:45",
    tone: "warning",
    icon: TriangleAlert,
  },
  {
    title: "Найден товар дешевле у другого поставщика",
    time: "09:20",
    tone: "success",
    icon: BadgePercent,
  },
  {
    title: "Не заказан сыр моцарелла",
    time: "09:15",
    tone: "accent",
    icon: Package,
  },
  {
    title: "Загружена накладная от ООО \"Мясной дом\"",
    time: "Вчера, 18:30",
    tone: "neutral",
    icon: Upload,
  },
];

const quickActions: HomeAction[] = [
  {
    title: "Создать заказ поставщику",
    description: "Перейти в умный сценарий заказа.",
    href: "/smart-order",
    icon: ShoppingCart,
  },
  {
    title: "Добавить товар в каталог",
    description: "Открыть каталог и связки товаров.",
    href: "/catalog",
    icon: Package,
  },
  {
    title: "Добавить поставщика",
    description: "Перейти в управление поставщиками.",
    href: "/suppliers",
    icon: Building2,
  },
  {
    title: "Импортировать товары",
    description: "Загрузить новый прайс или накладную.",
    href: "/invoice-upload",
    icon: FileSpreadsheet,
  },
];

const summaryCards: SummaryCard[] = [
  {
    label: "Заказы за месяц",
    value: "128",
    detail: "к прошлому месяцу",
    trend: "+12%",
    tone: "accent",
    icon: ShoppingCart,
  },
  {
    label: "Сумма заказов",
    value: "2 450 000 ₽",
    detail: "к прошлому месяцу",
    trend: "+8%",
    tone: "success",
    icon: ReceiptText,
  },
  {
    label: "Поставщики",
    value: "24",
    detail: "активных",
    trend: "+2",
    tone: "violet",
    icon: Building2,
  },
  {
    label: "Товары в каталоге",
    value: "3 456",
    detail: "уникальных товаров",
    trend: "+156",
    tone: "warning",
    icon: Package,
  },
];

export function HomeDashboard() {
  const { activeEnterprise, enterprises } = useEnterprise();

  return (
    <div className="pageStack homeDashboard">
      <section className="heroCard homeHero">
        <div className="homeHeroCopy">
          <p className="panelEyebrow">Главная</p>
          <h1 className="homeHeroTitle">Добро пожаловать</h1>
          <p className="pageDescription">
            Я проанализировал данные и собрал главное на сегодня.
          </p>
        </div>

        <div className="homeHeroEnterprise">
          <span className="homeHeroEnterpriseLabel">Активное предприятие</span>
          <strong>{activeEnterprise?.name ?? "Предприятие не выбрано"}</strong>
          <span>
            {activeEnterprise
              ? `${activeEnterprise.address} • ${activeEnterprise.phone}`
              : enterprises.length === 0
                ? "Сначала добавьте предприятие в систему."
                : "Выберите предприятие в верхней панели."}
          </span>
        </div>
      </section>

      <div className="homeDashboardGrid">
        <div className="homeDashboardMain">
          <section className="card homePanel">
            <div className="homeSectionHeader">
              <div>
                <h2 className="sectionTitle">Что нужно сделать сегодня?</h2>
                <p className="panelText">Вот приоритетные задачи, чтобы всё было под контролем.</p>
              </div>
            </div>

            <div className="homeActionGrid">
              {todayActions.map((item) => {
                const Icon = item.icon;

                return (
                  <Link key={item.title} href={item.href} className="homeActionCard">
                    <span className="homeActionIcon">
                      <Icon size={22} strokeWidth={2} />
                    </span>
                    <div className="homeActionBody">
                      <strong>{item.title}</strong>
                      <p>{item.description}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>

          <section className="card homePanel">
            <div className="homeSectionHeader">
              <div>
                <h2 className="sectionTitle">Сегодня в фокусе</h2>
                <p className="panelText">Ключевые события и рекомендации на основе ваших данных.</p>
              </div>
            </div>

            <div className="homeFocusList">
              {focusItems.map((item) => {
                const Icon = item.icon;

                return (
                  <Link
                    key={item.title}
                    href={item.href}
                    className={`homeFocusCard homeFocusCard-${item.tone}`}
                  >
                    <span className={`homeFocusIcon homeFocusIcon-${item.tone}`}>
                      <Icon size={22} strokeWidth={2} />
                    </span>
                    <div className="homeFocusBody">
                      <strong>{item.title}</strong>
                      <p>{item.description}</p>
                    </div>
                    <span className={`homeFocusBadge homeFocusBadge-${item.tone}`}>{item.badge}</span>
                    <span className="homeFocusArrow" aria-hidden="true">
                      <ChevronRight size={18} strokeWidth={2.2} />
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>

          <section className="card homePanel">
            <div className="homeSectionHeader">
              <div>
                <h2 className="sectionTitle">Краткая сводка</h2>
                <p className="panelText">Быстрый срез по заказам, поставщикам и каталогу.</p>
              </div>
            </div>

            <div className="homeSummaryGrid">
              {summaryCards.map((item) => {
                const Icon = item.icon;

                return (
                  <article key={item.label} className="homeSummaryCard">
                    <div className="homeSummaryTop">
                      <span className={`homeSummaryIcon homeSummaryIcon-${item.tone}`}>
                        <Icon size={20} strokeWidth={2} />
                      </span>
                      <span className={`homeSummaryTrend homeSummaryTrend-${item.tone}`}>{item.trend}</span>
                    </div>
                    <span className="homeSummaryLabel">{item.label}</span>
                    <strong className="homeSummaryValue">{item.value}</strong>
                    <span className="homeSummaryDetail">{item.detail}</span>
                  </article>
                );
              })}
            </div>
          </section>

          <details className="homeEnterpriseDetails">
            <summary>Управление предприятиями</summary>
            <div className="homeEnterpriseDetailsBody">
              <EnterpriseManager />
            </div>
          </details>
        </div>

        <div className="homeDashboardAside">
          <section className="card homePanel">
            <div className="homeSectionHeader">
              <div>
                <h2 className="sectionTitle">Последние события</h2>
                <p className="panelText">Что произошло в системе за последнее время.</p>
              </div>
            </div>

            <div className="homeEventsList">
              {recentEvents.map((item) => {
                const Icon = item.icon;

                return (
                  <article key={`${item.title}-${item.time}`} className="homeEventItem">
                    <div className="homeEventTimeline">
                      <span className={`homeEventIcon homeEventIcon-${item.tone}`}>
                        <Icon size={16} strokeWidth={2.1} />
                      </span>
                    </div>
                    <div className="homeEventBody">
                      <p>{item.title}</p>
                    </div>
                    <time className="homeEventTime">{item.time}</time>
                  </article>
                );
              })}
            </div>

            <Link href="/reports" className="homeInlineLink">
              Все события
              <ArrowRight size={16} strokeWidth={2.2} />
            </Link>
          </section>

          <section className="card homePanel">
            <div className="homeSectionHeader">
              <div>
                <h2 className="sectionTitle">Быстрые действия</h2>
                <p className="panelText">Переходы в те места, где чаще всего что-то делается.</p>
              </div>
            </div>

            <div className="homeQuickActions">
              {quickActions.map((item) => {
                const Icon = item.icon;

                return (
                  <Link key={item.title} href={item.href} className="homeQuickActionCard">
                    <span className="homeQuickActionIcon">
                      <Icon size={18} strokeWidth={2} />
                    </span>
                    <div className="homeQuickActionBody">
                      <strong>{item.title}</strong>
                      <p>{item.description}</p>
                    </div>
                    <ChevronRight size={18} strokeWidth={2.2} />
                  </Link>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      <div className="homeFooterNote">© 2026 Умный заказ. Все права защищены.</div>
    </div>
  );
}
