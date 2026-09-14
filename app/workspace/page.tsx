"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Cloud,
  CloudUpload,
  FileSpreadsheet,
  FileText,
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
import { OpenSourceTemplateFrame } from "@/components/open-source-template-frame";
import { ProductImportDialog } from "@/components/product-import-dialog";
import { AssetReplaceDialog } from "@/components/asset-replace-dialog";
import { SiteMaterialDialog } from "@/components/site-material-dialog";
import { ReleasesDialog } from "@/components/releases-dialog";
import { ChatPanel } from "@/components/chat-panel";
import { RegenerateSectionButton } from "@/components/regenerate-section-button";
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
import { describeSlot, slotForQualityIssue, type SiteOperation } from "@/lib/site-operations";
import { buildChangeDiff, type ChangeDiff } from "@/lib/change-diff";
import { slotToDraftOperation } from "@/lib/inline-edit-mapping";
import { formatRenderedStructure, serializeRenderedStructure } from "@/lib/rendered-structure";
import { readSseEvents } from "@/lib/sse-events";
import { parseProductFile, uploadProductImage } from "@/lib/product-import";

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
  /**
   * 本次被确定性校验拒绝的操作（人话原因）。
   *
   * 2026-09-11 之前：`rejected` 从服务端一路冒泡到 `done` 事件，
   * 但本文件读 doneEvent 时**独独不读它** → 用户只看到"草稿 vN 已保存"，
   * 而超长/越界的改动其实一项都没写进去。
   */
  rejected?: string[];
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
/** 版本历史条目（`/api/sites/:id/releases` 返回的 Release，去掉庞大的 draft 字段）。 */
type ReleaseSummary = {
  releaseId: string;
  version: number;
  status: "published" | "superseded";
  createdAt: string;
  publishedBy: string;
  rollbackOf?: string;
};
type TemplateCapabilities = {
  templateId: string;
  revision: number;
  slots: string[];
  /** 页面真实渲染结构摘要（P3.3）：随 revision 失效，与 slots 同源同生命周期 */
  structure?: string;
};

/**
 * 从 chat 的 `done` 事件里取「被拒操作」的人话原因。
 *
 * 服务端一直在下发这个数组，但前端此前**从未读取** → 超长/越界的改动
 * 被静默丢弃，用户只看到"草稿已保存"（2026-09-11 修复）。
 */
function chatRejected(doneEvent: Record<string, unknown>): string[] | undefined {
  const raw = doneEvent.rejected;
  if (!Array.isArray(raw)) return undefined;
  const reasons = raw.filter((item): item is string => typeof item === "string");
  return reasons.length ? reasons : undefined;
}

/** 业务节中文名（结构忠实度提示用） */
const SECTION_LABELS: Record<string, string> = {
  about: "关于",
  features: "优势",
  services: "服务",
  products: "产品",
  contact: "联系",
};

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
  // 就地编辑模式（P3.1）：direct = 点选直接改；ai = 点选后填对话框再发送（默认，保证零回归）
  const [editMode, setEditMode] = useState<"ai" | "direct">("ai");
  const [editHint, setEditHint] = useState<string | null>(null);
  // 资产替换弹窗（P3.2）：点选图片后打开
  const [assetDialog, setAssetDialog] = useState<{ target: string; currentSrc: string } | null>(null);
  const [assetBusy, setAssetBusy] = useState(false);
  const assetFileRef = useRef<HTMLInputElement>(null);
  const [showImport, setShowImport] = useState(false);
  // 站点素材（2026-09-10，方向 2）：用户粘贴的企业原文，AI 生成内容时以此为准。
  // 与站点绑定存储，用户可回看与纠正——只存不给用户看，他就无法修正 AI 依据的材料。
  const [materialOpen, setMaterialOpen] = useState(false);
  const [materialDraft, setMaterialDraft] = useState("");
  const [materialBusy, setMaterialBusy] = useState(false);
  const [materialSaved, setMaterialSaved] = useState(false);
  // 商品主图上传中（存 SKU，避免整页 loading）；null = 空闲
  const [productImageBusy, setProductImageBusy] = useState<string | null>(null);
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
  // 部分板块未完整生成（?partial=1）：进工作台后仍保留"待补全"警示，避免半成品被当成品发布
  const [partialNotice, setPartialNotice] = useState(false);
  // 版本历史与回滚（2026-09-10 接线：后端早已可用，此前零 UI 入口）
  const [releasesOpen, setReleasesOpen] = useState(false);
  const [releases, setReleases] = useState<ReleaseSummary[]>([]);
  const [releasesBusy, setReleasesBusy] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  // 发布被质检拦下时的"可定位问题"（2026-09-10）：让用户点一下就在预览里选中该处。
  const [qualityFocus, setQualityFocus] = useState<Array<{ slot: string; label: string; target: string | null }>>([]);
  // 渲染事实（桥接报告回传的「页面上真渲染了什么」）：发布时带给服务端做忠实度门禁。
  // 服务端无法从 draft JSON 重算 L2 残留/L3 结构——那需要真实 DOM 文本。
  const [renderFacts, setRenderFacts] = useState<{
    revision: number;
    visibleTexts: string[];
    generatedSections: string[];
    appliedSections: string[];
  } | null>(null);
  const [mobilePane, setMobilePane] = useState<"chat" | "preview">("chat");
  const [selectedTarget, setSelectedTarget] = useState<{ key: string; label: string } | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [expectedTargets, setExpectedTargets] = useState<string[]>([]);
  const [templateCapabilities, setTemplateCapabilities] = useState<TemplateCapabilities | null>(null);
  const [previewState, setPreviewState] = useState<"loading" | "synced" | "warning">("loading");
  // 结构忠实度提示（L3）：渲染事实显示某些节走了通用兜底区时告知用户（P1.4 落点）
  const [structureNotice, setStructureNotice] = useState<string | null>(null);
  // 真实模板 iframe 握手偶发失败时，递增 key 强制重挂（不再降级为本地结构近似渲染）。
  const [previewFrameKey, setPreviewFrameKey] = useState(0);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>({ mode: "unconfigured", model: null });
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
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
    // 2026-09-10：同时识别 ?partial=1——生成页在「部分板块未完整生成」时带上该参数，
    // 但此前工作台**只认 generated=1**，导致用户进工作台后「待补全」警示消失，
    // 可能直接把半成品当成品发布。
    const params = new URLSearchParams(window.location.search);
    if (params.get("generated") === "1") setShowGuide(true);
    if (params.get("partial") === "1") setPartialNotice(true);
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
        /**
         * ⚠️ **守卫必须同时认运行时模板**（2026-09-13 修，D-1 第 4 项）。
         *
         * 此前是 `templates.some(...)`——而 `templates` 是**编译期那 22 个基线**
         * （`lib/site-model.ts`），**用户自己做的模板不在其中**。
         * 于是点自制模板的卡片时这个守卫直接为假 → `set_template` 不执行 →
         * 打开的是 `siteId` 默认值 `"demo"` 那个站（实测：显示别的模板 + 别的站名）。
         *
         * 服务端的权威口径是 `allTemplates()`（`lib/site-model.ts:94`，基线 + 运行时）；
         * 工作台拿不到它（客户端 bundle 里运行时注册表恒为空），所以**问接口**——
         * 同一个接口上面那段已经在用（拉运行时模板名）。
         *
         * 失败时**回退到旧行为**（只认基线）而不是放行：放行会让一个不存在的 id
         * 走进 `set_template`，那是另一种静默失败。
         */
        const isKnownTemplate = async (id: string): Promise<boolean> => {
          if (templates.some((item) => item.id === id)) return true;
          try {
            const response = await fetch("/api/templates/runtime", { cache: "no-store" });
            if (!response.ok) return false;
            const body = (await response.json()) as { templates?: Array<{ id: string }> };
            return Boolean(body.templates?.some((item) => item.id === id));
          } catch {
            return false; // 拿不到名册就不认——保守，不猜
          }
        };
        if (requestedTemplate && snapshot.draft.templateId !== requestedTemplate && (await isKnownTemplate(requestedTemplate))) {
          const response = await fetch(`/api/sites/${siteId}/draft`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              baseRevision: snapshot.draft.revision,
              operations: [{ op: "set_template", templateId: requestedTemplate }],
              // 名字优先用运行时名册里的真名；基线用 getTemplate 的（它认得基线）
              summary: `选择模板 ${templates.find((item) => item.id === requestedTemplate)?.name ?? requestedTemplate}`,
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
          // 模板页点「你可以对 AI 说」的 starter 带过来的指令：**只预填，不自动发送**
          // （2026-09-09 用户确认）——避免用户没看清就消耗一次 AI 调用。
          const presetPrompt = new URLSearchParams(window.location.search).get("prompt");
          if (presetPrompt?.trim()) setInput(presetPrompt.trim());
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!messagesNearBottomRef.current && !userJustSentRef.current) return;
    userJustSentRef.current = false;
    messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    messagesNearBottomRef.current = true;
  }, [messages, busy, busyText]);

  const currentTemplate = getTemplate(draft.templateId);
  /**
   * 运行时模板的名字（只对"客户端认不出"的模板才去要）。
   *
   * ⚠️ **不能直接信 `currentTemplate.name`**。`getTemplate()` 在找不到 id 时
   * **静默回退到 `templates[0]`**（`lib/site-model.ts:108`），而**运行时模板
   * 在客户端 bundle 里永远找不到**——注册表只在服务端进程里，
   * 客户端 `allTemplates()` 恒等于那 22 个基线模板（见 `site-model.ts` 的
   * `runtimeLoader` 说明）。
   *
   * 后果（2026-09-11 实测）：用截图做出来的站，工作台页头显示的是
   * **「SMALL BIS / Small Business」**——22 个基线模板里的第一个。
   * 用户会以为自己的模板被换掉了。
   *
   * 修法：**只在认不出来时才去问一次服务端**。22 个基线模板走原路、
   * 零额外请求；运行时模板多一个本地接口调用，换来正确的名字。
   * 问不到就退回显示 id——脏但**不撒谎**，比显示另一个模板的名字好。
   */
  const templateRecognized = currentTemplate.id === draft.templateId;
  const [runtimeTemplateName, setRuntimeTemplateName] = useState<string | null>(null);
  useEffect(() => {
    if (templateRecognized) return;
    let cancelled = false;
    fetch("/api/templates/runtime", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { templates?: Array<{ id: string; name: string }> } | null) => {
        if (cancelled || !body?.templates) return;
        const found = body.templates.find((item) => item.id === draft.templateId);
        if (found) setRuntimeTemplateName(found.name);
      })
      .catch(() => {
        // 拿不到就继续显示 id——不弹错，这不值得打断用户
      });
    return () => {
      cancelled = true;
    };
  }, [draft.templateId, templateRecognized]);
  const templateName = templateRecognized ? currentTemplate.name : (runtimeTemplateName ?? draft.templateId);
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
    // 就地编辑模式下，点选由 iframe 直接进入编辑态，父窗口不再抢焦点、不再覆写聊天输入框
    // （二次取证发现：原先无条件 setInput + focus() 会在编辑中把光标夺走，2026-09-09）
    if (editMode === "direct") return;
    setSelectedTarget({ key, label: slot ? `${label}（已定位）` : label });
    setInput(slot ? `修改我刚才选中的${label}。${prompt}` : prompt);
    setMobilePane("chat");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  /**
   * 就地编辑提交（P3.1）：映射为一条标准草稿操作后走 saveOperations。
   * 带 expectedValue 做乐观并发保护——冲突时抛错，iframe 回滚到编辑前文本。
   */
  const applyImageToProduct = async (sku: string, file: File | null) => {
    if (productImageBusy) return;
    setProductImageBusy(sku);
    try {
      let image: string | null = null;
      if (file) image = await uploadProductImage(file);
      await saveOperations(
        [{ op: "set_product_image", sku, image }],
        image ? `更新商品 ${sku} 主图` : `清除商品 ${sku} 主图`,
        "manual",
      );
      setEditHint(image ? "商品主图已更新" : "已清除商品主图");
      window.setTimeout(() => setEditHint(null), 2500);
    } catch (error) {
      setEditHint(error instanceof Error ? error.message : "商品图上传失败");
      window.setTimeout(() => setEditHint(null), 3500);
    } finally {
      setProductImageBusy(null);
    }
  };

  /**
   * 资产替换（P3.2）：上传实拍图 → 存服务端 → 写 draft.assets。
   * `file = null` 表示恢复模板原图（写 asset: null）。
   */
  const replaceAsset = async (file: File | null) => {
    if (!assetDialog || assetBusy) return;
    setAssetBusy(true);
    try {
      let asset: { url: string; alt?: string; mime?: string; width?: number; height?: number } | null = null;
      if (file) {
        const form = new FormData();
        form.append("file", file);
        const upload = await fetch("/api/product-images", { method: "POST", body: form });
        const uploaded = (await upload.json()) as { ok?: boolean; url?: string; error?: string };
        if (!upload.ok || !uploaded.url) throw new Error(uploaded.error || "图片上传失败");
        asset = { url: uploaded.url, alt: file.name.replace(/\.[^.]+$/, ""), mime: file.type };
      }
      await saveOperations(
        [{ op: "set_asset", target: assetDialog.target as "hero.image" | "brand.logo", asset }],
        asset ? `替换${assetDialog.target === "hero.image" ? "首屏主视觉" : "品牌 Logo"}` : "恢复模板原图",
        "manual",
      );
      setAssetDialog(null);
      setEditHint(asset ? "图片已替换" : "已恢复模板原图");
      window.setTimeout(() => setEditHint(null), 2500);
    } catch (error) {
      setEditHint(error instanceof Error ? error.message : "图片替换失败");
      window.setTimeout(() => setEditHint(null), 3500);
    } finally {
      setAssetBusy(false);
    }
  };

  const commitInlineEdit = async (payload: { requestId: string; slot: string; value: string; originalValue: string }) => {
    const resolution = slotToDraftOperation({
      slot: payload.slot,
      value: payload.value,
      originalValue: payload.originalValue,
      draft,
      uiLocale: locale,
    });
    if (!resolution.ok) return { ok: false, message: resolution.message };
    try {
      await saveOperations([resolution.operation], `直接编辑：${resolution.label}`, "manual");
      setEditHint(`已保存「${resolution.label}」`);
      window.setTimeout(() => setEditHint(null), 2500);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "保存失败" };
    }
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
            renderedStructure: activeTemplateCapabilities?.structure || undefined,
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
          rejected: chatRejected(doneEvent),
        }]);
      } else if (status === "no_change") {
        setMessages((items) => [...items, { id: crypto.randomUUID(), role: "assistant", status: "no_change", text: "模型没有生成可应用的内容差异。", change: String(doneEvent.summary || "没有变化"), meta: latency, rejected: chatRejected(doneEvent) }]);
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
          renderedStructure: activeTemplateCapabilities?.structure || undefined,
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
          rejected: chatRejected(doneEvent),
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

  const handlePreviewReport = (report: {
    revision: number;
    appliedSlots: string[];
    missingSlots: string[];
    /** 渲染事实：实际走了通用兜底区的业务节（见 OpenSourceTemplateFrame 注释） */
    generatedContentSections?: string[];
    /** 槽位 → 页面上可见文本。发布门禁的 L2 残留判定需要它（2026-09-10 接线）。 */
    visibleTextsBySlot?: Record<string, string[]>;
  }) => {
    if (report.revision !== draft.revision) return;
    // 结构忠实度（L3）：渲染事实 → 提示哪些节没落在模板原生排版。
    // 这是 P1.4「兜底显性化」的落点：此前只消费模型自报的 fallbackDeclared，
    // 模型说自己没问题就永远不提示（2026-09-09 接线）。
    const generatedSections = report.generatedContentSections ?? [];
    if (generatedSections.length > 0) {
      const labels = generatedSections.map((section) => SECTION_LABELS[section] ?? section);
      setStructureNotice(`以下板块当前为动态备用排版（未落在模板原生结构）：${labels.join("、")}`);
    } else {
      setStructureNotice(null);
    }
    setTemplateCapabilities({
      templateId: draft.templateId,
      revision: report.revision,
      slots: [...new Set(report.appliedSlots)],
      // P3.3 具身上下文：模型此前只看得见 draft JSON，看不见「这节在页面上是原生排版还是补的兜底区」。
      // 序列化在这里（父页 TS）而不是 iframe 里——那段脚本是模板字符串，写不了 TS 模块。
      structure: formatRenderedStructure(serializeRenderedStructure({
        templateId: draft.templateId,
        revision: report.revision,
        appliedSlots: report.appliedSlots,
        generatedContentSections: generatedSections,
        hiddenSections: draft.hiddenSections,
      })),
    });
    // 渲染事实（供发布门禁使用，2026-09-10 接线）：
    // `evaluateFidelity` 需要「页面上真正渲染出来的文本」，而它只存在于桥接报告里——
    // 服务端从 draft JSON 算不出来。这里存下来，`publishSite` 时随请求带上。
    setRenderFacts({
      revision: report.revision,
      visibleTexts: Object.values(report.visibleTextsBySlot ?? {}).flat(),
      generatedSections,
      appliedSections: report.appliedSlots,
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

  /**
   * 版本历史与回滚（2026-09-10 接线）。
   *
   * 后端 `/api/sites/:id/releases`（列表）与 `/releases/:releaseId/rollback` 一直完整可用，
   * 但**全仓库没有任何 .tsx 调用它们**——用户发错了救不回来。
   * 注意回滚是「以历史草稿新建一个更高版本」（不是复活旧行），并记 `rollbackOf`。
   */
  const openReleases = async () => {
    setReleasesOpen(true);
    setReleasesBusy(true);
    setReleaseError(null);
    try {
      const response = await fetch(`/api/sites/${siteId}/releases`, { cache: "no-store" });
      const payload = (await response.json()) as { releases?: ReleaseSummary[] };
      setReleases(payload.releases ?? []);
    } catch {
      setReleaseError("读取版本历史失败");
      setReleases([]);
    } finally {
      setReleasesBusy(false);
    }
  };

  const rollbackTo = async (releaseId: string, version: number) => {
    if (releasesBusy) return;
    setReleasesBusy(true);
    setReleaseError(null);
    try {
      const response = await fetch(`/api/sites/${siteId}/releases/${encodeURIComponent(releaseId)}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseRevision: draft.revision, idempotencyKey: crypto.randomUUID() }),
      });
      const payload = (await response.json()) as { release?: { version?: number }; message?: string; error?: string };
      if (!response.ok) throw new Error(payload.message || payload.error || "回滚失败");
      // 回滚 = 以历史草稿新建更高版本；重新拉一次草稿把新内容（含历史/撤销栈）同步到界面
      const snapshot = await fetch(`/api/sites/${siteId}/draft`, { cache: "no-store" }).then((res) => {
        if (!res.ok) throw new Error("读取回滚后草稿失败");
        return res.json() as Promise<DraftSnapshot>;
      });
      adoptSnapshot(snapshot);
      setPreviewState("loading");
      setReleasesOpen(false);
      setMessages((items) => [...items, {
        id: crypto.randomUUID(),
        role: "assistant",
        status: "applied",
        text: `已回滚到 v${version}（生成新版本 v${payload.release?.version ?? ""}）`,
        change: "线上公开页读取的是新版本快照",
      }]);
    } catch (error) {
      setReleaseError(error instanceof Error ? error.message : "回滚失败");
    } finally {
      setReleasesBusy(false);
    }
  };

  /**
   * 打开素材面板：拉取站点已存素材填入编辑框。
   */
  const openMaterial = async () => {
    setMaterialOpen(true);
    setMaterialSaved(false);
    try {
      const snapshot = await fetch(`/api/sites/${siteId}/draft`, { cache: "no-store" }).then((r) => r.json()) as { sourceMaterial?: string };
      setMaterialDraft(snapshot.sourceMaterial ?? "");
    } catch {
      setMaterialDraft("");
    }
  };

  /**
   * 保存素材。**不走 operations**——素材不是草稿内容，改它不该 bump revision
   * （否则用户只想补充公司简介却被当成草稿修改，可能撞上冲突）。
   */
  const saveMaterial = async () => {
    if (materialBusy) return;
    setMaterialBusy(true);
    try {
      const response = await fetch(`/api/sites/${siteId}/draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceMaterial: materialDraft }),
      });
      if (!response.ok) throw new Error("保存素材失败");
      setMaterialSaved(true);
      // T-24：用户反馈「保存后以为没生效」——补一句去向，说明素材不是即时改版式，
      // 而是下一次补全 / 重生成板块时才吃进内容。
      setEditHint("站点素材已保存，去补全/重生成板块即可生效");
      window.setTimeout(() => setEditHint(null), 3000);
    } catch (error) {
      setEditHint(error instanceof Error ? error.message : "保存素材失败");
      window.setTimeout(() => setEditHint(null), 3500);
    } finally {
      setMaterialBusy(false);
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
        body: JSON.stringify({
          baseRevision: draft.revision,
          idempotencyKey,
          factsConfirmed: opts?.factsConfirmed ?? false,
          // 渲染事实（仅当与当前草稿同 revision 时可信）：服务端据此跑 L2 残留 / L3 结构门禁
          ...(renderFacts && renderFacts.revision === draft.revision
            ? { renderFacts: { visibleTexts: renderFacts.visibleTexts, generatedSections: renderFacts.generatedSections, appliedSections: renderFacts.appliedSections } }
            : {}),
        }),
      });
      const payload = await response.json().catch(() => ({})) as {
        error?: string;
        message?: string;
        quality?: { missingSlots?: string[]; fabricatedTargets?: string[]; metaCommentaryTargets?: string[]; unverifiedFacts?: string[] };
        release?: { version?: number };
        assetWarnings?: Array<{ description?: string }>;
        fidelityWarnings?: Array<{ description?: string }>;
      };
      if (!response.ok) {
        // 事实类声明需人工确认：列出待确认事实，弹出确认面板让用户核对后带 factsConfirmed 重试。
        const facts = payload.quality?.unverifiedFacts ?? [];
        const hasOnlyFacts = facts.length > 0
          && !(payload.quality?.missingSlots?.length)
          && !(payload.quality?.fabricatedTargets?.length)
          && !(payload.quality?.metaCommentaryTargets?.length);
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
          ? [...(payload.quality.missingSlots ?? []), ...(payload.quality.fabricatedTargets ?? []), ...(payload.quality.metaCommentaryTargets ?? []), ...(payload.quality.unverifiedFacts ?? [])]
          : [];
        const blockedByQuality = payload.error === "publish_blocked";
        // 2026-09-10：把原始槽位 id（`hero.title`）换成可读位置（「首屏的标题」），
        // 并给出可在预览中一键定位的条目——用户答复「我直接进工作台看」，
        // 那么工作台提示就必须**看得懂 + 点得到**，而不是列一串 id。
        const readableIssues = qualityIssues.slice(0, 4).map((slot) => describeSlot(slot));
        setQualityFocus(qualityIssues
          .map((slot) => ({ slot, label: describeSlot(slot), target: slotForQualityIssue(slot) }))
          .filter((item) => item.target !== null)
          .slice(0, 6));
        setMessages((items) => [...items, {
          id: crypto.randomUUID(),
          role: "assistant",
          status: "warning",
          text: blockedByQuality ? "发布前仍有内容需要人工确认或补全。" : payload.message || "当前内容还不能发布，请先处理提示中的问题。",
          change: readableIssues.length ? `待处理：${readableIssues.join("、")}` : payload.error || "发布未完成",
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
      // 模板层门禁（L2b）警告：首屏主视觉仍是模板示例图 → 提示去替换（不阻断发布）
      const assetWarning = payload.assetWarnings?.[0]?.description;
      if (assetWarning) {
        setMessages((items) => [...items, {
          id: crypto.randomUUID(),
          role: "assistant",
          status: "warning",
          text: assetWarning,
          change: "在工作台点选首屏图片即可上传企业实拍图替换",
        }]);
      }
      // 忠实度门禁（L2 残留 / L3 结构）：此前 evaluateFidelity 生产零调用，
      // 现由服务端用本次携带的渲染事实判定（2026-09-10 接线）。警告不阻断。
      const fidelityWarnings = payload.fidelityWarnings ?? [];
      if (fidelityWarnings.length > 0) {
        setMessages((items) => [...items, {
          id: crypto.randomUUID(),
          role: "assistant",
          status: "warning",
          text: fidelityWarnings[0].description ?? "站点仍包含模板残留内容或结构偏差。",
          change: fidelityWarnings.length > 1 ? `另有 ${fidelityWarnings.length - 1} 项，可在发布响应中查看` : "建议在预览中确认后再对外分享",
        }]);
      }
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

  const handleFile = async (file: File) => {
    // 解析搬进 lib/product-import（B4 纯搬家）；保存链路不变。
    const parsed = await parseProductFile(file);
    await commitImportedRows(parsed.name, parsed.rows);
  };

  return (
    <div className="builder-shell">
      <div className="builder-mobile-tabs" role="tablist" aria-label="建站工作区视图">
        <button className={mobilePane === "chat" ? "active" : ""} onClick={() => setMobilePane("chat")} role="tab" aria-selected={mobilePane === "chat"}><MessageSquareText size={14} /> AI 对话</button>
        <button className={mobilePane === "preview" ? "active" : ""} onClick={() => setMobilePane("preview")} role="tab" aria-selected={mobilePane === "preview"}><Desktop size={14} /> 网站预览</button>
      </div>
      <ChatPanel
        className={`builder-chat ${mobilePane !== "chat" ? "mobile-hidden" : ""}`}
        draft={draft}
        updatedAt={updatedAt}
        templateName={templateName}
        providerStatus={providerStatus}
        history={history}
        showHistory={showHistory}
        messages={messages}
        input={input}
        busy={busy}
        busyText={busyText}
        draftReady={draftReady}
        hasCapabilities={Boolean(activeTemplateCapabilities)}
        selectedTarget={selectedTarget}
        pendingDestructive={pendingDestructive}
        nearBottomRef={messagesNearBottomRef}
        endRef={messagesEndRef}
        onToggleHistory={() => setShowHistory((value) => !value)}
        onCloseHistory={() => setShowHistory(false)}
        onChangeInput={setInput}
        onClearTarget={() => setSelectedTarget(null)}
        onConfirmDestructive={(confirmed) => void confirmDestructive(confirmed)}
        onSubmit={() => void submitChat()}
        onCancel={cancelChatRequest}
        onOpenImport={() => setShowImport(true)}
      />
      <main className={`preview-shell ${mobilePane !== "preview" ? "mobile-hidden" : ""}`}>
        <header className="preview-toolbar">
          <div className="preview-toolbar-left"><div className="project-name">{draft.siteName}</div><span className={`save-status ${previewState}`}><Check size={12} />{saveLabel}</span></div>
          <div className="preview-toolbar-right">
            <div className="device-toggle"><button className={device === "desktop" ? "active" : ""} onClick={() => setDevice("desktop")} aria-label="桌面预览"><Desktop size={14} /></button><button className={device === "tablet" ? "active" : ""} onClick={() => setDevice("tablet")} aria-label="平板预览"><Tablet size={14} /></button><button className={device === "mobile" ? "active" : ""} onClick={() => setDevice("mobile")} aria-label="手机预览"><Mobile size={14} /></button></div>
            <div className="device-toggle"><button className={locale === "zh" ? "active" : ""} onClick={() => setLocale("zh")}>中</button><button className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")}>EN</button></div>
            <div className="device-toggle" role="group" aria-label="编辑方式">
              <button className={editMode === "ai" ? "active" : ""} onClick={() => setEditMode("ai")} title="点选后由 AI 修改">AI 修改</button>
              <button className={editMode === "direct" ? "active" : ""} onClick={() => setEditMode("direct")} title="点选后直接编辑文字">直接编辑</button>
            </div>
            {editHint && <span className="edit-hint" role="status">{editHint}</span>}
            {structureNotice && !editHint && <span className="edit-hint" role="status">{structureNotice}</span>}
            <button className="icon-button" onClick={() => void moveHistory("undo")} disabled={!canUndo || busy} aria-label="撤销"><RotateCcw size={14} /></button>
            <button className="icon-button" onClick={() => void moveHistory("redo")} disabled={!canRedo || busy} aria-label="重做"><RotateCw size={14} /></button>
            <button className="secondary-button" onClick={() => setShowImport(true)}><Upload size={14} />商品</button>
            <button className="secondary-button" type="button" onClick={() => void openMaterial()} disabled={siteId === "demo"}><FileText size={14} />素材</button>
            <Link className="secondary-button" href={`/leads?siteKey=${encodeURIComponent(siteId)}`}><MessageSquareText size={14} />询盘</Link>
            <RegenerateSectionButton selectedTarget={selectedTarget} resolveSection={sectionFromTarget} busy={busy} onRegenerate={(section, label) => setRegenerateDialog({ section, label })} />
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
            <button className="secondary-button" type="button" onClick={() => void openReleases()} disabled={busy || siteId === "demo"}><History size={14} />版本历史</button>
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
          {/*
            「产品板块已隐藏」提示（2026-09-10，方向 2 的配套）。
            生成时若站点还没有商品，`buildGenerationPlan` 会自动隐藏产品板块并合成
            `set_section_visibility: false`——不这么做，空商品会让发布被 422 拦下。
            但隐藏是**静默**发生的，用户只看到"产品区块没了"。这条提示把它讲清楚，
            并给出一键开回（商品仍然是空的，所以开回后仍需导入，两个动作并列给出）。
          */}
          {!draft.hiddenSections.includes("products") ? null : (
            <div className="generate-guide-note" role="status">
              <div className="generate-guide-title">
                <CircleAlert size={14} />
                {draft.products.length > 0 ? "产品板块当前为隐藏状态" : "尚无商品，产品板块已自动隐藏"}
              </div>
              <div className="generate-guide-actions">
                <button onClick={() => setShowImport(true)}>导入商品</button>
                <button
                  onClick={() => {
                    void saveOperations(
                      [{ op: "set_section_visibility", section: "products", visible: true }],
                      "显示产品板块",
                      "manual",
                    );
                  }}
                >
                  显示产品板块
                </button>
              </div>
            </div>
          )}
          {qualityFocus.length > 0 && (
            <div className="quality-focus-bar" role="status">
              <div className="quality-focus-head"><CircleAlert size={13} />以下位置需要处理，点一下即可在预览中定位</div>
              <div className="quality-focus-items">
                {qualityFocus.map((item) => (
                  <button
                    key={item.slot}
                    type="button"
                    className="quality-focus-item"
                    title={item.slot}
                    onClick={() => {
                      if (item.target) selectPreviewTarget(item.target, item.label, `请修改${item.label}，使其符合发布要求。`);
                      // 点选后收起定位条，避免遮挡预览
                      setQualityFocus([]);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <button className="generate-guide-close" aria-label="关闭提示" onClick={() => setQualityFocus([])}><X size={12} /></button>
            </div>
          )}
          {partialNotice && (
            <div className="generate-guide-note" role="status">
              <div className="generate-guide-title"><CircleAlert size={14} />部分板块未完整生成，发布前建议先补全</div>
              <div className="generate-guide-actions">
                <button onClick={() => { setPartialNotice(false); window.location.href = `/generate?siteId=${siteId}&recover=missing`; }}>去补全缺失板块</button>
                <button onClick={() => setPartialNotice(false)}>继续编辑</button>
              </div>
              <button className="generate-guide-close" aria-label="关闭提示" onClick={() => setPartialNotice(false)}><X size={12} /></button>
            </div>
          )}
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
          <div className={`browser-frame ${device}`}><div className="browser-bar"><span className="browser-dot" /><span className="browser-dot" /><span className="browser-dot" /><div className="browser-url">forge-industrial.sites.ai</div><CircleHelp size={11} color="#adb8af" /></div>{draftReady && <OpenSourceTemplateFrame key={`real-${previewFrameKey}`} templateId={draft.templateId} draft={draft} locale={locale} variant="workspace" expectedTargets={expectedTargets} onSelectTarget={selectPreviewTarget} onApplyReport={handlePreviewReport} onPreviewStateChange={handlePreviewFrameState} editMode={editMode} onInlineCommit={commitInlineEdit} onAssetSelect={(payload) => setAssetDialog(payload)} onInlineRejected={(reason) => { setEditHint(reason === "unsupported_slot" ? "该位置是模板固定文案，已切换为 AI 修改" : "此位置不支持直接编辑"); window.setTimeout(() => setEditHint(null), 2500); }} />}</div>
        </div>
      </main>
      {assetDialog && (
        <AssetReplaceDialog
          target={assetDialog.target as "hero.image" | "brand.logo"}
          currentSrc={assetDialog.currentSrc}
          hasAsset={Boolean(draft.assets[assetDialog.target as "hero.image" | "brand.logo"])}
          busy={assetBusy}
          onClose={() => setAssetDialog(null)}
          onPickFile={(file) => void replaceAsset(file)}
          onReset={() => void replaceAsset(null)}
        />
      )}
      {showImport && (
        <ProductImportDialog
          products={draft.products}
          importState={importState}
          productImageBusy={productImageBusy}
          onClose={() => setShowImport(false)}
          onPickFile={(file) => void handleFile(file)}
          onUploadImage={(sku, file) => void applyImageToProduct(sku, file)}
        />
      )}
      {materialOpen && (
        <SiteMaterialDialog
          value={materialDraft}
          busy={materialBusy}
          saved={materialSaved}
          onClose={() => setMaterialOpen(false)}
          onChange={(next) => { setMaterialDraft(next); setMaterialSaved(false); }}
          onSave={() => void saveMaterial()}
        />
      )}
      {releasesOpen && (
        <ReleasesDialog
          releases={releases}
          busy={releasesBusy}
          error={releaseError}
          onClose={() => setReleasesOpen(false)}
          onRollback={(releaseId, version) => void rollbackTo(releaseId, version)}
        />
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
