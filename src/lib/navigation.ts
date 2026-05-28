export type NavigationItem = {
  href: string;
  label: string;
  icon:
    | "home"
    | "orders"
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
  { href: "/", label: "Дашборд", icon: "home" },
  { href: "/suppliers", label: "Поставщики", icon: "suppliers" },
  { href: "/products", label: "Товары", icon: "products" },
  { href: "/orders", label: "Заказы", icon: "orders" },
  { href: "/invoice-upload", label: "Загрузка накладных", icon: "upload" },
  { href: "/smart-order", label: "Умный заказ", icon: "smart" },
  { href: "/catalog", label: "Catalog", icon: "catalog" },
  { href: "/categories", label: "Категории", icon: "categories" },
  { href: "/reports", label: "Отчёты", icon: "reports" },
  { href: "/archive", label: "Архив", icon: "archive" },
  { href: "/settings", label: "Настройки", icon: "settings" },
];
