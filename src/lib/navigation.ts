export type NavigationItem = {
  href: string;
  label: string;
  children?: Array<{
    href: string;
    label: string;
  }>;
  icon:
    | "home"
    | "orders"
    | "invoices"
    | "smart"
    | "suppliers"
    | "upload"
    | "products"
    | "catalog"
    | "categories"
    | "reports"
    | "archive"
    | "settings";
};

export const navigationItems: NavigationItem[] = [
  { href: "/", label: "Главная", icon: "home" },
  { href: "/orders", label: "Заказы", icon: "orders" },
  {
    href: "/invoices",
    label: "Накладные",
    icon: "invoices",
    children: [
      { href: "/invoices", label: "Загрузка" },
      { href: "/invoices/archive", label: "Подтверждённые" },
    ],
  },
  { href: "/smart-order", label: "Умный заказ", icon: "smart" },
  { href: "/suppliers", label: "Поставщики", icon: "suppliers" },
  { href: "/catalog", label: "Прайсы", icon: "catalog" },
  { href: "/products", label: "Товары", icon: "products" },
  { href: "/categories", label: "Каталог", icon: "categories" },
  {
    href: "/reports",
    label: "Отчеты",
    icon: "reports",
    children: [
      { href: "/reports/price-changes", label: "Изменение цен" },
      { href: "/reports/overview", label: "Аудит каталога" },
    ],
  },
  { href: "/settings", label: "Настройки", icon: "settings" },
];
