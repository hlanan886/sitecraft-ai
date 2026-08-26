import Link from "next/link";
import { ChevronRight, Filter, Mail, MessageSquareText } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";

const leads = [
  {
    company: "Keller Automation GmbH",
    contact: "Martin Keller",
    country: "Germany",
    subject: "高精度模块年度采购询价",
    time: "今天 10:24",
    status: "新询盘",
  },
  {
    company: "Nordic Process AB",
    contact: "Elin Berg",
    country: "Sweden",
    subject: "需要 FM-2403 技术资料与交期",
    time: "昨天 16:08",
    status: "新询盘",
  },
  {
    company: "Aster Components",
    contact: "James Wu",
    country: "Singapore",
    subject: "复合材料组件定制需求",
    time: "8 月 19 日",
    status: "已联系",
  },
  {
    company: "Grupo Vector",
    contact: "Sofia Mendez",
    country: "Mexico",
    subject: "寻求拉美区域经销合作",
    time: "8 月 18 日",
    status: "新询盘",
  },
];

export default function LeadsPage() {
  return (
    <div className="app-shell">
      <AppSidebar active="leads" />
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            <Link href="/">Workspace</Link>
            <ChevronRight size={12} />
            <strong>询盘线索</strong>
          </div>
          <button className="secondary-button">
            <Filter size={14} /> 筛选
          </button>
        </header>
        <div className="page-content data-page">
          <div className="data-page-head">
            <div>
              <div className="eyebrow">Leads / Inbox</div>
              <h1>询盘线索</h1>
              <p>集中处理官网联系表单和商品询价。</p>
            </div>
            <div className="data-kpi">
              <MessageSquareText size={18} />
              <strong>4</strong>
              <span>待处理</span>
            </div>
          </div>
          <div className="data-table">
            <div className="data-row data-row-head">
              <span>客户</span>
              <span>需求</span>
              <span>时间</span>
              <span>状态</span>
            </div>
            {leads.map((lead) => (
              <article className="data-row" key={`${lead.company}-${lead.subject}`}>
                <div>
                  <strong>{lead.company}</strong>
                  <small>{lead.contact} · {lead.country}</small>
                </div>
                <div>
                  <span>{lead.subject}</span>
                  <small className="row-action"><Mail size={11} /> 查看邮件与留言</small>
                </div>
                <span>{lead.time}</span>
                <span className={`lead-status ${lead.status === "新询盘" ? "new" : ""}`}>
                  {lead.status}
                </span>
              </article>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
