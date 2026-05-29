"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Archive,
  BarChart3,
  FileText,
  Home,
  Layers3,
  Package,
  ReceiptText,
  Settings2,
  Truck,
  Upload,
} from "lucide-react";
import { navigationItems, type NavigationItem } from "@/lib/navigation";

const SIDEBAR_WIDTH_STORAGE_KEY = "citadel-sidebar-width";
const SIDEBAR_MIN_WIDTH = 260;
const SIDEBAR_MAX_WIDTH = 340;
const SIDEBAR_DEFAULT_WIDTH = 260;

function clampSidebarWidth(value: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value));
}

function NavigationIcon({ icon }: { icon: NavigationItem["icon"] }) {
  switch (icon) {
    case "home":
      return <Home size={16} strokeWidth={1.9} />;
    case "orders":
      return <ReceiptText size={16} strokeWidth={1.9} />;
    case "invoices":
      return <FileText size={16} strokeWidth={1.9} />;
    case "smart":
      return (
        <svg className="smartNavIcon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9">
          <rect x="5.5" y="6.5" width="12" height="14" rx="2.4" />
          <path d="M9 6.5V5.7a2.5 2.5 0 0 1 5 0v.8" />
          <path d="M8.7 12.2h2.8" />
          <path d="M8.7 15.5h2.8" />
          <path d="m13.1 14.8 1.3 1.3 2.5-3" />
          <path d="M15.8 4.3c.7-1.2 1.9-2 3.4-2.1-.1 1.6-.9 2.8-2.2 3.5" />
        </svg>
      );
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
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") {
      return SIDEBAR_DEFAULT_WIDTH;
    }

    const storedWidth = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    const parsedWidth = Number(storedWidth);

    return Number.isFinite(parsedWidth) ? clampSidebarWidth(parsedWidth) : SIDEBAR_DEFAULT_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isResizing || typeof window === "undefined") {
      return;
    }

    function handlePointerMove(event: PointerEvent) {
      setSidebarWidth(clampSidebarWidth(event.clientX));
    }

    function handlePointerUp() {
      setIsResizing(false);
      document.body.classList.remove("sidebarResizing");
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.classList.remove("sidebarResizing");
    };
  }, [isResizing]);

  const sidebarScale = useMemo(() => {
    return (sidebarWidth - SIDEBAR_MIN_WIDTH) / (SIDEBAR_MAX_WIDTH - SIDEBAR_MIN_WIDTH);
  }, [sidebarWidth]);

  const sidebarStyle = useMemo(() => {
    return {
      "--sidebar-width": `${sidebarWidth}px`,
      "--sidebar-brand-size": `${(1.08 + sidebarScale * 0.12).toFixed(3)}rem`,
      "--sidebar-label-size": `${(0.98 + sidebarScale * 0.14).toFixed(3)}rem`,
      "--sidebar-help-title-size": `${(0.88 + sidebarScale * 0.16).toFixed(3)}rem`,
      "--sidebar-help-text-size": `${(0.78 + sidebarScale * 0.12).toFixed(3)}rem`,
      "--sidebar-item-gap": `${Math.round(14 + sidebarScale * 2)}px`,
      "--sidebar-item-height": `${Math.round(48 + sidebarScale * 4)}px`,
      "--sidebar-icon-size": `${Math.round(24 + sidebarScale * 2)}px`,
      "--sidebar-handle-opacity": isResizing ? 1 : 0,
    } as CSSProperties;
  }, [isResizing, sidebarScale, sidebarWidth]);

  function handleResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    if (typeof window !== "undefined" && window.innerWidth <= 900) {
      return;
    }

    event.preventDefault();
    setIsResizing(true);
    document.body.classList.add("sidebarResizing");
  }

  return (
    <aside className="sidebar" style={sidebarStyle}>
      <div className="sidebarBrand">
        <span className="sidebarBrandMark" aria-hidden="true">
          <svg viewBox="0 0 64 64" role="img">
            <rect className="logoBack" x="5" y="5" width="54" height="54" rx="16" />
            <path className="logoBasketHandle" d="M22 30c1.8-8.8 7.2-13 10-13s8.2 4.2 10 13" />
            <path className="logoBasket" d="M17 29h30l-4 20H21z" />
            <circle className="logoProduct logoProductLight" cx="25" cy="37" r="3.4" />
            <circle className="logoProduct logoProductDark" cx="33" cy="37" r="3.4" />
            <circle className="logoProduct logoProductLight" cx="41" cy="37" r="3.4" />
            <path className="logoCheck" d="m27 46 4.2 4.2L40.5 39" />
          </svg>
        </span>
        <div className="sidebarBrandText">
          <h1>Умный заказ</h1>
        </div>
      </div>

      <nav className="sidebarNav">
        {navigationItems.map((item) => {
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`navItem ${item.icon === "smart" ? "navItemSmart" : ""} ${isActive ? "navItemActive" : ""}`}
            >
              <span className="navItemIcon" aria-hidden="true">
                <NavigationIcon icon={item.icon} />
              </span>
              <span className="navItemLabel">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        className="sidebarResizeHandle"
        onPointerDown={handleResizeStart}
        aria-label="Изменить ширину боковой панели"
      />
    </aside>
  );
}
