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

export type HomeOverviewHeroFact = {
  label: string;
  value: string;
  detail: string;
};

export type HomeOverviewWorkflowStat = {
  label: string;
  value: string;
  detail: string;
  tone: HomeTone;
};

export type HomeOverviewLossRow = {
  title: string;
  supplier: string;
  purchasePrice: string;
  bestPrice: string;
  quantity: string;
  loss: string;
  tone: HomeTone;
};

export type HomeOverviewAttentionItem = {
  title: string;
  description: string;
  value: string;
  tone: HomeTone;
  icon: HomeIconName;
};

export type HomeOverviewPayload = {
  periodLabel: string;
  summaryCards: HomeOverviewSummaryCard[];
  heroFacts: HomeOverviewHeroFact[];
  workflowStats: HomeOverviewWorkflowStat[];
  lossRows: HomeOverviewLossRow[];
  attentionItems: HomeOverviewAttentionItem[];
};
