"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  Info,
  Laptop as Desktop,
  LoaderCircle,
  MessageSquareText,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Send,
  Smartphone as Mobile,
  Sparkles,
  Tablet,
  Upload,
  X,
} from "lucide-react";
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { buildChangeDiff, type ChangeDiff } from "@/lib/change-diff";
import { readSseEvents } from "@/lib/sse-events";

type ChatStatus = "syncing" | "applied" | "warning" | "error" | "no_change";
type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  change?: string;
  status?: ChatStatus;
  revision?: number;
  meta?: string;
  retryText?: string;
  diff?: ChangeDiff[];
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
type TemplateCapabilities = { templateId: string; revision: number; slots: string[] };

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

export default function WorkspacePage() {
  const router = useRouter();
  // SSR 安全：首帧 "demo"，客户端挂载后从 ?siteId 读取真实站点
  const [siteId, setSiteId] = useState("demo");
  const [draft, setDraft] = useState<SiteDraft>(defaultDraft);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [pendingDestructive, setPendingDestructive] = useState<{
    message: string;
    summary: string;
    destructive: string[];
    selectedTarget: { key: string; label: string } | null;
  } | null>(null);
  // 服务端会话 id：sessionStorage 持久化，每标签页独立（③ session 摘要）
  // SSR 安全：首帧为空串，客户端挂载后生成（避免 window is not defined）
  const [sessionId, setSessionId] = useState("");
  useEffect(() => {
    const existing = window.sessionStorage.getItem("sitecraft-session");
    if (existing) {
      setSessionId(existing);
    } else {
      const fresh = crypto.randomUUID();
      window.sessionStorage.setItem("sitecraft-session", fresh);
      setSessionId(fresh);
    }
  }, []);
  const [device, setDevice] = useState<Device>("desktop");
  const [locale, setLocale] = useState<Locale>("zh");
  const [showImport, setShowImport] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // C 块局部重生成：方向输入弹窗（点选板块后触发）
  const [regenerateDialog, setRegenerateDialog] = useState<{ section: string; label: string } | null>(null);
  const [regenerateDirection, setRegenerateDirection] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importState, setImportState] = useState<{ name: string; imported: number; errors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState("正在连接模型…");
  // P0-1：对话总超时（120s）与取消——服务端单条最多 2×45s 生成 + 30s 自评 + 2×45s 重生成，
  // 前端必须兜底，否则领导会看到无限转圈。
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatCancelRequestedRef = useRef(false);
  const aiRequestKeyRef = useRef<string | null>(null);
  const publishRequestKeyRef = useRef<string | null>(null);
  const CHAT_TIMEOUT_MS = 120_000;
  // 事实人工确认：发布被 unverifiedFacts 拦截时列出待确认声明，用户核对属实后勾选确认再发布。
  const [pendingFactConfirm, setPendingFactConfirm] = useState<string[] | null>(null);
  const [factsConfirmed, setFactsConfirmed] = useState(false);
  // P2 完成引导：从一句话建站生成完成跳转带 ?generated=1 → 显示"下一步"提示条
  const [showGuide, setShowGuide] = useState(false);
  const [mobilePane, setMobilePane] = useState<"chat" | "preview">("chat");
  const [selectedTarget, setSelectedTarget] = useState<{ key: string; label: string } | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [expectedTargets, setExpectedTargets] = useState<string[]>([]);
  const [templateCapabilities, setTemplateCapabilities] = useState<TemplateCapabilities | null>(null);
  const [previewState, setPreviewState] = useState<"loading" | "synced" | "warning">("loading");
  // 真实模板 iframe 握手偶发失败时，递增 key 强制重挂（不再降级为本地结构近似渲染）。
  const [previewFrameKey, setPreviewFrameKey] = useState(0);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>({ mode: "unconfigured", model: null });
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesNearBottomRef = useRef(true);
  const userJustSentRef = useRef(false);
  const destructiveReturnFocusRef = useRef<HTMLElement | null>(null);

  const adoptSnapshot = (snapshot: DraftSnapshot) => {
    setDraft(normalizeDraft(snapshot.draft));
    setHistory(snapshot.history ?? []);
    setCanUndo(Boolean(snapshot.canUndo));
    setCanRedo(Boolean(snapshot.canRedo));
    setUpdatedAt(snapshot.updatedAt ?? new Date().toISOString());
  };

  useEffect(() => {
    // 从 URL 读取站点 id（一句话建站后跳转用），默认 demo 保持向后兼容
    const fromUrl = new URLSearchParams(window.location.search).get("siteId");
    if (fromUrl && fromUrl !== siteId) setSiteId(fromUrl);
    // P2 完成引导：?generated=1 → 显示"下一步"提示条（非阻断，可关）
    if (new URLSearchParams(window.location.search).get("generated") === "1") setShowGuide(true);
  }, []);

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
  }, [siteId]);

  useEffect(() => {
    fetch("/api/ai/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((status: ProviderStatus) => setProviderStatus(status))
      .catch(() => setProviderStatus({ mode: "unconfigured", model: null }));
  }, []);
  useEffect(() => () => chatAbortRef.current?.abort(), []);
  useEffect(() => {
    if (!messagesNearBottomRef.current && !userJustSentRef.current) return;
    userJustSentRef.current = false;
    messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    messagesNearBottomRef.current = true;
  }, [messages, busy, busyText]);

  const currentTemplate = getTemplate(draft.templateId);
  const activeTemplateCapabilities = templateCapabilities?.templateId === draft.templateId
    && templateCapabilities.revision === draft.revision
    ? templateCapabilities
    : null;
  const saveLabel = useMemo(() => {
    if (!draftReady) return "正在读取草稿";
    if (previewState === "loading") return "草稿已保存 · 正在同步预览";
    if (previewState === "warning") return "草稿已保存 · 部分槽位未显示";
    return "草稿与预览已同步";
  }, [draftReady, previewState]);

  const selectPreviewTarget = (key: string, label: string, prompt: string, slot?: string) => {
    setSelectedTarget({ key, label: slot ? `${label}（已定位）` : label });
    setInput(slot ? `修改我刚才选中的${label}。${prompt}` : prompt);
    setMobilePane("chat");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  // C 块：selectedTarget key → 板块（hero/features/services/products/about/contact）
  const sectionFromTarget = (key: string): string => {
    if (key.startsWith("hero.") || key === "heroTitle" || key === "heroSubtitle" || key === "heroCta") return "hero";
    const s = key.split(".")[0];
    return ["about", "features", "services", "products", "contact"].includes(s) ? s : "";
  };

  const cancelChatRequest = () => {
    if (!chatAbortRef.current) return;
    chatCancelRequestedRef.current = true;
    chatAbortRef.current.abort();
  };

  // C 块：局部重生成提交（调 generate 的 regenerate step，SSE 展示进度）
  const submitRegenerate = async (section: string, direction: string) => {
    if (busy || !draftReady || aiRequestKeyRef.current) return;
    const idempotencyKey = crypto.randomUUID();
    aiRequestKeyRef.current = idempotencyKey;
    setBusy(true);
    setBusyText(`正在重生成 ${section} 板块…`);
    setError(null);
    const controller = new AbortController();
    chatAbortRef.current = controller;
    chatCancelRequestedRef.current = false;
    const timer = window.setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/sites/${siteId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: "execute",
          message: direction.trim() || `重生成 ${section} 板块`,
          intent: {
            businessType: "other",
            companyName: draft.companyName,
            industry: draft.industry,
            targetAudience: "globalB2b",
            tone: "professional",
            coreSections: ["about", "features", "services", "products", "contact"],
            recommendedTemplateId: draft.templateId,
            summary: draft.goal || "重生成板块",
          },
          templateId: draft.templateId,
          siteLanguage: locale,
          hiddenSections: draft.hiddenSections ?? [],
          baseRevision: draft.revision,
          regenerate: { section, direction: direction.trim() || undefined, mode: "text" },
          idempotencyKey,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error("重生成请求失败");
      const reader = res.body?.getReader();
      if (!reader) throw new Error("无法读取响应");
      const events = await readSseEvents(reader, (event) => {
        if (event.type === "status" && typeof event.value === "string") setBusyText(event.value);
      });
      const done = events.find((event) => event.type === "done");
      if (!done) throw new Error("没有返回结果");
      if (done.status === "error") throw new Error(String(done.error || "重生成失败"));
      if (done.status === "conflict") throw new Error("草稿冲突，请刷新后重试");
      // 重生成成功 → 刷新草稿（revision 更新）
      const fresh = await fetch(`/api/sites/${siteId}/draft`, { cache: "no-store" }).then((r) => r.json());
      if (fresh.draft) {
        setDraft(fresh.draft);
        setDraftReady(true);
      }
      setSelectedTarget(null);
      setRegenerateDialog(null);
      setRegenerateDirection("");
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      setError(aborted ? "已取消重生成，草稿和历史均未修改。" : e instanceof Error ? e.message : "重生成失败");
    } finally {
      window.clearTimeout(timer);
      if (chatAbortRef.current === controller) chatAbortRef.current = null;
      chatCancelRequestedRef.current = false;
      if (aiRequestKeyRef.current === idempotencyKey) aiRequestKeyRef.current = null;
      setBusy(false);
    }
  };

  const submitChat = async (event?: FormEvent) => {
    event?.preventDefault();
    const value = input.trim();
    if (!value || busy || !draftReady || !activeTemplateCapabilities || aiRequestKeyRef.current) return;
    const idempotencyKey = crypto.randomUUID();
    aiRequestKeyRef.current = idempotencyKey;
    setInput("");
    setBusy(true);
    setBusyText("正在连接模型…");
    userJustSentRef.current = true;
    setMessages((items) => [...items, { id: crypto.randomUUID(), role: "user", text: value }]);
    // 多轮记忆：透传最近 3 轮真实对话（排除初始欢迎语），供服务端拼入 prompt
    const recentContext = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .filter((m) => m.id !== "welcome" && m.id !== "guide")
      .slice(-6)
      .map((m) => ({ role: m.role, text: m.text.slice(0, 200) }));
    try {
      const previousDraft = draft;
      const controller = new AbortController();
      chatAbortRef.current = controller;
      const timer = window.setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
      try {
        const response = await fetch(`/api/sites/${siteId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            baseRevision: draft.revision,
            message: value,
            selectedTarget: selectedTarget?.key ?? null,
            context: recentContext,
            sessionId,
            templateCapabilities: activeTemplateCapabilities,
            idempotencyKey,
          }),
          signal: controller.signal,
        });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as Partial<DraftSnapshot> & { message?: string };
        if (payload.draft) adoptSnapshot(payload as DraftSnapshot);
        throw new Error(payload.message || (response.status === 409 ? "草稿版本冲突，已载入最新版本，请重新发送。" : "AI 请求失败"));
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("模型响应不可读取");
      const events = await readSseEvents(reader, (item) => {
        if (item.type === "status" && typeof item.value === "string") setBusyText(item.value);
      });
      const doneEvent = events.find((item) => item.type === "done");
      if (!doneEvent) throw new Error("模型没有返回完成事件");
      const status = String(doneEvent.status);
      if ((status === "applied" || status === "no_change" || status === "conflict") && doneEvent.draft) adoptSnapshot(doneEvent as unknown as DraftSnapshot);
      const latency = typeof doneEvent.latencyMs === "number" ? `模型 ${Math.max(0.1, doneEvent.latencyMs / 1000).toFixed(1)} 秒` : undefined;
      if (status === "applied") {
        const changeSet = doneEvent.changeSet as { revision: number; appliedTargets: string[]; operations?: SiteOperation[] };
        const undoneChange = doneEvent.undoneChange as { summary?: string } | undefined;
        const nonVisualTargets = Array.isArray(doneEvent.nonVisualTargets) ? doneEvent.nonVisualTargets as string[] : [];
        const visibleTargets = changeSet.appliedTargets.filter((target) => !nonVisualTargets.includes(target));
        setExpectedTargets(visibleTargets);
        setPreviewState(visibleTargets.length ? "loading" : "synced");
        setMessages((items) => [...items, {
          id: crypto.randomUUID(), role: "assistant", status: visibleTargets.length ? "syncing" : "applied", revision: changeSet.revision,
          text: undoneChange?.summary
            ? `已撤销 AI 修改“${undoneChange.summary}”。草稿 v${changeSet.revision} 已保存${visibleTargets.length ? "，正在确认右侧模板已实际更新。" : "。"}`
            : visibleTargets.length
            ? `草稿 v${changeSet.revision} 已保存，正在确认右侧模板已实际更新。`
          : `草稿 v${changeSet.revision} 已保存。${String(doneEvent.displayNotice ?? "")}`,
          change: String(doneEvent.summary), meta: latency,
          diff: changeSet.operations ? buildChangeDiff(changeSet.operations, previousDraft) : undefined,
        }]);
      } else if (status === "no_change") {
        setMessages((items) => [...items, { id: crypto.randomUUID(), role: "assistant", status: "no_change", text: "模型没有生成可应用的内容差异，草稿和模板均未修改。", change: String(doneEvent.summary || "没有变化"), meta: latency }]);
      } else if (status === "conflict") {
        setMessages((items) => [...items, { id: crypto.randomUUID(), role: "assistant", status: "warning", text: String(doneEvent.error), change: "没有覆盖较新的草稿" }]);
      } else if (status === "need_confirmation") {
        // 破坏性操作需要确认：暂存待确认内容，前端弹确认框
        const destructive = Array.isArray(doneEvent.destructive) ? (doneEvent.destructive as string[]) : [];
        destructiveReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : inputRef.current;
        setPendingDestructive({
          message: value,
          summary: String(doneEvent.summary ?? ""),
          destructive,
          selectedTarget,
        });
        setMessages((items) => [...items, {
          id: crypto.randomUUID(), role: "assistant", status: "warning",
          text: "本次修改包含需要确认的操作。",
          change: destructive.join("、"),
        }]);
      } else if (status === "need_clarification") {
        const preservedDraft = doneEvent.code === "unsupported_template_slot" || doneEvent.code === "selected_target_mismatch";
        setMessages((items) => [...items, {
          id: crypto.randomUUID(), role: "assistant", status: "warning",
          text: String(doneEvent.message || "需要补充更明确的修改目标。"),
          change: preservedDraft ? "草稿和历史均未修改" : "本次没有修改草稿",
          meta: latency,
        }]);
      } else {
        throw new Error(String(doneEvent.error || "模型操作失败"));
      }
      if (status !== "need_confirmation" && doneEvent.code !== "selected_target_mismatch") setSelectedTarget(null);
      } finally {
        window.clearTimeout(timer);
        chatAbortRef.current = null;
      }
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      const cancelledByUser = aborted && chatCancelRequestedRef.current;
      setMessages((items) => [...items, { id: crypto.randomUUID(), role: "assistant", status: cancelledByUser ? "warning" : "error", text: cancelledByUser ? "已取消 AI 修改，草稿未改变。" : aborted ? `模型响应超过 ${CHAT_TIMEOUT_MS / 1000} 秒，已停止等待。可换更简单的指令重试。` : error instanceof Error ? error.message : "AI 修改失败", change: "本次没有修改草稿", retryText: cancelledByUser ? undefined : value }]);
    } finally {
      if (aiRequestKeyRef.current === idempotencyKey) aiRequestKeyRef.current = null;
      chatCancelRequestedRef.current = false;
      setBusy(false);
    }
  };

  const confirmDestructive = async (confirmed: boolean) => {
    if (!pendingDestructive) return;
    const { message, summary, selectedTarget: confirmedTarget } = pendingDestructive;
    setPendingDestructive(null);
    window.requestAnimationFrame(() => (destructiveReturnFocusRef.current ?? inputRef.current)?.focus());
    if (!confirmed) {
      setSelectedTarget(null);
      setMessages((items) => [...items, { id: crypto.randomUUID(), role: "assistant", status: "warning", text: "已取消本次修改。", change: summary }]);
      return;
    }
    if (aiRequestKeyRef.current) return;
    const idempotencyKey = crypto.randomUUID();
    aiRequestKeyRef.current = idempotencyKey;
    // 用户确认后带 confirmedDestructive 重发
    const confirmCtx = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .filter((m) => m.id !== "welcome" && m.id !== "guide")
      .slice(-6)
      .map((m) => ({ role: m.role, text: m.text.slice(0, 200) }));
    setInput(message);
    setBusy(true);
    setBusyText("正在保存…");
    const controller = new AbortController();
    chatAbortRef.current = controller;
    const timer = window.setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
    const previousDraft = draft;
    try {
      const response = await fetch(`/api/sites/${siteId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseRevision: draft.revision,
          message,
          selectedTarget: confirmedTarget?.key ?? null,
          context: confirmCtx,
          confirmedDestructive: true,
          sessionId,
          templateCapabilities: activeTemplateCapabilities,
          idempotencyKey,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as Partial<DraftSnapshot> & { message?: string };
        if (payload.draft) adoptSnapshot(payload as DraftSnapshot);
        throw new Error(payload.message || (response.status === 409 ? "草稿版本冲突，已载入最新版本，请重新发送。" : "AI 请求失败"));
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("模型响应不可读取");
      const events = await readSseEvents(reader);
      const doneEvent = events.find((item) => item.type === "done");
      if (!doneEvent) throw new Error("模型没有返回完成事件");
      const st = String(doneEvent.status);
      if ((st === "applied" || st === "no_change" || st === "conflict") && doneEvent.draft) adoptSnapshot(doneEvent as unknown as DraftSnapshot);
      if (st === "applied") {
        const changeSet = doneEvent.changeSet as { revision: number; appliedTargets: string[]; operations?: SiteOperation[] };
        const nonVisualTargets = Array.isArray(doneEvent.nonVisualTargets) ? doneEvent.nonVisualTargets as string[] : [];
        const visibleTargets = changeSet.appliedTargets.filter((target) => !nonVisualTargets.includes(target));
        setExpectedTargets(visibleTargets);
        setPreviewState(visibleTargets.length ? "loading" : "synced");
        setMessages((items) => [...items, {
          id: crypto.randomUUID(), role: "assistant", status: visibleTargets.length ? "syncing" : "applied", revision: changeSet.revision,
          text: visibleTargets.length
            ? `草稿 v${changeSet.revision} 已保存，正在确认右侧模板已实际更新。`
          : `草稿 v${changeSet.revision} 已保存。${String(doneEvent.displayNotice ?? "")}`,
          change: String(doneEvent.summary),
          diff: changeSet.operations ? buildChangeDiff(changeSet.operations, previousDraft) : undefined,
        }]);
      } else if (st === "no_change") {
        setMessages((items) => [...items, { id: crypto.randomUUID(), role: "assistant", status: "no_change", text: "模型没有生成可应用的内容差异。", change: String(doneEvent.summary || "没有变化") }]);
      } else if (st === "conflict") {
        setMessages((items) => [...items, { id: crypto.randomUUID(), role: "assistant", status: "warning", text: String(doneEvent.error), change: "没有覆盖较新的草稿" }]);
      } else if (st === "need_clarification") {
        const preservedDraft = doneEvent.code === "unsupported_template_slot" || doneEvent.code === "selected_target_mismatch";
        setMessages((items) => [...items, {
          id: crypto.randomUUID(), role: "assistant", status: "warning",
          text: String(doneEvent.message || "需要补充更明确的修改目标。"),
          change: preservedDraft ? "草稿和历史均未修改" : "本次没有修改草稿",
        }]);
      } else {
        setMessages((items) => [...items, { id: crypto.randomUUID(), role: "assistant", status: "error", text: String(doneEvent.error || "操作失败"), change: "本次没有修改草稿" }]);
      }
      if (doneEvent.code !== "selected_target_mismatch") setSelectedTarget(null);
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      const cancelledByUser = aborted && chatCancelRequestedRef.current;
      setMessages((items) => [...items, {
        id: crypto.randomUUID(),
        role: "assistant",
        status: cancelledByUser ? "warning" : "error",
        text: cancelledByUser ? "已取消 AI 修改，草稿未改变。" : aborted ? `模型响应超过 ${CHAT_TIMEOUT_MS / 1000} 秒，已停止等待。可换更简单的指令重试。` : error instanceof Error ? error.message : "确认操作失败",
        change: "本次没有修改草稿",
        retryText: cancelledByUser ? undefined : message,
      }]);
    } finally {
      window.clearTimeout(timer);
      chatAbortRef.current = null;
      chatCancelRequestedRef.current = false;
      if (aiRequestKeyRef.current === idempotencyKey) aiRequestKeyRef.current = null;
      setBusy(false);
    }
  };

  const handlePreviewReport = (report: { revision: number; appliedSlots: string[]; missingSlots: string[] }) => {
    if (report.revision !== draft.revision) return;
    setTemplateCapabilities({
      templateId: draft.templateId,
      revision: report.revision,
      slots: [...new Set(report.appliedSlots)],
    });
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

  const handlePreviewFrameState = useCallback((state: "loading" | "ready" | "error") => {
    if (state === "loading") {
      setPreviewState("loading");
      return;
    }
    if (state === "error") {
      // 真实模板 iframe 偶发握手失败：不降级为本地近似渲染，重挂 iframe 重试。
      setPreviewState("warning");
      setPreviewFrameKey((key) => key + 1);
    }
  }, []);

  useEffect(() => {
    setTemplateCapabilities(null);
    setPreviewState("loading");
    // 仅模板切换时重挂 iframe。revision 变化不应重挂：AI 每次保存都推高 revision，
    // 重挂会让 iframe 销毁重建，与 applied 报告/消息更新竞态（表现为"未找到槽位"warning）。
    // revision 增量由 OpenSourceTemplateFrame 内部 postMessage 更新，无需重挂。
    setPreviewFrameKey((key) => key + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.templateId]);

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

  const publishSite = async (opts?: { factsConfirmed?: boolean }) => {
    if (busy || siteId === "demo" || publishRequestKeyRef.current) return;
    const idempotencyKey = crypto.randomUUID();
    publishRequestKeyRef.current = idempotencyKey;
    setBusy(true);
    setBusyText("正在检查内容并发布…");
    try {
      const response = await fetch(`/api/sites/${siteId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseRevision: draft.revision, idempotencyKey, factsConfirmed: opts?.factsConfirmed ?? false }),
      });
      const payload = await response.json().catch(() => ({})) as {
        error?: string;
        message?: string;
        quality?: { missingSlots?: string[]; placeholderHits?: string[]; unverifiedFacts?: string[] };
        release?: { version?: number };
      };
      if (!response.ok) {
        // 事实类声明需人工确认：列出待确认事实，弹出确认面板让用户核对后带 factsConfirmed 重试。
        const facts = payload.quality?.unverifiedFacts ?? [];
        const hasOnlyFacts = facts.length > 0
          && !(payload.quality?.missingSlots?.length) && !(payload.quality?.placeholderHits?.length);
        if (payload.error === "publish_blocked" && facts.length && hasOnlyFacts) {
          setPendingFactConfirm(facts);
          setFactsConfirmed(false);
          setMessages((items) => [...items, {
            id: crypto.randomUUID(), role: "assistant", status: "warning",
            text: "草稿包含待确认的数字/认证/性能等声明，请先人工核对确认后发布。",
            change: `待确认：${facts.slice(0, 4).join("、")}`,
          }]);
          return;
        }
        const qualityIssues = payload.quality
          ? [...(payload.quality.missingSlots ?? []), ...(payload.quality.placeholderHits ?? []), ...(payload.quality.unverifiedFacts ?? [])]
          : [];
        const blockedByQuality = payload.error === "publish_blocked";
        setMessages((items) => [...items, {
          id: crypto.randomUUID(),
          role: "assistant",
          status: "warning",
          text: blockedByQuality ? "发布前仍有内容需要人工确认或补全。" : payload.message || "当前内容还不能发布，请先处理提示中的问题。",
          change: qualityIssues.length ? `待处理：${qualityIssues.slice(0, 4).join("、")}` : payload.error || "发布未完成",
        }]);
        return;
      }
      setMessages((items) => [...items, {
        id: crypto.randomUUID(),
        role: "assistant",
        status: "applied",
        text: `已发布版本 v${payload.release?.version ?? ""}，公开页读取的是独立发布快照。`,
        change: "草稿后续编辑不会改变当前线上版本",
      }]);
      setPendingFactConfirm(null);
      setFactsConfirmed(false);
      window.open(`/published/${encodeURIComponent(siteId)}`, "_blank", "noopener,noreferrer");
    } catch (error) {
      setMessages((items) => [...items, { id: crypto.randomUUID(), role: "assistant", status: "error", text: error instanceof Error ? error.message : "发布失败", change: "当前草稿未修改" }]);
    } finally {
      if (publishRequestKeyRef.current === idempotencyKey) publishRequestKeyRef.current = null;
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
        <div
          className="chat-messages"
          ref={messagesRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-busy={busy}
          onScroll={(event) => {
            const node = event.currentTarget;
            messagesNearBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight <= 96;
          }}
        >
          {messages.map((message) => (
            <div className={`message ${message.role} ${message.status ?? ""}`} key={message.id}>
              <div className="message-label">{message.role === "assistant" ? <><Sparkles size={10} style={{ verticalAlign: "middle", marginRight: 4 }} />SITECRAFT AI</> : "YOU"}</div>
              <div className="message-bubble">{message.text}</div>
              {message.retryText && <button className="hint" type="button" onClick={() => { setInput(message.retryText ?? ""); window.requestAnimationFrame(() => inputRef.current?.focus()); }}>重新填写原始指令</button>}
              {message.change && <div className={`change-summary ${message.status ?? ""}`}>{message.status === "error" || message.status === "warning" ? <AlertCircle size={11} /> : message.status === "syncing" ? <LoaderCircle className="spin" size={11} /> : <Check size={11} />}<span>{message.status === "applied" ? "已应用" : message.status === "syncing" ? "同步中" : message.status === "no_change" ? "未修改" : "注意"}：{message.change}{message.meta ? ` · ${message.meta}` : ""}</span></div>}
              {message.diff && message.diff.length > 0 && (
                <div className="change-diff" aria-label="字段级差异">
                  <div className="change-diff-head"><strong>字段变化</strong><span>共 {message.diff.length} 项</span></div>
                  {message.diff.slice(0, 6).map((item) => (
                    <div className="change-diff-row" key={`${message.id}-${item.target}`}>
                      <div className="change-diff-label">{item.label}</div>
                      <div className="change-diff-values"><del title="修改前">{item.before || "未填写"}</del><span aria-hidden="true">→</span><ins title="修改后">{item.after || "未填写"}</ins></div>
                    </div>
                  ))}
                  {message.diff.length > 6 && <div className="change-diff-more">另有 {message.diff.length - 6} 项字段变化，已保存到草稿历史。</div>}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="message assistant"><div className="message-label"><Sparkles size={10} style={{ verticalAlign: "middle", marginRight: 4 }} />SITECRAFT AI</div><div className="message-bubble busy-message"><LoaderCircle className="spin" size={13} /><span>{busyText}</span><button className="hint busy-cancel" type="button" onClick={cancelChatRequest} aria-label="取消 AI 请求">取消</button></div></div>}
          <div ref={messagesEndRef} />
        </div>
        <div className="chat-input-wrap">
          {selectedTarget && <div className="chat-target"><span>正在修改：{selectedTarget.label}</span><button aria-label="清除修改目标" onClick={() => setSelectedTarget(null)} type="button"><X size={12} /></button></div>}
          {pendingDestructive && (
            <div className="destructive-confirm" role="alertdialog" aria-modal="true" aria-labelledby="destructive-confirm-title" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); void confirmDestructive(false); } }}>
              <div className="destructive-confirm-title" id="destructive-confirm-title"><AlertCircle size={13} />确认执行以下操作</div>
              <ul className="destructive-confirm-list">{pendingDestructive.destructive.map((item) => <li key={item}>{item}</li>)}</ul>
              <div className="destructive-confirm-actions">
                <button className="secondary-button" autoFocus onClick={() => void confirmDestructive(false)} disabled={busy}>取消</button>
                <button className="primary-button" onClick={() => void confirmDestructive(true)} disabled={busy}>确认执行</button>
              </div>
            </div>
          )}
          <form className="chat-input" onSubmit={submitChat}>
            <textarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitChat(); } }} placeholder={draftReady && !activeTemplateCapabilities ? "正在识别模板可编辑位置..." : "告诉 AI 你想怎么改..."} rows={2} />
            <button className="send-button" type="submit" disabled={!input.trim() || busy || !draftReady || !activeTemplateCapabilities} aria-label="发送"><Send size={14} /></button>
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
            <Link className="secondary-button" href={`/leads?siteKey=${encodeURIComponent(siteId)}`}><MessageSquareText size={14} />询盘</Link>
            {selectedTarget && sectionFromTarget(selectedTarget.key) && (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setRegenerateDialog({ section: sectionFromTarget(selectedTarget.key), label: selectedTarget.label })}
              >
                <Sparkles size={14} />重生成此板块
              </button>
            )}
            <button
              className="secondary-button"
              disabled={busy || siteId === "demo"}
              onClick={() => {
                // 换方向重新生成：回生成页带 ?siteId，复用现有站点（覆盖内容，历史可撤销）
                if (window.confirm("换方向重新生成会覆盖当前站点内容（可通过历史撤销），继续？")) {
                  void router.push(`/generate?siteId=${siteId}`);
                }
              }}
            >
              <RefreshCw size={14} />换方向重新生成
            </button>
            <button className="primary-button" type="button" onClick={() => void publishSite()} disabled={busy || siteId === "demo"}><Globe2 size={14} />发布</button>
          </div>
          {pendingFactConfirm && pendingFactConfirm.length > 0 && (
            <div className="preview-fact-confirm" role="status" aria-live="polite">
              <div className="preview-fact-confirm-title"><AlertCircle size={14} />发布前需确认以下事实声明</div>
              <ul className="preview-fact-confirm-list">
                {pendingFactConfirm.slice(0, 6).map((fact) => <li key={fact}>{fact}</li>)}
                {pendingFactConfirm.length > 6 && <li>… 及另外 {pendingFactConfirm.length - 6} 项</li>}
              </ul>
              <p className="preview-fact-confirm-hint">请核对以上数字/认证/性能等声明是否与真实情况一致。确认属实后即可发布；不属实请先在工作台修改对应内容。</p>
              <div className="preview-fact-confirm-actions">
                <label className="preview-fact-confirm-check"><input type="checkbox" checked={factsConfirmed} onChange={(event) => setFactsConfirmed(event.target.checked)} /> 我已核对，以上事实属实</label>
                <button className="primary-button" type="button" disabled={!factsConfirmed || busy} onClick={() => void publishSite({ factsConfirmed: true })}><Globe2 size={14} />确认并发布</button>
                <button className="secondary-button" type="button" disabled={busy} onClick={() => { setPendingFactConfirm(null); setFactsConfirmed(false); }}>暂不发布</button>
              </div>
            </div>
          )}
        </header>
        <div className="preview-stage">
          {showGuide && (
            <div className="generate-guide-note" role="status">
              <div className="generate-guide-title"><Sparkles size={14} />初稿已生成，接下来你可以：</div>
              <div className="generate-guide-actions">
                <button onClick={() => { setShowGuide(false); }}>继续用对话改内容</button>
                <button onClick={() => { setShowGuide(false); window.location.href = "/templates"; }}>换个模板</button>
                <button onClick={() => { setShowGuide(false); window.location.href = `/workspace?siteId=${siteId}&import=products`; }}>导入商品</button>
              </div>
              <button className="generate-guide-close" aria-label="关闭提示" onClick={() => setShowGuide(false)}><X size={12} /></button>
            </div>
          )}
          <div className={`browser-frame ${device}`}><div className="browser-bar"><span className="browser-dot" /><span className="browser-dot" /><span className="browser-dot" /><div className="browser-url">forge-industrial.sites.ai</div><CircleHelp size={11} color="#adb8af" /></div>{draftReady && <OpenSourceTemplateFrame key={`real-${previewFrameKey}`} templateId={draft.templateId} draft={draft} locale={locale} variant="workspace" expectedTargets={expectedTargets} onSelectTarget={selectPreviewTarget} onApplyReport={handlePreviewReport} onPreviewStateChange={handlePreviewFrameState} />}</div>
        </div>
      </main>
      {showImport && (
        <div className="modal-backdrop" onClick={() => setShowImport(false)}><div className="import-modal" onClick={(event) => event.stopPropagation()}>
          <div className="modal-head"><div><div className="eyebrow">Content / Products</div><h3>填充你的商品目录</h3></div><button className="icon-button" onClick={() => setShowImport(false)} aria-label="关闭"><X size={15} /></button></div>
          <p className="modal-copy">上传 CSV 或 XLSX 商品表格，校验后直接保存为可撤销草稿。AI 可以继续修改指定 SKU 的中英文名称、简介和分类。</p>
          <div className="upload-zone" onClick={() => fileRef.current?.click()}><input ref={fileRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={handleFile} /><div className="upload-icon"><CloudUpload size={20} /></div><strong>点击上传表格</strong><span>需要包含 SKU、产品名称、分类等字段</span><small>CSV / XLSX · 最多 1000 行</small></div>
          <div className="import-options"><div><FileSpreadsheet size={15} /><span>支持中英文列名自动识别</span><ChevronRight size={13} style={{ marginLeft: "auto" }} /></div><div><ImageIcon size={15} /><span>可选"图片/图片URL"列填产品主图</span><ChevronRight size={13} style={{ marginLeft: "auto" }} /></div></div>
          {importState && <div className={`import-result ${importState.imported ? "" : "error"}`}>{importState.imported ? <Check size={14} /> : <AlertCircle size={14} />}<div><strong>{importState.name} {importState.imported ? "已保存" : "导入失败"}</strong><span>{importState.imported ? `新增或更新 ${importState.imported} 个商品` : importState.errors[0]}{importState.imported && importState.errors.length ? `，${importState.errors.length} 行需要检查` : ""}</span></div></div>}
          <div className="modal-foot"><span>当前草稿商品：{draft.products.length} / 1000</span><button className="primary-button" onClick={() => setShowImport(false)}>完成</button></div>
        </div></div>
      )}
      {regenerateDialog && (
        <div className="modal-backdrop" onClick={() => setRegenerateDialog(null)}><div className="import-modal" onClick={(event) => event.stopPropagation()}>
          <div className="modal-head"><div><div className="eyebrow">Regenerate</div><h3>重生成 {regenerateDialog.label}</h3></div><button className="icon-button" onClick={() => setRegenerateDialog(null)} aria-label="关闭"><X size={15} /></button></div>
          <p className="modal-copy">只重生成这个板块，其余内容保持不动。可输入想改的方向（留空按当前模板风格重写）。</p>
          <textarea
            className="generate-textarea"
            value={regenerateDirection}
            onChange={(e) => setRegenerateDirection(e.target.value)}
            placeholder="例如：改成环保主题 / 更突出性价比"
            rows={2}
            maxLength={200}
          />
          {error && <p className="generate-error"><AlertCircle size={13} />{error}</p>}
          <div className="modal-foot">
            <span>将保持模板的配色、字体与风格</span>
            {busy && <button className="secondary-button" type="button" onClick={() => chatAbortRef.current?.abort()}>取消重生成</button>}
            <button className="primary-button" disabled={busy} onClick={() => void submitRegenerate(regenerateDialog.section, regenerateDirection)}>
              {busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}
              {busy ? busyText : "重生成此板块"}
            </button>
          </div>
        </div></div>
      )}
    </div>
  );
}
