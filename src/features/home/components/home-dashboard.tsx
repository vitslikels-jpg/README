"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, BadgePercent, Building2, ChevronRight, FileSpreadsheet, Package, ReceiptText, ShoppingCart, TriangleAlert, TrendingUp, Upload } from "lucide-react";
import { EnterpriseManager } from "@/features/enterprises/components/enterprise-manager";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";
import type {
  HomeIconName,
  HomeOverviewPayload,
  HomeOverviewRecentEvent,
  HomeOverviewSummaryCard,
} from "@/features/home/types";

type HomeAction = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
};

const iconMap: Record<HomeIconName, LucideIcon> = {
  upload: Upload,
  badgePercent: BadgePercent,
  building2: Building2,
  fileSpreadsheet: FileSpreadsheet,
  package: Package,
  receiptText: ReceiptText,
  shoppingCart: ShoppingCart,
  triangleAlert: TriangleAlert,
  trendingUp: TrendingUp,
};

const todayActions: HomeAction[] = [
  {
    title: "Разобрать новый прайс",
    description: "Загрузка и разбор",
    href: "/invoice-upload",
    icon: Upload,
  },
  {
    title: "Посмотреть все цены",
    description: "Каталог и сравнение",
    href: "/catalog",
    icon: FileSpreadsheet,
  },
  {
    title: "Товары по поставщикам",
    description: "Текущие позиции",
    href: "/products",
    icon: Package,
  },
];

const emptyOverview: HomeOverviewPayload = {
  summaryCards: [],
  focusItems: [],
  recentEvents: [],
};

function HomeSummaryCard({ item }: { item: HomeOverviewSummaryCard }) {
  const Icon = iconMap[item.icon];

  return (
    <article className="homeSummaryCard">
      <div className="homeSummaryTop">
        <span className={`homeSummaryIcon homeSummaryIcon-${item.tone}`}>
          <Icon size={20} strokeWidth={2} />
        </span>
      </div>
      <span className="homeSummaryLabel">{item.label}</span>
      <strong className="homeSummaryValue">{item.value}</strong>
      <span className="homeSummaryDetail">{item.detail}</span>
    </article>
  );
}

function HomeEvents({ recentEvents }: { recentEvents: HomeOverviewRecentEvent[] }) {
  if (recentEvents.length === 0) {
    return (
      <div className="emptyState">
        <p className="emptyStateTitle">Событий пока нет</p>
        <p className="emptyStateText">Загрузите хотя бы один прайс, и здесь появятся свежие изменения.</p>
      </div>
    );
  }

  return (
    <div className="homeEventsList">
      {recentEvents.map((item) => {
        const Icon = iconMap[item.icon];

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
          throw new Error("Не удалось получить сводку по прайсам.");
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

  const visibleOverview = activeEnterpriseId ? overview : emptyOverview;

  return (
    <div className="pageStack homeDashboard">
      <section className="heroCard homeHero">
        <div className="homeHeroCopy">
          <p className="panelEyebrow">Главная</p>
          <h1 className="homeHeroTitle">Прайсы и сравнение цен</h1>
          <div className="homeHeroEnterpriseInline">
            <span className="homeHeroEnterpriseLabel">Активное предприятие</span>
            <strong>{activeEnterprise?.name ?? "Предприятие не выбрано"}</strong>
            <span className="homeHeroEnterpriseMeta">
              {activeEnterprise
                ? `${activeEnterprise.address} • ${activeEnterprise.phone}`
                : enterprises.length === 0
                  ? "Сначала добавьте предприятие в систему."
                  : "Выберите предприятие в верхней панели."}
            </span>
          </div>
        </div>
      </section>

      {errorMessage ? <p className="errorText">{errorMessage}</p> : null}

      <section className="card homePanel">
        <div className="homeSectionHeader">
          <div>
            <h2 className="sectionTitle">Сводка по прайсам</h2>
            <p className="panelText">Только текущие прайсы, позиции и реальные ценовые разницы.</p>
          </div>
          <span className="statusPill">{isLoading ? "Обновляю..." : "Актуально"}</span>
        </div>

        {visibleOverview.summaryCards.length === 0 && !isLoading ? (
          <div className="emptyState">
            <p className="emptyStateTitle">Пока мало данных</p>
            <p className="emptyStateText">Загрузите хотя бы два прайса от разных поставщиков, чтобы увидеть сравнение цен.</p>
          </div>
        ) : (
          <div className="homeSummaryGrid">
            {visibleOverview.summaryCards.map((item) => (
              <HomeSummaryCard key={item.label} item={item} />
            ))}
          </div>
        )}
      </section>

      <div className="homeDashboardGrid">
        <div className="homeDashboardMain">
          <section className="card homePanel">
            <div className="homeSectionHeader">
              <div>
                <h2 className="sectionTitle">Быстрые действия</h2>
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
                <h2 className="sectionTitle">Где сейчас лучшая цена</h2>
                <p className="panelText">Только те позиции, где уже есть хотя бы два актуальных предложения.</p>
              </div>
            </div>

            {visibleOverview.focusItems.length === 0 && !isLoading ? (
              <div className="emptyState">
                <p className="emptyStateTitle">Сравнивать пока нечего</p>
                <p className="emptyStateText">Нужно минимум два текущих прайса с уже сопоставленными товарами.</p>
              </div>
            ) : (
              <div className="homeFocusList">
                {visibleOverview.focusItems.map((item) => {
                  const Icon = iconMap[item.icon];

                  return (
                    <Link
                      key={`${item.title}-${item.badge}`}
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
            )}
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
                <h2 className="sectionTitle">Последние изменения</h2>
                <p className="panelText">Загрузки прайсов, предупреждения и заметные изменения по ценам.</p>
              </div>
            </div>

            <HomeEvents recentEvents={visibleOverview.recentEvents} />

            <Link href="/suppliers" className="homeInlineLink">
              Открыть прайсы поставщиков
              <ArrowRight size={16} strokeWidth={2.2} />
            </Link>
          </section>
        </div>
      </div>

      <div className="homeFooterNote">© 2026 Умный заказ. Главная страница показывает только реальные данные по прайсам.</div>
    </div>
  );
}
