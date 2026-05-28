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
  { href: "/", label: "Главная", icon: "home" },
  { href: "/orders", label: "Заказы", icon: "orders" },
  { href: "/invoice-upload", label: "Загрузка накладных", icon: "upload" },
  { href: "/smart-order", label: "Умный заказ", icon: "smart" },
  { href: "/suppliers", label: "Поставщики", icon: "suppliers" },
  { href: "/catalog", label: "Прайсы", icon: "catalog" },
  { href: "/products", label: "Товары", icon: "products" },
  { href: "/categories", label: "Каталог", icon: "categories" },
  { href: "/reports", label: "Отчеты", icon: "reports" },
  { href: "/settings", label: "Настройки", icon: "settings" },
];
