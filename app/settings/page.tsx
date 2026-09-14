"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight, Globe2, Mail, ShieldCheck, Users } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { GenerationHealthPanel } from "@/components/generation-health-panel";

export default function SettingsPage() {
  // 从 URL 读 siteKey，供侧边栏显示真实询盘角标（无则显示"未选择站点"）
  const [siteKey, setSiteKey] = useState<string | undefined>(undefined);
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("siteKey")?.trim();
    if (value) setSiteKey(value);
  }, []);

  return (
    <div className="app-shell">
      <AppSidebar active="settings" siteKey={siteKey} />
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            <Link href="/">Workspace</Link>
            <ChevronRight size={12} />
            <strong>工作区设置</strong>
          </div>
        </header>
        <div className="page-content data-page">
          <div className="data-page-head">
            <div>
              <div className="eyebrow">Workspace / Settings</div>
              <h1>工作区设置</h1>
              <p>当前工作区信息与运行状态。</p>
            </div>
          </div>
          <GenerationHealthPanel />
          {/*
            2026-09-10：此前这一页有 4 个**点了没反应**的按钮（保存设置 / 编辑 / 查看成员 / 管理），
            全文 `onClick` 出现 0 次；文案却承诺「管理品牌、通知、成员和发布默认值」。
            代建模式下「一客一项目」，没有多租户/团队/自助配置的真实需求，
            因此按「**要么实现、要么删除**」处理：删掉没有后端的按钮，
            并把文案改成与实现一致的说明（保留真正可用的「查看线索」入口）。
          */}
          <div className="settings-grid">
            <section className="settings-section" id="profile">
              <div className="settings-icon"><Globe2 size={17} /></div>
              <div>
                <h2>品牌与区域</h2>
                <p>站点品牌在「工作台」按项目设置（公司名、Logo、首屏主视觉）；后台界面为中文、中国标准时间。</p>
              </div>
            </section>
            <section className="settings-section">
              <div className="settings-icon"><Mail size={17} /></div>
              <div>
                <h2>询盘通知</h2>
                <p>新询盘会保存到线索工作台；邮件通知尚未配置。</p>
              </div>
              <Link className="secondary-button" href="/leads">查看线索</Link>
            </section>
            <section className="settings-section" id="team">
              <div className="settings-icon"><Users size={17} /></div>
              <div>
                <h2>团队协作</h2>
                <p>单所有者工作区。代建模式下一客一项目，暂未开放成员与角色管理。</p>
              </div>
            </section>
            <section className="settings-section">
              <div className="settings-icon"><ShieldCheck size={17} /></div>
              <div>
                <h2>隐私与安全</h2>
                <p>询盘表单已内置蜜罐反垃圾与提交幂等；站点限流与审计日志尚未实现。</p>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
