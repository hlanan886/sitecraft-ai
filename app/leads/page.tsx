"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Archive, CheckCircle2, ChevronRight, Filter, Mail, MessageSquareText, RefreshCw, X } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import type { LeadStatus } from "@/lib/lead-store";

type Lead = {
  id: string;
  siteKey: string;
  name: string;
  email: string;
  company: string;
  message: string;
  status: LeadStatus;
  source: string;
  createdAt: string;
  updatedAt: string;
};

type LeadResponse = { ok?: boolean; leads?: Lead[]; newCount?: number; error?: string };
const statusLabels: Record<LeadStatus, string> = { new: "新询盘", contacted: "已联系", archived: "已归档" };
const filters: Array<{ value: "all" | LeadStatus; label: string }> = [
  { value: "all", label: "全部" }, { value: "new", label: "新询盘" },
  { value: "contacted", label: "已联系" }, { value: "archived", label: "已归档" },
];

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

export default function LeadsPage() {
  const [siteKey, setSiteKey] = useState("demo");
  const [filter, setFilter] = useState<"all" | LeadStatus>("all");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [newCount, setNewCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("siteKey")?.trim();
    if (value) setSiteKey(value);
  }, []);

  const loadLeads = useCallback(async () => {
    setLoading(true); setError(null);
    const query = new URLSearchParams({ siteKey, limit: "100" });
    if (filter !== "all") query.set("status", filter);
    try {
      const response = await fetch(`/api/leads?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as LeadResponse | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "线索加载失败");
      setLeads(payload.leads ?? []); setNewCount(payload.newCount ?? 0);
    } catch {
      setError("线索暂时无法加载，请检查数据库连接后重试。"); setLeads([]);
    } finally { setLoading(false); }
  }, [filter, siteKey]);

  useEffect(() => { void loadLeads(); }, [loadLeads]);

  const updateStatus = async (lead: Lead, status: LeadStatus) => {
    if (updatingId) return;
    setUpdatingId(lead.id);
    try {
      const response = await fetch(`/api/leads/${encodeURIComponent(lead.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteKey, status }),
      });
      if (!response.ok) throw new Error("状态更新失败");
      await loadLeads();
      setSelectedLead((current) => current?.id === lead.id ? { ...lead, status } : current);
    } catch { setError("状态更新失败，请重试。"); }
    finally { setUpdatingId(null); }
  };

  return (
    <div className="app-shell">
      <AppSidebar active="leads" />
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs"><Link href="/">Workspace</Link><ChevronRight size={12} /><strong>询盘线索</strong></div>
          <button className="secondary-button" onClick={() => void loadLeads()} disabled={loading}><RefreshCw size={14} className={loading ? "spin" : ""} /> 刷新</button>
        </header>
        <div className="page-content data-page">
          <div className="data-page-head">
            <div><div className="eyebrow">Leads / {siteKey}</div><h1>询盘线索</h1><p>官网联系表单提交会实时保存到当前站点。</p></div>
            <div className="data-kpi"><MessageSquareText size={18} /><strong>{newCount}</strong><span>待处理</span></div>
          </div>
          <div className="leads-toolbar" role="group" aria-label="线索状态筛选"><Filter size={14} />{filters.map((item) => <button key={item.value} className={`filter ${filter === item.value ? "active" : ""}`} onClick={() => setFilter(item.value)}>{item.label}</button>)}<span className="leads-count">{leads.length} 条</span></div>
          {error ? <div className="leads-state leads-error" role="alert"><span>{error}</span><button className="secondary-button" onClick={() => void loadLeads()}><RefreshCw size={13} /> 重试</button></div>
            : loading ? <div className="leads-state" aria-busy="true">正在加载询盘…</div>
            : leads.length === 0 ? <div className="leads-state"><MessageSquareText size={20} /><strong>还没有符合条件的询盘</strong><span>客户提交联系表单后，会在这里显示。</span></div>
            : <div className="data-table">
              <div className="data-row data-row-head"><span>客户</span><span>需求</span><span>时间</span><span>状态</span></div>
              {leads.map((lead) => <article className="data-row lead-data-row" key={lead.id}>
                <button className="lead-cell-button" onClick={() => setSelectedLead(lead)}><strong>{lead.company || "个人客户"}</strong><small>{lead.name} · {lead.email}</small></button>
                <button className="lead-cell-button lead-message-cell" onClick={() => setSelectedLead(lead)}><span>{lead.message.length > 90 ? `${lead.message.slice(0, 90)}…` : lead.message}</span><small className="row-action"><Mail size={11} /> 查看完整留言</small></button>
                <span>{formatTime(lead.createdAt)}</span>
                <div className="lead-status-cell"><span className={`lead-status ${lead.status}`}>{statusLabels[lead.status]}</span>{lead.status === "new" ? <button className="icon-button" title="标记已联系" aria-label="标记已联系" disabled={updatingId === lead.id} onClick={() => void updateStatus(lead, "contacted")}><CheckCircle2 size={14} /></button> : lead.status === "contacted" ? <button className="icon-button" title="归档" aria-label="归档" disabled={updatingId === lead.id} onClick={() => void updateStatus(lead, "archived")}><Archive size={14} /></button> : null}</div>
              </article>)}
            </div>}
        </div>
      </main>
      {selectedLead ? <div className="modal-backdrop" role="presentation" onClick={() => setSelectedLead(null)}>
        <section className="lead-detail-modal" role="dialog" aria-modal="true" aria-labelledby="lead-detail-title" onClick={(event) => event.stopPropagation()}>
          <div className="lead-detail-head"><div><div className="eyebrow">{selectedLead.company || "个人客户"}</div><h2 id="lead-detail-title">{selectedLead.name}</h2></div><button className="icon-button" title="关闭" aria-label="关闭" onClick={() => setSelectedLead(null)}><X size={16} /></button></div>
          <div className="lead-detail-meta"><a href={`mailto:${selectedLead.email}`}><Mail size={14} />{selectedLead.email}</a><span>{formatTime(selectedLead.createdAt)}</span></div>
          <p className="lead-detail-message">{selectedLead.message}</p>
          <div className="lead-detail-actions">{selectedLead.status === "new" ? <button className="primary-button" onClick={() => void updateStatus(selectedLead, "contacted")}><CheckCircle2 size={14} /> 标记已联系</button> : null}{selectedLead.status === "contacted" ? <button className="secondary-button" onClick={() => void updateStatus(selectedLead, "archived")}><Archive size={14} /> 归档</button> : null}</div>
        </section>
      </div> : null}
    </div>
  );
}
