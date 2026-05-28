"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useMemo, useState } from "react";
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
  Truck,
  Upload,
} from "lucide-react";
import { navigationItems, type NavigationItem } from "@/lib/navigation";

const SIDEBAR_WIDTH_STORAGE_KEY = "citadel-sidebar-width";
const SIDEBAR_MIN_WIDTH = 196;
const SIDEBAR_MAX_WIDTH = 340;
const SIDEBAR_DEFAULT_WIDTH = 196;

function clampSidebarWidth(value: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value));
}

function NavigationIcon({ icon }: { icon: NavigationItem["icon"] }) {
  switch (icon) {
    case "home":
      return <Home size={16} strokeWidth={1.9} />;
    case "orders":
      return <ReceiptText size={16} strokeWidth={1.9} />;
    case "smart":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9">
          <path d="M6.5 8.5h9a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z" />
          <path d="M9 8.5V7a3 3 0 0 1 5.2-2" />
          <path d="m9.4 13 1.8 1.8 3.6-3.6" />
          <path d="M16.9 5.1c.6-1.2 1.7-2 3.1-2.1-.1 1.5-.8 2.8-2.1 3.5" />
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
      "--sidebar-brand-size": `${(0.94 + sidebarScale * 0.22).toFixed(3)}rem`,
      "--sidebar-label-size": `${(0.83 + sidebarScale * 0.24).toFixed(3)}rem`,
      "--sidebar-help-title-size": `${(0.88 + sidebarScale * 0.16).toFixed(3)}rem`,
      "--sidebar-help-text-size": `${(0.78 + sidebarScale * 0.12).toFixed(3)}rem`,
      "--sidebar-item-gap": `${Math.round(8 + sidebarScale * 6)}px`,
      "--sidebar-item-height": `${Math.round(38 + sidebarScale * 8)}px`,
      "--sidebar-icon-size": `${Math.round(17 + sidebarScale * 2)}px`,
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

      <div className="sidebarHelpCard">
        <span className="sidebarHelpIcon" aria-hidden="true">
          <CircleHelp size={15} strokeWidth={2} />
        </span>
        <strong>Нужна помощь?</strong>
        <p>Напишите нам, если возникли вопросы по работе с умным заказом.</p>
      </div>

      <button
        type="button"
        className="sidebarResizeHandle"
        onPointerDown={handleResizeStart}
        aria-label="Изменить ширину боковой панели"
      />
    </aside>
  );
}
