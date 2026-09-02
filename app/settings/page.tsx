import Link from "next/link";
import { ChevronRight, Globe2, Mail, ShieldCheck, Users } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { GenerationHealthPanel } from "@/components/generation-health-panel";

export default function SettingsPage() {
  return (
    <div className="app-shell">
      <AppSidebar active="settings" />
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            <Link href="/">Workspace</Link>
            <ChevronRight size={12} />
            <strong>工作区设置</strong>
          </div>
          <button className="primary-button">保存设置</button>
        </header>
        <div className="page-content data-page">
          <div className="data-page-head">
            <div>
              <div className="eyebrow">Workspace / Settings</div>
              <h1>工作区设置</h1>
              <p>管理品牌、通知、成员和发布默认值。</p>
            </div>
          </div>
          <GenerationHealthPanel />
          <div className="settings-grid">
            <section className="settings-section" id="profile">
              <div className="settings-icon"><Globe2 size={17} /></div>
              <div>
                <h2>品牌与区域</h2>
                <p>Sitecraft Studio · 中国标准时间 · 中文后台</p>
              </div>
              <button className="secondary-button">编辑</button>
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
                <p>当前 1 名所有者，首版仅开放 Owner 角色。</p>
              </div>
              <button className="secondary-button">查看成员</button>
            </section>
            <section className="settings-section">
              <div className="settings-icon"><ShieldCheck size={17} /></div>
              <div>
                <h2>隐私与安全</h2>
                <p>表单隐私同意、站点限流和审计日志。</p>
              </div>
              <button className="secondary-button">管理</button>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
