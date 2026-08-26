"use client";

import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronRight,
  CircleHelp,
  Cloud,
  CloudUpload,
  FileSpreadsheet,
  Globe2,
  History,
  Image as ImageIcon,
  Laptop as Desktop,
  LoaderCircle,
  MessageSquareText,
  MoreHorizontal,
  RotateCcw,
  RotateCw,
  Send,
  Smartphone as Mobile,
  Sparkles,
  Tablet,
  Upload,
  X,
} from "lucide-react";
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import readXlsxFile from "read-excel-file";
import { OpenSourceTemplateFrame } from "@/components/open-source-template-frame";
import {
  defaultDraft,
  getTemplate,
  importProductsFromRows,
  normalizeDraft,
  templates,
  type Device,
  type Locale,
  type SiteDraft,
} from "@/lib/site-model";
import type { SiteOperation } from "@/lib/site-operations";

const siteId = "demo";

type ChatStatus = "syncing" | "applied" | "warning" | "error" | "no_change";
type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  change?: string;
  status?: ChatStatus;
  revision?: number;
  meta?: string;
};
type HistoryItem = {
  id: string;
  revision: number;
  summary: string;
  source: string;
  appliedTargets: string[];
  createdAt: string;
};
type DraftSnapshot = {
  draft: SiteDraft;
  history: HistoryItem[];
  canUndo: boolean;
  canRedo: boolean;
  updatedAt: string;
  isNew?: boolean;
};
type ProviderStatus = { mode: "deepseek" | "unconfigured"; model: string | null };

const initialMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    text: "我已经载入你选择的开源模板。现在可以修改首屏、关于、优势、服务、商品和联系区块；每次操作都会保存为可撤销草稿。",
  },
  {
    id: "guide",
    role: "assistant",
    text: "可以直接说“把第二个服务标题改为智能产线集成”或点击右侧内容后再下达指令。模板只有在你明确要求更换时才会切换。",
  },
];

function readSseEvents(raw: string) {
  return raw
    .split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("data: "))?.slice(6))
    .filter(Boolean)
    .map((value) => JSON.parse(value as string) as Record<string, unknown>);
}

export default function WorkspacePage() {
  const [draft, setDraft] = useState<SiteDraft>(defaultDraft);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [device, setDevice] = useState<Device>("desktop");
  const [locale, setLocale] = useState<Locale>("zh");
  const [showImport, setShowImport] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [importState, setImportState] = useState<{ name: string; imported: number; errors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState("正在连接模型…");
  const [mobilePane, setMobilePane] = useState<"chat" | "preview">("chat");
  const [selectedTarget, setSelectedTarget] = useState<{ key: string; label: string } | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [expectedTargets, setExpectedTargets] = useState<string[]>([]);
  const [previewState, setPreviewState] = useState<"loading" | "synced" | "warning">("loading");
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>({ mode: "unconfigured", model: null });
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const adoptSnapshot = (snapshot: DraftSnapshot) => {
    setDraft(normalizeDraft(snapshot.draft));
    setHistory(snapshot.history ?? []);
    setCanUndo(Boolean(snapshot.canUndo));
    setCanRedo(Boolean(snapshot.canRedo));
    setUpdatedAt(snapshot.updatedAt ?? new Date().toISOString());
  };

  useEffect(() => {
    let cancelled = false;
    async function loadDraft() {
      try {
        let snapshot = await fetch(`/api/sites/${siteId}/draft`, { cache: "no-store" }).then((response) => {
          if (!response.ok) throw new Error("无法读取草稿");
          return response.json() as Promise<DraftSnapshot>;
        });
        const saved = window.localStorage.getItem("sitecraft-draft");
        if (snapshot.isNew && saved) {
          try {
            const migrated = normalizeDraft(JSON.parse(saved));
            migrated.revision = snapshot.draft.revision;
            const response = await fetch(`/api/sites/${siteId}/draft`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                baseRevision: snapshot.draft.revision,
                operations: [{ op: "replace_draft", draft: migrated }],
                summary: "迁移原浏览器草稿",
                source: "migration",
              }),
            });
            if (response.ok) snapshot = await response.json() as DraftSnapshot;
          } catch {
            /* A stale browser draft is ignored after schema validation fails. */
          }
        }
        window.localStorage.removeItem("sitecraft-draft");
        const requestedTemplate = new URLSearchParams(window.location.search).get("template");
        if (requestedTemplate && templates.some((item) => item.id === requestedTemplate) && snapshot.draft.templateId !== requestedTemplate) {
          const response = await fetch(`/api/sites/${siteId}/draft`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              baseRevision: snapshot.draft.revision,
              operations: [{ op: "set_template", templateId: requestedTemplate }],
              summary: `选择模板 ${getTemplate(requestedTemplate).name}`,
              source: "template",
            }),
          });
          if (response.ok) snapshot = await response.json() as DraftSnapshot;
        }
        if (!cancelled) {
          adoptSnapshot(snapshot);
          setDraftReady(true);
          setPreviewState("loading");
          if (new URLSearchParams(window.location.search).get("import") === "products") setShowImport(true);
        }
      } catch (error) {
        if (!cancelled) {
          setMessages((items) => [...items, { id: crypto.randomUUID(), role: "assistant", status: "error", text: error instanceof Error ? error.message : "草稿加载失败" }]);
          setDraftReady(true);
        }
      }
    }
    void loadDraft();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    fetch("/api/ai/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((status: ProviderStatus) => setProviderStatus(status))
      .catch(() => setProviderStatus({ mode: "unconfigured", model: null }));
  }, []);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, busy]);

  const currentTemplate = getTemplate(draft.templateId);
  const saveLabel = useMemo(() => {
    if (!draftReady) return "正在读取草稿";
    if (previewState === "loading") return "草稿已保存 · 正在同步预览";
    if (previewState === "warning") return "草稿已保存 · 部分槽位未显示";
    return "草稿与预览已同步";
  }, [draftReady, previewState]);

  const selectPreviewTarget = (key: string, label: string, prompt: string) => {
    setSelectedTarget({ key, label });
    setInput(prompt);
    setMobilePane("chat");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const submitChat = async (event?: FormEvent) => {
    event?.preventDefault();
    const value = input.trim();
    if (!value || busy || !draftReady) return;
    setInput("");
    setBusy(true);
    setBusyText("正在连接模型…");
    setMessages((items) => [...items, { id: crypto.randomUUID(), role: "user", text: value }]);
    // 多轮记忆：透传最近 3 轮真实对话（排除初始欢迎语），供服务端拼入 prompt
    const recentContext = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .filter((m) => m.id !== "welcome" && m.id !== "guide")
      .slice(-6)
      .map((m) => ({ role: m.role, text: m.text.slice(0, 200) }));
    try {
      const response = await fetch(`/api/sites/${siteId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseRevision: draft.revision, message: value, selectedTarget: selectedTarget?.key ?? null, context: recentContext }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as Partial<DraftSnapshot> & { message?: string };
        if (payload.draft) adoptSnapshot(payload as DraftSnapshot);
        throw new Error(payload.message || (response.status === 409 ? "草稿版本冲突，已载入最新版本，请重新发送。" : "AI 请求失败"));
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("模型响应不可读取");
      const decoder = new TextDecoder();
      let raw = "";
      let doneEvent: Record<string, unknown> | undefined;
      while (true) {
        const result = await reader.read();
        raw += decoder.decode(result.value ?? new Uint8Array(), { stream: !result.done });
        const events = readSseEvents(raw);
        const status = [...events].reverse().find((item) => item.type === "status");
        if (typeof status?.value === "string") setBusyText(status.value);
        doneEvent = events.find((item) => item.type === "done");
        if (result.done) break;
      }
      if (!doneEvent) throw new Error("模型没有返回完成事件");
      const status = String(doneEvent.status);
      if ((status === "applied" || status === "no_change" || status === "conflict") && doneEvent.draft) adoptSnapshot(doneEvent as unknown as DraftSnapshot);
      const latency = typeof doneEvent.latencyMs === "number" ? `模型 ${Math.max(0.1, doneEvent.latencyMs / 1000).toFixed(1)} 秒` : undefined;
      if (status === "applied") {
        const changeSet = doneEvent.changeSet as { revision: number; appliedTargets: string[] };
        setExpectedTargets(changeSet.appliedTargets);
        setPreviewState("loading");
        setMessages((items) => [...items, {
          id: crypto.randomUUID(), role: "assistant", status: "syncing", revision: changeSet.revision,
          text: `草稿 v${changeSet.revision} 已保存，正在确认右侧模板已实际更新。`,
          change: String(doneEvent.summary), meta: latency,
        }]);
      } else if (status === "no_change") {
        setMessages((items) => [...items, { id: crypto.randomUUID(), role: "assistant", status: "no_change", text: "模型没有生成可应用的内容差异，草稿和模板均未修改。", change: String(doneEvent.summary || "没有变化"), meta: latency }]);
      } else if (status === "conflict") {
        setMessages((items) => [...items, { id: crypto.randomUUID(), role: "assistant", status: "warning", text: String(doneEvent.error), change: "没有覆盖较新的草稿" }]);
      } else {
        throw new Error(String(doneEvent.error || "模型操作失败"));
      }
      setSelectedTarget(null);
    } catch (error) {
      setMessages((items) => [...items, { id: crypto.randomUUID(), role: "assistant", status: "error", text: error instanceof Error ? error.message : "AI 修改失败", change: "本次没有修改草稿" }]);
    } finally {
      setBusy(false);
    }
  };

  const handlePreviewReport = (report: { revision: number; appliedSlots: string[]; missingSlots: string[] }) => {
    if (report.revision !== draft.revision) return;
    const hasExpectedTargets = expectedTargets.length > 0;
    const visibleTargets = expectedTargets.filter((target) => {
      const language = target.match(/\.(zh|en)$/)?.[1];
      return !language || language === locale || target === "companyName.zh";
    });
    if (hasExpectedTargets && visibleTargets.length === 0) {
      const editedLanguage = expectedTargets.some((target) => target.endsWith(".en")) ? "英文" : "中文";
      setPreviewState("synced");
      setMessages((items) => items.map((message) => message.revision === report.revision && message.status === "syncing"
        ? { ...message, status: "applied", text: `草稿 v${report.revision} 已保存；${editedLanguage}内容已更新，切换语言即可查看。` }
        : message));
      setExpectedTargets([]);
      return;
    }
    const missing = hasExpectedTargets
      ? report.missingSlots.filter((target) => visibleTargets.includes(target))
      : [];
    setPreviewState(missing.length ? "warning" : "synced");
    if (!hasExpectedTargets) return;
    setMessages((items) => items.map((message) => {
      if (message.revision !== report.revision || message.status !== "syncing") return message;
      if (missing.length) return { ...message, status: "warning", text: `草稿 v${report.revision} 已保存，但当前模板没有找到 ${missing.length} 个对应显示槽位。`, change: `${message.change}；未显示：${missing.join("、")}` };
      return { ...message, status: "applied", text: `草稿 v${report.revision} 已保存，右侧模板已确认更新。` };
    }));
    setExpectedTargets([]);
  };

  const moveHistory = async (action: "undo" | "redo") => {
    if (busy) return;
    setBusy(true);
    setBusyText(action === "undo" ? "正在撤销并保存…" : "正在重做并保存…");
    try {
      const response = await fetch(`/api/sites/${siteId}/history/${action}`, { method: "POST" });
      const result = await response.json() as DraftSnapshot & { status: string; appliedTargets?: string[] };
      if (!response.ok || result.status !== "applied") throw new Error(action === "undo" ? "没有可撤销的修改" : "没有可重做的修改");
      adoptSnapshot(result);
      setExpectedTargets(result.appliedTargets ?? []);
      setPreviewState("loading");
    } catch (error) {
      setMessages((items) => [...items, { id: crypto.randomUUID(), role: "assistant", status: "error", text: error instanceof Error ? error.message : "历史操作失败" }]);
    } finally {
      setBusy(false);
    }
  };

  const saveOperations = async (operations: SiteOperation[], summary: string, source: "import" | "manual") => {
    const response = await fetch(`/api/sites/${siteId}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseRevision: draft.revision, operations, summary, source }),
    });
    const result = await response.json() as DraftSnapshot & { error?: string; changeSet?: { appliedTargets: string[] } };
    if (!response.ok) throw new Error(result.error || "草稿保存失败");
    adoptSnapshot(result);
    setExpectedTargets(result.changeSet?.appliedTargets ?? []);
    setPreviewState("loading");
  };

  const commitImportedRows = async (name: string, rows: Record<string, string>[]) => {
    const result = importProductsFromRows(draft, rows);
    try {
      await saveOperations([{ op: "replace_products", products: result.products }], `导入商品表格 ${name}`, "import");
      setImportState({ name, imported: result.imported, errors: result.errors });
    } catch (error) {
      setImportState({ name, imported: 0, errors: [error instanceof Error ? error.message : "导入失败"] });
    }
    setShowImport(true);
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.name.toLowerCase().endsWith(".xlsx")) {
      const rows = await readXlsxFile(file);
      const [header, ...body] = rows;
      const keys = (header ?? []).map((cell) => String(cell ?? "").trim());
      await commitImportedRows(file.name, body.map((row) => Object.fromEntries(keys.map((key, index) => [key, String(row[index] ?? "")]))));
    } else {
      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => { void commitImportedRows(file.name, results.data); },
      });
    }
    event.target.value = "";
  };

  return (
    <div className="builder-shell">
      <div className="builder-mobile-tabs" role="tablist" aria-label="建站工作区视图">
        <button className={mobilePane === "chat" ? "active" : ""} onClick={() => setMobilePane("chat")} role="tab" aria-selected={mobilePane === "chat"}><MessageSquareText size={14} /> AI 对话</button>
        <button className={mobilePane === "preview" ? "active" : ""} onClick={() => setMobilePane("preview")} role="tab" aria-selected={mobilePane === "preview"}><Desktop size={14} /> 网站预览</button>
      </div>
      <aside className={`builder-chat ${mobilePane !== "chat" ? "mobile-hidden" : ""}`}>
        <div className="builder-chat-head">
          <div>
            <Link href="/" className="eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><ArrowLeft size={12} />返回站点</Link>
            <h2>{draft.siteName}</h2>
            <span className="builder-template-name">{currentTemplate.name}</span>
            <span className="chat-context"><span className={`provider-dot ${providerStatus.mode === "deepseek" ? "remote" : "offline"}`} />{providerStatus.mode === "deepseek" ? `DEEPSEEK API · ${providerStatus.model}` : "DeepSeek 未配置 · 不会执行本地伪修改"}</span>
          </div>
          <Link className="icon-button" href="/templates" aria-label="更换模板"><MoreHorizontal size={16} /></Link>
        </div>
        <div className="draft-status-panel">
          <div className="draft-status-icon"><Cloud size={15} /></div>
          <div><strong>当前草稿 · v{draft.revision}</strong><span>{updatedAt ? `${new Date(updatedAt).toLocaleString("zh-CN")} 保存到服务器` : "正在载入"}</span></div>
          <button type="button" onClick={() => setShowHistory((value) => !value)}><History size={13} />历史 {history.length}</button>
        </div>
        {showHistory && (
          <div className="draft-history" aria-label="草稿历史">
            <div className="draft-history-head"><strong>修改历史</strong><button onClick={() => setShowHistory(false)} aria-label="关闭历史"><X size={13} /></button></div>
            {history.length ? history.map((item) => <div className="history-row" key={item.id}><span>v{item.revision}</span><div><strong>{item.summary}</strong><small>{new Date(item.createdAt).toLocaleString("zh-CN")} · {item.source.toUpperCase()}</small></div></div>) : <div className="history-empty">尚无修改记录</div>}
          </div>
        )}
        <div className="chat-messages">
          {messages.map((message) => (
            <div className={`message ${message.role} ${message.status ?? ""}`} key={message.id}>
              <div className="message-label">{message.role === "assistant" ? <><Sparkles size={10} style={{ verticalAlign: "middle", marginRight: 4 }} />SITECRAFT AI</> : "YOU"}</div>
              <div className="message-bubble">{message.text}</div>
              {message.change && <div className={`change-summary ${message.status ?? ""}`}>{message.status === "error" || message.status === "warning" ? <AlertCircle size={11} /> : message.status === "syncing" ? <LoaderCircle className="spin" size={11} /> : <Check size={11} />}<span>{message.status === "applied" ? "已应用" : message.status === "syncing" ? "同步中" : message.status === "no_change" ? "未修改" : "注意"}：{message.change}{message.meta ? ` · ${message.meta}` : ""}</span></div>}
            </div>
          ))}
          {busy && <div className="message assistant"><div className="message-label"><Sparkles size={10} style={{ verticalAlign: "middle", marginRight: 4 }} />SITECRAFT AI</div><div className="message-bubble busy-message"><LoaderCircle className="spin" size={13} />{busyText}</div></div>}
          <div ref={messagesEndRef} />
        </div>
        <div className="chat-input-wrap">
          {selectedTarget && <div className="chat-target"><span>正在修改：{selectedTarget.label}</span><button aria-label="清除修改目标" onClick={() => setSelectedTarget(null)} type="button"><X size={12} /></button></div>}
          <form className="chat-input" onSubmit={submitChat}>
            <textarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitChat(); } }} placeholder="告诉 AI 你想怎么改..." rows={2} />
            <button className="send-button" type="submit" disabled={!input.trim() || busy || !draftReady} aria-label="发送"><Send size={14} /></button>
          </form>
          <div className="chat-hints"><button className="hint" onClick={() => setInput("只把第二个服务标题改为智能产线集成，其他内容不变")}>修改服务</button><button className="hint" onClick={() => setInput("重写首屏标题和说明，不要更换模板")}>优化首屏</button><button className="hint" onClick={() => setShowImport(true)}>上传商品表格</button></div>
        </div>
      </aside>
      <main className={`preview-shell ${mobilePane !== "preview" ? "mobile-hidden" : ""}`}>
        <header className="preview-toolbar">
          <div className="preview-toolbar-left"><div className="project-name">{draft.siteName}</div><span className={`save-status ${previewState}`}><Check size={12} />{saveLabel}</span></div>
          <div className="preview-toolbar-right">
            <div className="device-toggle"><button className={device === "desktop" ? "active" : ""} onClick={() => setDevice("desktop")} aria-label="桌面预览"><Desktop size={14} /></button><button className={device === "tablet" ? "active" : ""} onClick={() => setDevice("tablet")} aria-label="平板预览"><Tablet size={14} /></button><button className={device === "mobile" ? "active" : ""} onClick={() => setDevice("mobile")} aria-label="手机预览"><Mobile size={14} /></button></div>
            <div className="device-toggle"><button className={locale === "zh" ? "active" : ""} onClick={() => setLocale("zh")}>中</button><button className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")}>EN</button></div>
            <button className="icon-button" onClick={() => void moveHistory("undo")} disabled={!canUndo || busy} aria-label="撤销"><RotateCcw size={14} /></button>
            <button className="icon-button" onClick={() => void moveHistory("redo")} disabled={!canRedo || busy} aria-label="重做"><RotateCw size={14} /></button>
            <button className="secondary-button" onClick={() => setShowImport(true)}><Upload size={14} />商品</button>
            <Link className="primary-button" href="/published/forge-industrial" target="_blank" rel="noreferrer"><Globe2 size={14} />发布</Link>
          </div>
        </header>
        <div className="preview-stage"><div className={`browser-frame ${device}`}><div className="browser-bar"><span className="browser-dot" /><span className="browser-dot" /><span className="browser-dot" /><div className="browser-url">forge-industrial.sites.ai</div><CircleHelp size={11} color="#adb8af" /></div>{draftReady && <OpenSourceTemplateFrame templateId={draft.templateId} draft={draft} locale={locale} variant="workspace" expectedTargets={expectedTargets} onSelectTarget={selectPreviewTarget} onApplyReport={handlePreviewReport} />}</div></div>
      </main>
      {showImport && (
        <div className="modal-backdrop" onClick={() => setShowImport(false)}><div className="import-modal" onClick={(event) => event.stopPropagation()}>
          <div className="modal-head"><div><div className="eyebrow">Content / Products</div><h3>填充你的商品目录</h3></div><button className="icon-button" onClick={() => setShowImport(false)} aria-label="关闭"><X size={15} /></button></div>
          <p className="modal-copy">上传 CSV 或 XLSX 商品表格，校验后直接保存为可撤销草稿。AI 可以继续修改指定 SKU 的中英文名称、简介和分类。</p>
          <div className="upload-zone" onClick={() => fileRef.current?.click()}><input ref={fileRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={handleFile} /><div className="upload-icon"><CloudUpload size={20} /></div><strong>点击上传表格</strong><span>需要包含 SKU、产品名称、分类等字段</span><small>CSV / XLSX · 最多 1000 行</small></div>
          <div className="import-options"><div><FileSpreadsheet size={15} /><span>支持中英文列名自动识别</span><ChevronRight size={13} style={{ marginLeft: "auto" }} /></div><div><ImageIcon size={15} /><span>相同 SKU 自动更新，新增项进入草稿</span><ChevronRight size={13} style={{ marginLeft: "auto" }} /></div></div>
          {importState && <div className={`import-result ${importState.imported ? "" : "error"}`}>{importState.imported ? <Check size={14} /> : <AlertCircle size={14} />}<div><strong>{importState.name} {importState.imported ? "已保存" : "导入失败"}</strong><span>{importState.imported ? `新增或更新 ${importState.imported} 个商品` : importState.errors[0]}{importState.imported && importState.errors.length ? `，${importState.errors.length} 行需要检查` : ""}</span></div></div>}
          <div className="modal-foot"><span>当前草稿商品：{draft.products.length} / 1000</span><button className="primary-button" onClick={() => setShowImport(false)}>完成</button></div>
        </div></div>
      )}
    </div>
  );
}
