"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  ChevronRight,
  Clock3,
  FileText,
  Globe2,
  LayoutTemplate,
  MessageSquareText,
  Plus,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";

const sites = [
  {
    name: "Forge Industrial",
    industry: "工业制造 · 产品目录",
    updated: "2 分钟前",
    status: "已发布",
    colors: ["#194c38", "#b9f56b"],
    title: "Built for the\nnext standard.",
  },
  {
    name: "Northstar Robotics",
    industry: "科技企业 · 解决方案",
    updated: "昨天 18:42",
    status: "草稿",
    colors: ["#34256a", "#d9f36b"],
    title: "Make complexity\nuseful.",
  },
  {
    name: "Morrow Advisory",
    industry: "专业服务 · 案例展示",
    updated: "8 月 18 日",
    status: "已发布",
    colors: ["#6e3e2d", "#edb48b"],
    title: "Good work,\nmade visible.",
  },
];

function SiteThumb({ site }: { site: (typeof sites)[number] }) {
  return (
    <div
      className="site-thumb"
      style={{
        background: `linear-gradient(135deg, ${site.colors[0]}, ${site.colors[0]}dd)`,
      }}
    >
      <div className="thumb-grid">
        <div className="thumb-nav">
          <span>◼ {site.name.split(" ")[0]}</span>
          <span>ABOUT&nbsp;&nbsp; WORK&nbsp;&nbsp; CONTACT</span>
        </div>
        <div className="thumb-title">
          {site.title.split("\n").map((line) => (
            <span key={line} style={{ display: "block" }}>
              {line}
            </span>
          ))}
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
            <button className="icon-button" aria-label="通知">
              <Clock3 size={15} />
            </button>
            <Link href="/templates" className="primary-button">
              <Plus size={15} />
              新建站点
            </Link>
          </div>
        </header>
        <div className="page-content">
          <div className="hero-row">
            <div>
              <div className="eyebrow">Site studio / 08.21</div>
              <h1>
                把你的能力，
                <br />
                <span style={{ color: "#2e6b4f" }}>变成一座网站。</span>
              </h1>
              <p>用一段对话开始。选择一个方向，剩下的交给 AI。</p>
            </div>
            <Link href="/templates" className="primary-button new-site-button">
              <WandSparkles size={15} />
              开始一个新项目 <ArrowUpRight size={14} />
            </Link>
            <Link href={"/generate" as Route} className="secondary-button new-site-button" style={{ marginLeft: 10 }}>
              <MessageSquareText size={15} />
              用一句话开始
            </Link>
          </div>
          <div className="stats">
            <div className="stat-card">
              <div className="stat-label">
                <span>站点总数</span>
                <LayoutTemplate size={14} />
              </div>
              <div className="stat-value">03</div>
              <div className="stat-note">↑ 这个月新增 1 个</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">
                <span>收到的询盘</span>
                <MessageSquareText size={14} />
              </div>
              <div className="stat-value">24</div>
              <div className="stat-note">↑ 比上月多 18%</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">
                <span>已发布页面</span>
                <Globe2 size={14} />
              </div>
              <div className="stat-value">18</div>
              <div className="stat-note">全部运行正常</div>
            </div>
          </div>
          <div className="section-heading">
            <h2>最近的站点</h2>
            <a className="section-link" href="#recent-sites">
              查看全部{" "}
              <ArrowUpRight size={12} style={{ verticalAlign: "middle" }} />
            </a>
          </div>
          <div className="site-grid" id="recent-sites">
            {sites.map((site) => (
              <Link
                href={
                  site.name === "Forge Industrial" ? "/workspace" : "/workspace"
                }
                className="site-card"
                key={site.name}
              >
                <SiteThumb site={site} />
                <div className="site-card-body">
                  <div className="site-title">
                    <strong>{site.name}</strong>
                    <span className="site-status">● {site.status}</span>
                  </div>
                  <div className="site-meta">{site.industry}</div>
                  <div className="site-card-footer">
                    <span>最后编辑 {site.updated}</span>
                    <span className="tiny-action">
                      打开工作台{" "}
                      <ArrowUpRight
                        size={11}
                        style={{ verticalAlign: "middle" }}
                      />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <div className="activity-panel">
            <div className="panel">
              <div className="section-heading">
                <h2>最近动态</h2>
                <Link className="section-link" href={"/leads" as Route}>
                  活动记录
                </Link>
              </div>
              <div className="activity-row">
                <div className="activity-icon">
                  <Sparkles size={14} />
                </div>
                <div className="activity-text">
                  <strong>AI 更新了 Forge Industrial 的首页</strong>
                  <span>“把产品能力放到首屏，并让标题更有工程感”</span>
                </div>
                <span className="activity-time">2 MIN</span>
              </div>
              <div className="activity-row">
                <div className="activity-icon">
                  <Globe2 size={14} />
                </div>
                <div className="activity-text">
                  <strong>Forge Industrial 发布了新版本</strong>
                  <span>forge-industrial.sites.ai</span>
                </div>
                <span className="activity-time">1 DAY</span>
              </div>
              <div className="activity-row">
                <div className="activity-icon">
                  <MessageSquareText size={14} />
                </div>
                <div className="activity-text">
                  <strong>收到来自 Germany 的新询盘</strong>
                  <span>Northstar Robotics · 产品询盘</span>
                </div>
                <span className="activity-time">2 DAY</span>
              </div>
            </div>
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
                <Link
                  href="/workspace?import=products"
                  className="quick-item"
                  style={{
                    textAlign: "left",
                  }}
                >
                  <FileText size={14} />
                  上传商品表格
                  <ArrowUpRight size={12} style={{ marginLeft: "auto" }} />
                </Link>
                <Link
                  href={"/leads" as Route}
                  className="quick-item"
                  style={{
                    textAlign: "left",
                  }}
                >
                  <MessageSquareText size={14} />
                  查看未处理询盘
                  <ArrowUpRight size={12} style={{ marginLeft: "auto" }} />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
