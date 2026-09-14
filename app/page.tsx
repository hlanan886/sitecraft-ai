"use client";

import Link from "next/link";
import type { Route } from "next";
import {
  ArrowUpRight,
  ChevronRight,
  FileText,
  Globe2,
  LayoutTemplate,
  MessageSquareText,
  Plus,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";

/**
 * 首页「我的站点」。
 *
 * **2026-09-10 从演示态改为真实数据**。此前这一页全是写死的：
 *  - `sites` 硬编码 3 个不存在的站点（Forge Industrial / Northstar Robotics / Morrow Advisory）
 *  - KPI `03 / 24 / 18` 与「↑ 比上月多 18%」是常量
 *  - 「最近动态」3 条是编的
 *  - 站点卡链接写成 `site.name === "Forge Industrial" ? "/workspace" : "/workspace"`（两边相同）
 *
 * 产品后果（评审原话）：**用户建完站回首页看不到自己的站**——信任级缺陷，
 * 比功能缺失更伤，因为用户会怀疑「我刚才做的那个站去哪了」。
 *
 * 现在：站点列表读 `GET /api/sites`（真实工作区数据）；无站点时给空状态引导；
 * 拿不到真实数据的 KPI / 动态**整块移除**，而不是继续编数字。
 */
type SiteItem = {
  id: string;
  name: string;
  templateId: string;
  locale: "zh" | "en";
  revision: number;
  updatedAt: string;
};

/** 相对时间（避免把"2 分钟前"写死）。 */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

/** 站点缩略图：用模板配色生成，避免依赖演示常量。 */
function SiteThumb({ site }: { site: SiteItem }) {
  return (
    <div className="site-thumb" style={{ background: "linear-gradient(135deg, #1f3b2c, #2e6b4f)" }}>
      <div className="thumb-grid">
        <div className="thumb-nav">
          <span>◼ {(site.name || site.id).split(" ")[0]}</span>
          <span>{site.templateId}</span>
        </div>
        <div className="thumb-title">
          <span style={{ display: "block" }}>{site.name || site.id}</span>
        </div>
        <div className="thumb-lines">
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [sites, setSites] = useState<SiteItem[] | null>(null);
  /** 工作区**全部**站点数——与下面只显示若干个的列表分开，卡片上的"站点总数"要的是它。 */
  const [totalSites, setTotalSites] = useState(0);

  useEffect(() => {
    /* 2026-09-14：首页只要**最近几个**。此前拉全量（实测工作区 485 个站，
     * 绝大多数是 e2e 造的测试数据），页面被无用历史站淹没。
     * `listSites()` 已按 updatedAt 倒序 → 取前 6 即"最近 6 个"。 */
    fetch("/api/sites?limit=6", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("sites_unavailable"))))
      .then((payload: { sites?: SiteItem[]; total?: number }) => {
        setSites(payload.sites ?? []);
        setTotalSites(typeof payload.total === "number" ? payload.total : (payload.sites ?? []).length);
      })
      .catch(() => setSites([]));
  }, []);

  const siteCount = totalSites;
  /** 站点确实比展示的多时才提示——否则"还有 N 个"会误导。 */
  const hiddenCount = Math.max(0, totalSites - (sites?.length ?? 0));

  return (
    <div className="app-shell">
      <AppSidebar active="sites" />
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <ChevronRight size={12} />
            <strong>我的站点</strong>
          </div>
          <div className="top-actions">
            <Link href="/templates" className="primary-button">
              <Plus size={15} />
              新建站点
            </Link>
          </div>
        </header>
        <div className="page-content">
          <div className="hero-row">
            <div>
              <div className="eyebrow">Site studio</div>
              <h1>
                把你的能力，
                <br />
                <span style={{ color: "#2e6b4f" }}>变成一座网站。</span>
              </h1>
              <p>用一段对话开始。选择一个方向，剩下的交给 AI。</p>
            </div>
            <Link href={"/generate" as Route} className="primary-button new-site-button">
              <WandSparkles size={15} />
              开始一个新项目 <ArrowUpRight size={14} />
            </Link>
          </div>

          {/* KPI 只保留**能由真实数据推出**的两项；「询盘数 / 已发布页数」没有全局数据源，不再编造。 */}
          <div className="stats">
            <div className="stat-card">
              <div className="stat-label">
                <span>站点总数</span>
                <LayoutTemplate size={14} />
              </div>
              <div className="stat-value">{sites === null ? "—" : String(siteCount).padStart(2, "0")}</div>
              <div className="stat-note">{sites === null ? "正在读取…" : siteCount === 0 ? "还没有站点" : "当前工作区"}</div>
            </div>
          </div>

          <div className="section-heading">
            <h2>最近打开的站点</h2>
            {hiddenCount > 0 && (
              <span className="section-hint">
                仅显示最近 {sites?.length ?? 0} 个，还有 {hiddenCount} 个未显示
              </span>
            )}
          </div>

          {sites === null ? (
            <p className="modal-copy">正在读取站点列表…</p>
          ) : sites.length === 0 ? (
            /* 空状态：此前这里永远显示 3 个假站点，用户永远看不到"我还没有站"这个事实 */
            <div className="empty-sites">
              <LayoutTemplate size={26} />
              <strong>还没有站点</strong>
              <span>用一句话描述你的业务，AI 会选好模板并写好全部内容。</span>
              <Link href={"/generate" as Route} className="primary-button">
                <Sparkles size={14} /> 开始建站
              </Link>
            </div>
          ) : (
            <div className="site-grid" id="recent-sites">
              {sites.map((site) => (
                <Link
                  href={`/workspace?siteId=${encodeURIComponent(site.id)}`}
                  className="site-card"
                  key={site.id}
                >
                  <SiteThumb site={site} />
                  <div className="site-card-body">
                    <div className="site-title">
                      <strong>{site.name || site.id}</strong>
                      <span className="site-status">● 草稿 v{site.revision}</span>
                    </div>
                    <div className="site-meta">模板 {site.templateId} · {site.locale === "en" ? "英文站" : "中文站"}</div>
                    <div className="site-card-footer">
                      <span>最后编辑 {relativeTime(site.updatedAt)}</span>
                      <span className="tiny-action">
                        打开工作台{" "}
                        <ArrowUpRight size={11} style={{ verticalAlign: "middle" }} />
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* 「最近动态」此前 3 条全是编的，且没有真实事件流数据源 —— 整块移除，换成确定的快捷入口。 */}
          <div className="activity-panel">
            <div className="panel">
              <div className="section-heading">
                <h2>快速开始</h2>
              </div>
              <div className="quick-list">
                <Link href={"/generate" as Route} className="quick-item">
                  <MessageSquareText size={14} />
                  用一句话生成一个网站
                  <ArrowUpRight size={12} style={{ marginLeft: "auto" }} />
                </Link>
                <Link href="/templates" className="quick-item">
                  <WandSparkles size={14} />
                  从模板开始一个站点
                  <ArrowUpRight size={12} style={{ marginLeft: "auto" }} />
                </Link>
                <Link href="/workspace?import=products" className="quick-item" style={{ textAlign: "left" }}>
                  <FileText size={14} />
                  上传商品表格
                  <ArrowUpRight size={12} style={{ marginLeft: "auto" }} />
                </Link>
                <Link href={"/leads" as Route} className="quick-item" style={{ textAlign: "left" }}>
                  <MessageSquareText size={14} />
                  查看未处理询盘
                  <ArrowUpRight size={12} style={{ marginLeft: "auto" }} />
                </Link>
              </div>
            </div>
            <div className="panel">
              <div className="section-heading">
                <h2>交付流程</h2>
              </div>
              <div className="quick-list">
                <span className="quick-item"><Sparkles size={14} />生成初稿</span>
                <span className="quick-item"><Globe2 size={14} />在工作台改内容与图片</span>
                <span className="quick-item"><FileText size={14} />发布并交付公开链接</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
