"use client";

import Link from "next/link";
import type { Route } from "next";
import {
  ChevronRight,
  FileText,
  LayoutTemplate,
  Menu,
  MessageSquareText,
  Settings2,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";

export type SidebarSection =
  | "sites"
  | "builder"
  | "leads"
  | "content"
  | "team"
  | "settings";

const workspaceItems = [
  { id: "sites", href: "/", label: "我的站点", icon: LayoutTemplate },
  { id: "builder", href: "/templates", label: "AI 建站", icon: Sparkles },
  {
    id: "leads",
    href: "/leads",
    label: "询盘线索",
    icon: MessageSquareText,
    count: 4,
  },
  { id: "content", href: "/content", label: "内容与商品", icon: FileText },
] as const;

const manageItems = [
  { id: "team", href: "/settings#team", label: "团队协作", icon: Users },
  {
    id: "settings",
    href: "/settings",
    label: "工作区设置",
    icon: Settings2,
  },
] as const;

export function AppSidebar({ active }: { active: SidebarSection }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <button
        className="mobile-nav-trigger"
        type="button"
        aria-label="打开工作区导航"
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen(true)}
      >
        <Menu size={18} />
      </button>
      <button
        className={`mobile-sidebar-backdrop ${mobileOpen ? "open" : ""}`}
        type="button"
        aria-label="关闭工作区导航"
        onClick={() => setMobileOpen(false)}
      />
      <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
      <button
        className="mobile-sidebar-close"
        type="button"
        aria-label="关闭工作区导航"
        onClick={() => setMobileOpen(false)}
      >
        <X size={18} />
      </button>
      <Link href="/" className="brand" aria-label="Sitecraft AI 首页">
        <span className="brand-mark">S/</span> sitecraft
        <span style={{ color: "#9aa69d", fontSize: 9, marginLeft: -5 }}>
          AI
        </span>
      </Link>
      <div className="eyebrow" style={{ padding: "0 12px 9px" }}>
        workspace
      </div>
      <nav className="nav" aria-label="工作区导航">
        {workspaceItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              className={`nav-button ${active === item.id ? "active" : ""}`}
              href={item.href as Route}
              key={item.id}
              onClick={() => setMobileOpen(false)}
            >
              <Icon size={15} />
              {item.label}
              {"count" in item && (
                <span className="nav-count">{item.count}</span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="eyebrow" style={{ padding: "27px 12px 9px" }}>
        manage
      </div>
      <nav className="nav" aria-label="工作区管理">
        {manageItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              className={`nav-button ${active === item.id ? "active" : ""}`}
              href={item.href as Route}
              key={item.id}
              onClick={() => setMobileOpen(false)}
            >
              <Icon size={15} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="sidebar-spacer" />
      <div className="usage">
        <div className="eyebrow">当前套餐</div>
        <div className="usage-row">
          <span>AI 生成额度</span>
          <strong>34%</strong>
        </div>
        <div className="progress">
          <span />
        </div>
        <div style={{ color: "#8fa398", fontSize: 10, marginTop: 9 }}>
          本月已使用 3 / 10 次
        </div>
      </div>
      <Link
        className="profile"
        href={"/settings#profile" as Route}
        onClick={() => setMobileOpen(false)}
      >
        <div className="avatar">LY</div>
        <div>
          <div className="profile-name">Lydia Yang</div>
          <div className="profile-email">lydia@sitecraft.ai</div>
        </div>
        <ChevronRight
          size={14}
          color="#9aa69d"
          style={{ marginLeft: "auto" }}
        />
      </Link>
      </aside>
    </>
  );
}
