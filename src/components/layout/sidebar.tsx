"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Archive,
  BarChart3,
  CircleHelp,
  Home,
  Layers3,
  Package,
  ReceiptText,
  Settings2,
  Sparkles,
  Truck,
  Upload,
} from "lucide-react";
import { navigationItems, type NavigationItem } from "@/lib/navigation";

function NavigationIcon({ icon }: { icon: NavigationItem["icon"] }) {
  switch (icon) {
    case "home":
      return <Home size={16} strokeWidth={1.9} />;
    case "orders":
      return <ReceiptText size={16} strokeWidth={1.9} />;
    case "smart":
      return <Sparkles size={16} strokeWidth={1.9} />;
    case "suppliers":
      return <Truck size={16} strokeWidth={1.9} />;
    case "upload":
      return <Upload size={16} strokeWidth={1.9} />;
    case "products":
      return <Package size={16} strokeWidth={1.9} />;
    case "catalog":
      return <Layers3 size={16} strokeWidth={1.9} />;
    case "categories":
      return <Layers3 size={16} strokeWidth={1.9} />;
    case "reports":
      return <BarChart3 size={16} strokeWidth={1.9} />;
    case "archive":
      return <Archive size={16} strokeWidth={1.9} />;
    case "settings":
      return <Settings2 size={16} strokeWidth={1.9} />;
  }
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="sidebarBrand">
        <span className="sidebarBrandMark" aria-hidden="true">
          <img src="/smart-order-mark.png" alt="" />
        </span>
        <div className="sidebarBrandText">
          <h1>Умный заказ</h1>
        </div>
      </div>

      <nav className="sidebarNav">
        {navigationItems.map((item) => {
          const isActive = pathname === item.href;

          return (
            <Link key={item.href} href={item.href} className={`navItem ${isActive ? "navItemActive" : ""}`}>
              <span className="navItemIcon" aria-hidden="true">
                <NavigationIcon icon={item.icon} />
              </span>
              <span className="navItemLabel">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="sidebarHelpCard">
        <span className="sidebarHelpIcon" aria-hidden="true">
          <CircleHelp size={15} strokeWidth={2} />
        </span>
        <strong>Нужна помощь?</strong>
        <p>Напишите нам, если возникли вопросы по работе с умным заказом.</p>
      </div>
    </aside>
  );
}
