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
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

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
  },
  { id: "content", href: "/content", label: "内容与商品", icon: FileText },
] as const;

const manageItems = [
  { id: "settings", href: "/settings", label: "工作区设置", icon: Settings2 },
] as const;

/**
 * 侧边栏。
 *
 * 2026-09-10 去假数据：此前询盘角标硬编码 `count: 4`、底部「AI 生成额度 34% · 本月已使用 3/10 次」
 * 全是常量、身份也写死成 `Lydia Yang / lydia@sitecraft.ai`——用户会以为那是自己的真实账户，
 * 属于「比缺失更伤信任」的演示态。
 *
 * 处理原则（要么接真数据、要么移除）：
 *  - **询盘角标**：接 `/api/leads` 的真实 `newCount`，无数据则不显示角标；
 *  - **AI 额度**：代建模式下没有配额体系（一客一项目），**整块移除**而不是编一个数字；
 *  - **用户身份**：没有账户体系，改为显示中性的「工作区」标识。
 */
export function AppSidebar({ active, siteKey }: { active: SidebarSection; siteKey?: string }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [newLeadCount, setNewLeadCount] = useState<number | null>(null);

  // 真实询盘角标：仅有 siteKey 时查询；失败则静默不显示（不编造数字）
  useEffect(() => {
    if (!siteKey) {
      setNewLeadCount(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/leads?siteKey=${encodeURIComponent(siteKey)}&status=new&limit=100`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("unavailable"))))
      .then((payload: { newCount?: number }) => {
        if (!cancelled) setNewLeadCount(typeof payload.newCount === "number" ? payload.newCount : null);
      })
      .catch(() => {
        if (!cancelled) setNewLeadCount(null);
      });
    return () => { cancelled = true; };
  }, [siteKey]);

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
              {item.id === "leads" && newLeadCount !== null && newLeadCount > 0 && (
                <span className="nav-count">{newLeadCount > 99 ? "99+" : newLeadCount}</span>
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
      {/*
        2026-09-10：「AI 生成额度 34% · 本月已使用 3/10 次」整块移除。
        代建模式没有配额体系（一客一项目，合同约定即可），这个进度条是编出来的数字，
        会让用户以为存在真实额度限制。需要时再接真实统计（lib/generation-record.ts 有指标）。
      */}
      <Link
        className="profile"
        href={"/settings" as Route}
        onClick={() => setMobileOpen(false)}
      >
        <div className="avatar">WS</div>
        <div>
          <div className="profile-name">当前工作区</div>
          <div className="profile-email">{siteKey ? `站点 ${siteKey}` : "未选择站点"}</div>
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
