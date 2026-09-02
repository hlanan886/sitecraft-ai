"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  MessageSquareText,
  Sparkles,
  WandSparkles,
  LoaderCircle,
  AlertCircle,
  Eye,
  EyeOff,
  ExternalLink,
} from "lucide-react";
import { useMemo, useRef, useState, useEffect } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { OpenSourceTemplateFrame } from "@/components/open-source-template-frame";
import { SiteRenderer } from "@/components/site-renderer";
import { templates, type SiteDraft } from "@/lib/site-model";
import { defaultDraft } from "@/lib/site-document";
import { deriveDesignTokenResult } from "@/lib/design-variants";

type Intent = {
  businessType: string;
  companyName: string;
  industry: string;
  targetAudience: string;
  tone: string;
  colorTone?: string;
  coreSections: string[];
  recommendedTemplateId: string;
  summary: string;
  status?: "ready" | "need_info" | "rejected";
  notices?: string[];
  needsInfo?: string[];
  conflicts?: string[];
  limits?: string[];
  rejectionReason?: string;
};
type TemplateMatch = { id: string; name: string; category: string; reason: string };
type Step = "input" | "clarify" | "confirm" | "generating" | "done";
type ClarifyState = { needsInfo: string[] };

const GENERATE_DRAFT_KEY = "sitecraft:generate-draft:v1";
const ACTIVE_GENERATION_KEY = "sitecraft:active-generation:v1";
// "查看真实预览"：把用户改后的预览草稿带给新标签页的真实模板预览，避免显示模板默认内容
const REAL_PREVIEW_DRAFT_KEY = "sitecraft:real-preview-draft:v1";

const examples = [
  "做个光伏出口企业的官网，主打欧美，要显得专业可靠",
  "帮我的 SaaS 团队做官网，用户是海外开发者",
  "工业零部件厂的官网，突出质量和服务",
  "设计咨询公司的作品集网站",
];

const BUSINESS_LABELS: Record<string, string> = {
  manufacturing: "工业制造",
  trade: "外贸",
  tech: "科技",
  services: "专业服务",
  other: "其他",
};
const AUDIENCE_LABELS: Record<string, string> = {
  overseasB2b: "海外企业",
  domesticB2b: "国内企业",
  globalB2b: "全球企业",
  endUsers: "终端用户",
  investorsPartners: "投资人/伙伴",
  other: "其他",
};
const TONE_LABELS: Record<string, string> = {
  professional: "专业",
  technical: "技术",
  friendly: "友好",
  bold: "大胆",
  minimal: "极简",
  editorial: "编辑式",
};
const SECTIONS_LABELS: Record<string, string> = {
  hero: "首屏",
  about: "关于",
  features: "优势",
  services: "服务",
  products: "产品",
  contact: "联系",
};

function readSseEvents(raw: string) {
  const lastCompleteEvent = raw.lastIndexOf("\n\n");
  if (lastCompleteEvent < 0) return [];
  return raw
    .slice(0, lastCompleteEvent)
    .split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("data: "))?.slice(6))
    .filter(Boolean)
    .map((value) => JSON.parse(value as string) as Record<string, unknown>);
}

export default function GeneratePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("input");
  const [message, setMessage] = useState("");
  // P1 导入：用户粘贴的公司简介/产品清单（选填，以用户信息为准）
  const [extraContext, setExtraContext] = useState("");
  const [draftRestored, setDraftRestored] = useState(false);
  const draftHydrated = useRef(false);
  const pageActive = useRef(true);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [template, setTemplate] = useState<TemplateMatch | null>(null);
  const [recommendedTemplate, setRecommendedTemplate] = useState<TemplateMatch | null>(null);
  const [templatePreviewState, setTemplatePreviewState] = useState<"loading" | "ready" | "error">("loading");
  const carouselRef = useRef<HTMLDivElement>(null);
  const [recommendationIndex, setRecommendationIndex] = useState(0);
  const [hiddenSections, setHiddenSections] = useState<string[]>([]);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [previewFeedback, setPreviewFeedback] = useState<{ section: string; mode: "show" | "hide" } | null>(null);
  const previewFeedbackTimer = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressText, setProgressText] = useState("");
  const [generationPhase, setGenerationPhase] = useState<"content" | "review" | "saving">("content");
  const [completedSections, setCompletedSections] = useState<string[]>([]);
  const [activeSections, setActiveSections] = useState<string[]>([]);
  const [recoveringSections, setRecoveringSections] = useState<string[]>([]);
  const [failedSections, setFailedSections] = useState<string[]>([]);
  const [generationElapsed, setGenerationElapsed] = useState(0);
  const [generationDuration, setGenerationDuration] = useState<number | null>(null);
  const generationStartedAt = useRef<number | null>(null);
  const [clarifyState, setClarifyState] = useState<ClarifyState | null>(null);
  const [clarifyText, setClarifyText] = useState("");
  const [siteLanguage, setSiteLanguage] = useState<"zh" | "en">("zh");
  // 多轮迭代：全量对话历史（超越 clarify 追问，覆盖「确认后还想改」的整条链路）
  const [history, setHistory] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  // 从确认页回来继续调整（输入态变为「调整模式」）
  const [adjusting, setAdjusting] = useState(false);
  // 再生模式：?siteId 存在时复用现有站点重新生成（不创建新站）
  const [regenerateSiteId, setRegenerateSiteId] = useState<string | null>(null);
  // 追问轮缓存：模型在 need_info 时已识别的模板推荐，补全后随 previousIntent 带回，避免推荐丢失
  const [pendingTemplateRecommendation, setPendingTemplateRecommendation] = useState<string | null>(null);

  const category = template?.category ?? "";
  // 放开跨分类选择：下拉列出全部模板（推荐分类排前），不把用户锁死在 category 内
  const templateOptions = useMemo(() => {
    const order = (t: { category: string }) =>
      t.category === category ? 0 : t.category === (intent && BUSINESS_LABELS[intent.businessType]) ? 1 : 2;
    return templates.map((t) => ({ ...t, _order: order(t) }))
      .sort((a, b) => a._order - b._order || a.category.localeCompare(b.category, "zh") || a.name.localeCompare(b.name, "zh"));
  }, [category, intent?.businessType]);
  const recommendationTemplates = useMemo<TemplateMatch[]>(() => {
    const options = templates.map((item) => ({ id: item.id, name: item.name, category: item.category, reason: "AI 根据你的业务方向推荐" }));
    const primary = options.find((item) => item.id === intent?.recommendedTemplateId) ?? options[0];
    const pool = primary ? [primary, ...options.filter((item) => item.id !== primary.id)] : options;
    return pool.slice(0, 3);
  }, [intent?.recommendedTemplateId]);
  // 风格切换：确认页可手动选色板（覆盖 intent 推断），实时预览并随生成持久化
  const [styleTone, setStyleTone] = useState<string>("");
  const effectiveColorTone = styleTone || intent?.colorTone || "";
  const designTokenResult = useMemo(
    () => intent && template ? deriveDesignTokenResult({ ...intent, colorTone: effectiveColorTone }, template.id) : null,
    [intent, template, effectiveColorTone],
  );
  const previewDraft = useMemo<SiteDraft>(() => ({
    ...defaultDraft,
    templateId: template?.id ?? defaultDraft.templateId,
    siteName: intent?.companyName ?? defaultDraft.siteName,
    companyName: intent?.companyName ?? defaultDraft.companyName,
    industry: intent?.industry ?? defaultDraft.industry,
    hiddenSections: (previewFeedback?.mode === "hide"
      ? hiddenSections.filter((section) => section !== previewFeedback.section)
      : hiddenSections) as SiteDraft["hiddenSections"],
    designTokens: designTokenResult?.tokens ?? null,
  }), [designTokenResult?.tokens, hiddenSections, intent?.companyName, intent?.industry, previewFeedback?.mode, previewFeedback?.section, template?.id]);

  useEffect(() => {
    setTemplatePreviewState("loading");
  }, [template?.id]);

  const chooseRecommendation = (candidate: TemplateMatch, index: number) => {
    setTemplate((current) => ({ ...(current ?? candidate), ...candidate }));
    setRecommendationIndex(index);
    setTemplatePreviewState("loading");
    window.requestAnimationFrame(() => {
      const card = carouselRef.current?.querySelector<HTMLElement>(`[data-template-card="${candidate.id}"]`);
      card?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    });
  };

  const moveRecommendation = (direction: -1 | 1) => {
    if (!recommendationTemplates.length) return;
    const next = (recommendationIndex + direction + recommendationTemplates.length) % recommendationTemplates.length;
    chooseRecommendation(recommendationTemplates[next], next);
  };
  const generationSections = useMemo(
    () => ["hero", ...(intent?.coreSections ?? []).filter((section) => !hiddenSections.includes(section))],
    [hiddenSections, intent?.coreSections],
  );
  const generationSectionState = (section: string) => {
    if (completedSections.includes(section)) return "done";
    if (failedSections.includes(section)) return "failed";
    if (recoveringSections.includes(section)) return "recovering";
    if (activeSections.includes(section) && generationPhase === "content") return "active";
    return "waiting";
  };

  // 再生模式：工作台「换方向重新生成」带 ?siteId 进入 → 复用现有站点重新生成
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const siteId = q.get("siteId");
    if (siteId) setRegenerateSiteId(siteId);
    const qText = q.get("q");
    if (qText) {
      // 从模板页「一句话」入口预填：query 优先于草稿恢复
      setMessage(qText.slice(0, 400));
      setDraftRestored(false);
    }
    const qTemplateId = q.get("templateId");
    if (qTemplateId && templates.some((t) => t.id === qTemplateId)) {
      const t = templates.find((item) => item.id === qTemplateId);
      if (t) setTemplate({ id: t.id, name: t.name, category: t.category, reason: "从模板页选择的方向" });
    }
    return () => { pageActive.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const restoreActiveGeneration = async () => {
      try {
        const raw = window.sessionStorage.getItem(ACTIVE_GENERATION_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw) as { siteId?: unknown; baseRevision?: unknown };
        if (typeof saved.siteId !== "string" || typeof saved.baseRevision !== "number") {
          window.sessionStorage.removeItem(ACTIVE_GENERATION_KEY);
          return;
        }
        const response = await fetch(`/api/sites/${saved.siteId}/draft`, { cache: "no-store" });
        if (!response.ok) throw new Error("无法读取上次生成任务");
        const payload = await response.json() as { draft?: { revision?: unknown } };
        const revision = typeof payload.draft?.revision === "number" ? payload.draft.revision : 0;
        if (cancelled) return;
        if (revision > saved.baseRevision) {
          window.sessionStorage.removeItem(ACTIVE_GENERATION_KEY);
          router.replace(`/workspace?siteId=${saved.siteId}&generated=1&recovered=1`);
          return;
        }
        setRegenerateSiteId(saved.siteId);
        setError("检测到上次未完成的建站任务，已保留原站点。确认需求后可继续生成，不会重复创建网站。");
      } catch {
        window.sessionStorage.removeItem(ACTIVE_GENERATION_KEY);
      }
    };
    void restoreActiveGeneration();
    return () => { cancelled = true; };
  }, [router]);

  useEffect(() => {
    // query 预填（?q=）优先于历史草稿恢复，避免旧草稿覆盖模板页带入的话
    if (new URLSearchParams(window.location.search).get("q")) {
      draftHydrated.current = true;
      return;
    }
    try {
      const raw = window.sessionStorage.getItem(GENERATE_DRAFT_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { message?: unknown; extraContext?: unknown };
      const restoredMessage = typeof saved.message === "string" ? saved.message.slice(0, 400) : "";
      const restoredContext = typeof saved.extraContext === "string" ? saved.extraContext.slice(0, 2000) : "";
      if (restoredMessage || restoredContext) {
        setMessage(restoredMessage);
        setExtraContext(restoredContext);
        setDraftRestored(true);
      }
    } catch {
      window.sessionStorage.removeItem(GENERATE_DRAFT_KEY);
    } finally {
      draftHydrated.current = true;
    }
  }, []);

  useEffect(() => {
    if (!draftHydrated.current) return;
    const timer = window.setTimeout(() => {
      try {
        if (message || extraContext) {
          window.sessionStorage.setItem(GENERATE_DRAFT_KEY, JSON.stringify({ message, extraContext }));
        } else {
          window.sessionStorage.removeItem(GENERATE_DRAFT_KEY);
        }
      } catch {
        // Draft recovery is optional; storage restrictions must not block generation.
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [extraContext, message]);

  const analyze = async (text: string) => {
    setBusy(true);
    setError(null);
    setProgressText("正在理解你的需求…");
    try {
      // 多轮迭代：全量 history（slice(-10) 对齐服务端 cap）+ 上一轮意图基线（增量更新）
      const res = await fetch(`/api/sites/demo/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: "analyze",
          message: text,
          history: history.slice(-10),
          ...(intent ? { previousIntent: intent } : {}),
          ...(extraContext.trim() ? { extraContext: extraContext.trim() } : {}),
        }),
      });
      const reader = res.body?.getReader();
      if (!reader) throw new Error("无法读取响应");
      const decoder = new TextDecoder();
      let raw = "";
      let done: Record<string, unknown> | undefined;
      while (true) {
        const result = await reader.read();
        raw += decoder.decode(result.value ?? new Uint8Array(), { stream: !result.done });
        const events = readSseEvents(raw);
        const status = [...events].reverse().find((e) => e.type === "status");
        if (typeof status?.value === "string") setProgressText(status.value);
        done = events.find((e) => e.type === "done");
        if (result.done) break;
      }
      if (!done) throw new Error("没有返回结果");
      if (done.status === "error") throw new Error(String(done.error || "分析失败"));
      if (done.status !== "ready") throw new Error(`意外状态 ${done.status}`);
      const parsedIntent = done.intent as Intent;
      const intentStatus = parsedIntent.status ?? "ready"; // 旧后端/旧模型兼容
      if (intentStatus === "need_info") {
        const needsInfo = parsedIntent.needsInfo ?? [];
        // 缓存模型已识别的模板推荐（need_info 时 done.template 为空，但 intent.recommendedTemplateId 可能已有）
        // 同时种入 intent 基线，让后续追问轮作为 previousIntent 传给模型，推荐不丢失
        if (parsedIntent.recommendedTemplateId) {
          setPendingTemplateRecommendation(parsedIntent.recommendedTemplateId);
          setIntent({
            businessType: parsedIntent.businessType ?? "other",
            companyName: parsedIntent.companyName ?? "",
            industry: parsedIntent.industry ?? "",
            targetAudience: parsedIntent.targetAudience ?? "other",
            tone: parsedIntent.tone ?? "professional",
            coreSections: parsedIntent.coreSections ?? ["hero", "about", "services", "products", "contact"],
            recommendedTemplateId: parsedIntent.recommendedTemplateId,
            summary: parsedIntent.summary ?? "",
          });
        }
        // 追问轮次写入全量 history（顶层），不再用局部 clarifyState.history
        setHistory((h) => [...h, { role: "user", text }, { role: "assistant", text: needsInfo.join("；") }]);
        setClarifyState({ needsInfo });
        setStep("clarify");
        return;
      }
      if (intentStatus === "rejected") {
        // 重新开始：清空迭代状态回干净起点
        setHistory([]);
        setError(parsedIntent.rejectionReason ?? "该需求超出建站范围，我无法帮你完成。");
        setStep("input");
        return;
      }
      // ready：本轮对话入历史；保留已折叠板块（迭代轮不覆盖用户勾选）
      setHistory((h) => [...h, { role: "user", text }, { role: "assistant", text: parsedIntent.summary }]);
      setIntent(parsedIntent);
      setTemplate(done.template as TemplateMatch);
      setRecommendedTemplate(done.template as TemplateMatch);
      setHiddenSections((prev) => {
        const next = (done.hiddenSections as string[]) ?? [];
        return next.length ? next : prev;
      });
      setSiteLanguage((done.siteLanguage as "zh" | "en") ?? "zh");
      setAdjusting(false);
      setStep("confirm");
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析失败");
      setStep(clarifyState ? "clarify" : "input");
    } finally {
      setBusy(false);
    }
  };

  const toggleSection = (section: string) => {
    if (previewFeedbackTimer.current) window.clearTimeout(previewFeedbackTimer.current);
    const isHidden = hiddenSections.includes(section);
    setPreviewFeedback({ section, mode: isHidden ? "show" : "hide" });
    if (isHidden) {
      setHiddenSections((prev) => prev.filter((item) => item !== section));
      previewFeedbackTimer.current = window.setTimeout(() => setPreviewFeedback(null), 520);
      return;
    }
    // Product state must commit immediately; the timer owns visual feedback only.
    setHiddenSections((prev) => prev.includes(section) ? prev : [...prev, section]);
    previewFeedbackTimer.current = window.setTimeout(() => {
      setPreviewFeedback(null);
    }, 240);
  };

  useEffect(() => () => {
    if (previewFeedbackTimer.current) window.clearTimeout(previewFeedbackTimer.current);
  }, []);

  const execute = async () => {
    if (!intent || !template) return;
    setBusy(true);
    setError(null);
    setStep("generating");
    generationStartedAt.current = performance.now();
    setGenerationDuration(null);
    setGenerationPhase("content");
    setCompletedSections([]);
    setActiveSections(generationSections);
    setRecoveringSections([]);
    setFailedSections([]);
    setGenerationElapsed(0);
    const sessionId = window.sessionStorage.getItem("sitecraft-session") ?? crypto.randomUUID();
    window.sessionStorage.setItem("sitecraft-session", sessionId);
    setProgressText(regenerateSiteId ? "正在为现有站点重新生成内容…" : "正在为所选模板生成内容…");
    try {
      // 再生模式：复用现有站点（不创建新站）；否则创建新站点（locales 跟随站点语言）
      let siteId = regenerateSiteId;
      if (!siteId) {
        const siteRes = await fetch(`/api/sites`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: intent.companyName, templateId: template.id, locales: siteLanguage === "en" ? ["en"] : ["zh", "en"] }),
        });
        const sitePayload = await siteRes.json().catch(() => null);
        if (!siteRes.ok || typeof sitePayload?.id !== "string") throw new Error("创建网站失败，请稍后重试");
        siteId = sitePayload.id;
      }
      // 2. 读初始 revision
      const draftRes = await fetch(`/api/sites/${siteId}/draft`, { cache: "no-store" });
      if (!draftRes.ok) throw new Error("读取网站草稿失败，请稍后重试");
      const draftPayload = await draftRes.json();
      const baseRevision = draftPayload.draft?.revision ?? 1;
      window.sessionStorage.setItem(ACTIVE_GENERATION_KEY, JSON.stringify({ siteId, baseRevision, startedAt: Date.now() }));
      // 3. 执行生成
      const res = await fetch(`/api/sites/${siteId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: "execute",
          message,
          // 用户手动选过风格 → 用 effectiveColorTone 覆盖 intent，保证生成结果与预览一致
          intent: styleTone ? { ...intent, colorTone: styleTone } : intent,
          templateId: template.id,
          siteLanguage,
          hiddenSections,
          baseRevision,
          sessionId,
        }),
      });
      const reader = res.body?.getReader();
      if (!reader) throw new Error("无法读取生成结果");
      const decoder = new TextDecoder();
      let raw = "";
      let done: Record<string, unknown> | undefined;
      while (true) {
        const result = await reader.read();
        raw += decoder.decode(result.value ?? new Uint8Array(), { stream: !result.done });
        const events = readSseEvents(raw);
        const status = [...events].reverse().find((e) => e.type === "status");
        if (typeof status?.value === "string") setProgressText(status.value);
        if (status?.phase === "content" || status?.phase === "review" || status?.phase === "saving") setGenerationPhase(status.phase);
        if (Array.isArray(status?.completedSections)) setCompletedSections(status.completedSections.filter((item): item is string => typeof item === "string"));
        if (Array.isArray(status?.activeSections)) setActiveSections(status.activeSections.filter((item): item is string => typeof item === "string"));
        if (Array.isArray(status?.recoveringSections)) setRecoveringSections(status.recoveringSections.filter((item): item is string => typeof item === "string"));
        if (Array.isArray(status?.failedSections)) setFailedSections(status.failedSections.filter((item): item is string => typeof item === "string"));
        done = events.find((e) => e.type === "done");
        if (result.done) break;
      }
      if (!done) throw new Error("生成没有返回结果");
      if (done.status === "error") throw new Error(String(done.error || "生成失败"));
      if (done.status === "conflict") throw new Error("草稿冲突，请重试");
      window.sessionStorage.removeItem(ACTIVE_GENERATION_KEY);
      if (!pageActive.current) return;
      if (generationStartedAt.current !== null) setGenerationDuration(Math.round(performance.now() - generationStartedAt.current));
      setStep("done");
      // P0-2：批 B 失败时 partial=true，提示板块未完整生成（避免用户以为全是默认模板文案）
      const partial = Boolean((done as { partial?: boolean }).partial);
      const missingSections = Array.isArray((done as { missingSections?: string[] }).missingSections)
        ? ((done as { missingSections?: string[] }).missingSections ?? [])
        : [];
      const fallbackReason = typeof done.templateFallbackReason === "string" ? done.templateFallbackReason : "";
      const completionNotices = [
        fallbackReason,
        partial ? `部分板块未完整生成（${missingSections.join("、") || "板块内容"}），已保存首屏与已生成内容。可在工作台继续让 AI 补全。` : "",
      ].filter(Boolean);
      if (completionNotices.length) setError(completionNotices.join("；"));
      setTimeout(() => {
        if (!pageActive.current) return;
        try {
          window.sessionStorage.removeItem(GENERATE_DRAFT_KEY);
        } catch {
          // Successful navigation must continue even when storage is unavailable.
        }
        router.push(`/workspace?siteId=${siteId}&generated=1${partial ? "&partial=1" : ""}`);
      }, partial || fallbackReason ? 4000 : 1200);
    } catch (e) {
      if (pageActive.current) {
        setError(e instanceof Error ? e.message : "生成失败");
        setStep("confirm");
      }
    } finally {
      if (pageActive.current) setBusy(false);
    }
  };

  useEffect(() => {
    if (step !== "generating" || generationStartedAt.current === null) return;
    const updateElapsed = () => setGenerationElapsed(Math.floor((performance.now() - generationStartedAt.current!) / 1000));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [step]);

  return (
    <div className="app-shell">
      <AppSidebar active="sites" />
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            <Link href="/"><ArrowLeft size={14} /></Link>
            <ChevronRight size={12} />
            <strong>用一句话开始</strong>
          </div>
          <div className="top-actions">
            <span className="eyebrow">{step === "input" ? "Step 01 / 03" : step === "confirm" ? "Step 02 / 03" : "Step 03 / 03"}</span>
          </div>
        </header>
        <div className="page-content">
          {step === "input" && (
            <div className="generate-input">
              <div className="eyebrow">{adjusting ? "继续调整需求" : "✨ 自然语言建站"}</div>
              <h1>
                {adjusting ? (
                  <>还想怎么改？<br /><span style={{ color: "#2e6b4f" }}>继续聊，我接着调。</span></>
                ) : (
                  <>用一段对话，<br /><span style={{ color: "#2e6b4f" }}>变成一座网站。</span></>
                )}
              </h1>
              <p>{adjusting ? "在已确认的需求上继续说，AI 只改你提到的地方。" : "描述你的业务，AI 帮你选模板、出初稿，再进工作台精修。"}</p>
              <textarea
                className="generate-textarea"
                value={message}
                onChange={(e) => { setMessage(e.target.value); setDraftRestored(false); }}
                placeholder={adjusting ? "例如：改成日系风格 / 加上预约功能" : "例如：做个光伏出口企业的官网，主打欧美，要显得专业可靠"}
                rows={3}
                maxLength={400}
              />
              <div className="generate-char-count">{message.trim().length}/400</div>
              {!adjusting && (
                <div className="generate-examples">
                  {examples.map((ex) => (
                    <button key={ex} className="generate-chip" onClick={() => setMessage(ex)}>
                      {ex}
                    </button>
                  ))}
                </div>
              )}
              {!adjusting && (
                <details className="generate-import">
                  <summary>有现成的公司简介或产品清单？粘贴进来（选填，让内容更准）</summary>
                  <textarea
                    className="generate-textarea"
                    value={extraContext}
                    onChange={(e) => { setExtraContext(e.target.value); setDraftRestored(false); }}
                    placeholder="粘贴公司简介/产品清单，例如：华辰光伏成立于 2001 年，专注光伏组件与逆变器制造，通过 ISO 9001 认证，产品销往欧美……"
                    rows={4}
                    maxLength={2000}
                  />
                  <div className="generate-char-count">{extraContext.trim().length}/2000</div>
                </details>
              )}
              {error && <p className="generate-error"><AlertCircle size={13} />{error}</p>}
              {draftRestored && <p className="generate-progress" role="status">已恢复刷新前的需求草稿</p>}
              <div className="generate-clarify-actions">
                {adjusting && (
                  <button className="secondary-button" disabled={busy} onClick={() => setStep("confirm")}>
                    返回确认页
                  </button>
                )}
                <button
                  className="primary-button"
                  disabled={!message.trim() || busy}
                  onClick={() => {
                    // 正向检测是否含文字/数字：!!!/组合 emoji/带肤色 emoji 全拦，全角文字正确放行
                    const isEmptyOrSymbolOnly = (s: string) => !/[\p{L}\p{N}]/u.test(s);
                    if (!message.trim() || isEmptyOrSymbolOnly(message)) {
                      setError("请输入文字描述（业务方向、目标用户等），只有表情或符号无法识别。");
                      return;
                    }
                    void analyze(message);
                  }}
                >
                  {busy ? <LoaderCircle size={15} className="spin" /> : <WandSparkles size={15} />}
                  {busy ? progressText : adjusting ? "更新理解" : "开始理解需求"} <ArrowRight size={15} />
                </button>
                {adjusting && (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => {
                      // 重新开始：全量清空迭代状态
                      setHistory([]);
                      setIntent(null);
                      setTemplate(null);
                      setHiddenSections([]);
                      setAdjusting(false);
                      setMessage("");
                      setError(null);
                      setClarifyState(null);
                      setClarifyText("");
                    }}
                  >
                    重新开始
                  </button>
                )}
              </div>
              {busy && <p className="generate-progress">{progressText}</p>}
            </div>
          )}

          {step === "clarify" && clarifyState && (
            <div className="generate-input">
              <div className="eyebrow">还差几个关键信息</div>
              <h1>再告诉我一点，<br /><span style={{ color: "#2e6b4f" }}>才能不瞎猜。</span></h1>
              <p>AI 觉得信息还不够，下面这些问题补充后会更准。也可以留空直接"按默认值继续"。</p>
              <ol className="generate-clarify-list">
                {clarifyState.needsInfo.map((q, i) => (
                  <li key={`${i}-${q}`}>{q}</li>
                ))}
              </ol>
              <textarea
                className="generate-textarea"
                value={clarifyText}
                onChange={(e) => setClarifyText(e.target.value)}
                placeholder="补充回答，例如：我是华辰光伏，做组件出口，客户在欧美"
                rows={3}
                maxLength={400}
              />
              <div className="generate-char-count">{clarifyText.trim().length}/400</div>
              {error && <p className="generate-error"><AlertCircle size={13} />{error}</p>}
              <div className="generate-clarify-actions">
                <button className="secondary-button" disabled={busy} onClick={() => { setClarifyState(null); setClarifyText(""); setError(null); setStep("input"); }}>
                  返回修改
                </button>
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => {
                    const rounds = history.filter((m) => m.role === "user").length;
                    if (rounds >= 3) {
                      // 已追问 3 轮仍信息不足：强制收敛，用默认值（服务端规则 5 转 ready）
                      // 注意：不传空 history——顶层 history 自然携带已收集对话，防丢失
                      setClarifyState(null);
                      void analyze("按默认值继续");
                      return;
                    }
                    // 留空或纯符号 → 也走默认值收敛，不发空串（避免 400）
                    void analyze(clarifyText.trim() || "按默认值继续");
                  }}
                >
                  {busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}
                  {busy ? progressText : "继续理解"} <ArrowRight size={15} />
                </button>
              </div>
              <p className="generate-progress" style={{ marginTop: 12, fontSize: 11, color: "#94a3b8" }}>
                已追问 {history.filter((m) => m.role === "user").length} 轮，最多 3 轮后自动用默认值继续
              </p>
              {busy && <p className="generate-progress">{progressText}</p>}
            </div>
          )}

          {step === "confirm" && intent && template && (
            <div className="generate-confirm">
              <div className="eyebrow">我理解你要的是</div>
              <h1>{intent.summary}</h1>
              <div className="generate-confirm-grid">
                <div className="template-card generate-intent-card">
                  <div className="generate-intent-row">
                    <h3>意图摘要</h3>
                    <div className="generate-intent-rows">
                      <div><span>行业</span><strong>{BUSINESS_LABELS[intent.businessType] ?? intent.businessType} · {intent.industry}</strong></div>
                      <div><span>受众</span><strong>{AUDIENCE_LABELS[intent.targetAudience] ?? intent.targetAudience}</strong></div>
                      <div><span>语气</span><strong>{TONE_LABELS[intent.tone] ?? intent.tone}</strong></div>
                      {intent.colorTone && <div><span>色系</span><strong>{intent.colorTone}</strong></div>}
                    </div>
                  </div>
                  <div className="generate-intent-row">
                    <h3>套用到模板的板块</h3>
                    <div className="generate-sections">
                      {intent.coreSections.map((s) => {
                        const isVisible = !hiddenSections.includes(s);
                        return (
                          <button
                            key={s}
                            type="button"
                            className={`generate-toggle ${isVisible ? "on" : "off"}`}
                            aria-pressed={isVisible}
                            title={isVisible ? `点击隐藏「${SECTIONS_LABELS[s] ?? s}」板块` : `点击重新显示「${SECTIONS_LABELS[s] ?? s}」板块`}
                            onClick={() => toggleSection(s)}
                          >
                            {isVisible ? <Eye size={14} /> : <EyeOff size={14} />}
                            <span>{SECTIONS_LABELS[s] ?? s}</span>
                            <strong>{isVisible ? "已显示" : "已隐藏"}</strong>
                          </button>
                        );
                      })}
                      <span className="generate-sections-hint">点开关可增删要生成的板块</span>
                    </div>
                  </div>
                </div>
                <div className="generate-template-picker" data-template-carousel>
                  {/* 主预览区：随选中模板切换的大图，AI 内容与色板即时套用（问题 1：点卡时上面有对应变化） */}
                  {template && (
                    <div className={`generate-hero-preview${previewCollapsed ? " collapsed" : ""}`} data-template-hero-preview={template.id}>
                      {!previewCollapsed && (
                        <div className="generate-hero-preview-toolbar" aria-hidden="true">
                          <span className="generate-hero-preview-dot" />
                          <span className="generate-hero-preview-dot" />
                          <span className="generate-hero-preview-dot" />
                          <span className="generate-hero-preview-url">{template.name} · 真实模板预览</span>
                        </div>
                      )}
                      {!previewCollapsed && (
                        <div className="generate-hero-preview-frame">
                          {templatePreviewState === "error" ? (
                            <SiteRenderer key={`hero-fallback-${template.id}`} draft={{ ...previewDraft, templateId: template.id }} locale={siteLanguage} mode="preview" />
                          ) : (
                            <OpenSourceTemplateFrame
                              key={`hero-${template.id}`}
                              templateId={template.id}
                              draft={{ ...previewDraft, templateId: template.id }}
                              locale={siteLanguage}
                              variant="preview"
                              onPreviewStateChange={setTemplatePreviewState}
                            />
                          )}
                        </div>
                      )}
                      <div className="generate-hero-preview-meta">
                        <div className="generate-hero-preview-title">
                          <strong>{template.name}</strong>
                          <span>{template.category} · {template.reason || "推荐模板"}</span>
                        </div>
                        <div className="generate-hero-preview-actions">
                          <button
                            type="button"
                            className="generate-preview-collapse-btn"
                            onClick={() => setPreviewCollapsed((c) => !c)}
                            aria-expanded={!previewCollapsed}
                            aria-label={previewCollapsed ? "展开大预览" : "收起大预览"}
                          >
                            {previewCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                            {previewCollapsed ? "展开预览" : "收起预览"}
                          </button>
                          <a
                            className="generate-real-preview-link"
                            href={`/templates/${template.id}/preview`}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`在新标签页查看 ${template.name} 真实预览（含你的内容改动）`}
                            onClick={() => {
                              // 把用户改后的预览草稿（色板/板块/公司名/模板）存起来，
                              // 新打开的"真实预览"页读取并套用，而不是显示模板默认内容。
                              try {
                                window.sessionStorage.setItem(REAL_PREVIEW_DRAFT_KEY, JSON.stringify({ ...previewDraft, templateId: template.id }));
                              } catch { /* 存储不可用时降级为默认模板预览 */ }
                            }}
                          >
                            <ExternalLink size={13} /> 查看真实预览
                          </a>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="generate-preview-heading">
                    <div>
                      <h3>推荐的现有模板</h3>
                      <span>{templatePreviewState === "error" ? "本地结构预览 · 真实模板暂不可用" : "真实模板预览 · AI 内容与设计变量即时套用"}</span>
                    </div>
                    <div className="generate-carousel-controls">
                      <span>{recommendationIndex + 1} / {recommendationTemplates.length}</span>
                      <button type="button" aria-label="上一个推荐模板" onClick={() => moveRecommendation(-1)} disabled={recommendationTemplates.length < 2}><ChevronLeft size={15} /></button>
                      <button type="button" aria-label="下一个推荐模板" onClick={() => moveRecommendation(1)} disabled={recommendationTemplates.length < 2}><ChevronRight size={15} /></button>
                    </div>
                  </div>
                  <div
                    className="generate-template-carousel"
                    ref={carouselRef}
                    onScroll={(event) => {
                      const target = event.currentTarget;
                      const first = target.querySelector<HTMLElement>("[data-template-card]");
                      const cardWidth = first?.getBoundingClientRect().width ?? target.clientWidth;
                      if (cardWidth) setRecommendationIndex(Math.max(0, Math.min(recommendationTemplates.length - 1, Math.round(target.scrollLeft / (cardWidth + 12)))));
                    }}
                  >
                    {recommendationTemplates.map((candidate, index) => {
                      const isActive = index === recommendationIndex;
                      const candidateDraft = candidate.id === template.id ? previewDraft : { ...previewDraft, templateId: candidate.id };
                      return (
                        <article
                          key={candidate.id}
                          className={`generate-template-option${isActive ? " active" : ""}`}
                          data-template-card={candidate.id}
                          onClick={() => chooseRecommendation(candidate, index)}
                          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); chooseRecommendation(candidate, index); } }}
                          role="button"
                          tabIndex={0}
                          aria-label={`选择模板 ${candidate.name}`}
                        >
                          <div className="generate-template-option-label">
                            <span>{isActive ? "当前选择" : "备选模板"}</span>
                            {isActive && <Check size={13} />}
                          </div>
                          <div className="generate-template-option-cover">
                            {isActive && templatePreviewState === "error" ? (
                              <SiteRenderer key={`fallback-${candidate.id}`} draft={candidateDraft} locale={siteLanguage} mode="thumbnail" />
                            ) : (
                              <OpenSourceTemplateFrame
                                key={`real-${candidate.id}`}
                                templateId={candidate.id}
                                draft={candidateDraft}
                                locale={siteLanguage}
                                variant="thumbnail"
                                onPreviewStateChange={isActive ? setTemplatePreviewState : undefined}
                              />
                            )}
                          </div>
                          <div className="generate-template-option-meta">
                            <strong>{candidate.name}</strong>
                            <span>{candidate.category}</span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  <div className="generate-template-selection-meta" data-template-selection={template.id}>
                    <div>
                      <strong>{template.name}</strong>
                      <span>{template.category} · {template.reason}</span>
                    </div>
                  </div>
                  <div className="generate-preview-sections" aria-live="polite">
                    {intent.coreSections.map((s) => (
                      <span key={s} className={`${hiddenSections.includes(s) ? "off" : "on"}${previewFeedback?.section === s ? " active" : ""}`}>
                        {hiddenSections.includes(s) ? <EyeOff size={11} /> : <Eye size={11} />}
                        {SECTIONS_LABELS[s] ?? s}
                      </span>
                    ))}
                  </div>
                  <select
                    className="generate-select"
                    value={template.id}
                    onChange={(e) => {
                      const selected = templates.find((t) => t.id === e.target.value);
                      if (selected) {
                        setTemplate({ ...template, id: selected.id, name: selected.name, category: selected.category });
                        const selectedIndex = recommendationTemplates.findIndex((item) => item.id === selected.id);
                        if (selectedIndex >= 0) setRecommendationIndex(selectedIndex);
                      }
                    }}
                  >
                    {["制造业", "外贸目录", "科技企业", "专业服务"].map((cat) => {
                      const group = templateOptions.filter((t) => t.category === cat);
                      if (!group.length) return null;
                      return (
                        <optgroup key={cat} label={cat === category ? `${cat}（推荐）` : cat}>
                          {group.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                  <div className="generate-style-row">
                    <select
                      className="generate-select"
                      value={effectiveColorTone}
                      onChange={(e) => setStyleTone(e.target.value)}
                      aria-label="选择配色风格"
                    >
                      <option value="">跟随 AI 判断（{effectiveColorTone || "默认"}）</option>
                      <option value="green">绿色系 · 自然/工业</option>
                      <option value="navy">藏蓝系 · 稳重/全球贸易</option>
                      <option value="purple">紫色系 · 科技/创意</option>
                      <option value="dark">深色系 · 高端/极客</option>
                      <option value="warm">暖色系 · 亲和/专业服务</option>
                      <option value="neutral">中性色 · 极简/通用</option>
                      <option value="teal">青碧系 · 现代/外贸</option>
                      <option value="crimson">深红系 · 高端/品牌</option>
                      <option value="indigo">靛蓝系 · SaaS/企业软件</option>
                      <option value="graphite">石墨系 · 工业/机械</option>
                      <option value="forest">森林系 · 制造业/可靠</option>
                      <option value="sky">天蓝系 · 科技/物流</option>
                    </select>
                  </div>
                </div>
              </div>
              {error && <p className="generate-error"><AlertCircle size={13} />{error}</p>}
              {(intent.notices?.length || intent.conflicts?.length || intent.limits?.length) && (
                <div className="generate-tips">
                  {intent.notices?.map((n) => (
                    <div key={n} className="tip notice">ℹ {n}</div>
                  ))}
                  {intent.conflicts?.map((c) => (
                    <div key={c} className="tip conflict">⚠ {c}</div>
                  ))}
                  {intent.limits?.map((l) => (
                    <div key={l} className="tip limit">⛔ {l}</div>
                  ))}
                </div>
              )}
              {designTokenResult?.adjustments.length ? (
                <div className="generate-tips design-coordination-notice" aria-live="polite">
                  {designTokenResult.adjustments.map((adjustment) => (
                    <div key={adjustment} className="tip notice">设计变量已协调：{adjustment}</div>
                  ))}
                </div>
              ) : null}
              {regenerateSiteId && (
                <p className="generate-tips" style={{ marginBottom: 10 }}>
                  <span className="tip notice">ℹ 将在现有站点上重新生成初稿（覆盖当前内容，可通过历史撤销）</span>
                </p>
              )}
              <div className="generate-confirm-actions">
                <button className="secondary-button" disabled={busy} onClick={() => { setAdjusting(true); setStep("input"); }}>
                  <MessageSquareText size={15} /> 还想改 · 继续对话
                </button>
                <button className="primary-button" disabled={busy} onClick={() => void execute()}>
                  {busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}
                  {busy ? progressText : "用此模板生成站点内容"} <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}

          {step === "generating" && (
            <div className="generate-progress-view">
              <div className="eyebrow">复用模板结构 · AI 正在填充内容</div>
              <h1>{intent?.companyName || "你的网站"}</h1>
              <div className={`generate-building-preview ${generationPhase === "content" ? "" : generationPhase}`} aria-hidden="true">
                <div className="generate-building-bar"><i /><i /><i /><span /></div>
                <div className={`generate-building-hero ${generationSectionState("hero")}`}><span /><strong /><small /></div>
                <div className="generate-building-grid">
                  {generationSections.filter((section) => section !== "hero").map((section) => (
                    <span key={section} className={generationSectionState(section)} />
                  ))}
                </div>
                {(generationPhase === "review" || generationPhase === "saving") && <div className="generate-saving-shimmer" />}
              </div>
              <div className="generate-steps" aria-live="polite">
                <div className="generate-elapsed"><span>已用时间</span><strong>{generationElapsed} 秒</strong></div>
                <div className="step done"><Check size={13} /> 理解需求</div>
                <div className="step done"><Check size={13} /> 匹配模板 · {template?.name}</div>
                <div className="generate-section-progress">
                  {generationSections.map((section) => {
                    const done = completedSections.includes(section);
                    const failed = failedSections.includes(section);
                    const recovering = recoveringSections.includes(section);
                    const active = activeSections.includes(section) && generationPhase === "content";
                    const state = done ? "done" : failed ? "failed" : recovering ? "recovering" : active ? "active" : "waiting";
                    return <div className={`step ${state}`} key={section}>{done ? <Check size={13} /> : failed ? <CircleAlert size={13} /> : active || recovering ? <LoaderCircle size={13} className="spin" /> : <span className="generate-step-dot" />}{SECTIONS_LABELS[section] ?? section}{recovering && <small>恢复中</small>}{failed && <small>稍后补全</small>}</div>;
                  })}
                </div>
                <div className={`step ${generationPhase === "review" || generationPhase === "saving" ? "active" : ""}`}>{generationPhase === "review" || generationPhase === "saving" ? <LoaderCircle size={13} className="spin" /> : <span className="generate-step-dot" />}{progressText}</div>
              </div>
            </div>
          )}

          {step === "done" && (
            <div className="generate-progress-view">
              <div className="eyebrow">完成</div>
              <h1>站点内容已生成</h1>
              {generationDuration !== null && <p>共用时 {(generationDuration / 1000).toFixed(1)} 秒，正在进入工作台…</p>}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
