export type HomeIconName =
  | "upload"
  | "badgePercent"
  | "building2"
  | "fileSpreadsheet"
  | "package"
  | "receiptText"
  | "shoppingCart"
  | "triangleAlert"
  | "trendingUp";

export type HomeTone = "danger" | "warning" | "success" | "accent" | "neutral" | "violet";

export type HomeOverviewSummaryCard = {
  label: string;
  value: string;
  detail: string;
  tone: HomeTone;
  icon: HomeIconName;
};

export type HomeOverviewFocusItem = {
  title: string;
  description: string;
  badge: string;
  href: string;
  tone: HomeTone;
  icon: HomeIconName;
};

export type HomeOverviewRecentEvent = {
  title: string;
  time: string;
  tone: HomeTone;
  icon: HomeIconName;
};

export type HomeOverviewPayload = {
  summaryCards: HomeOverviewSummaryCard[];
  focusItems: HomeOverviewFocusItem[];
  recentEvents: HomeOverviewRecentEvent[];
};
