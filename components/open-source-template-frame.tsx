"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Locale, SiteDraft } from "@/lib/site-model";
import { classifyDraftCoverage, detectTemplateDemoResidue } from "@/lib/template-content-coverage";
import { getRequiredVisibleTargets, getTemplateManifest } from "@/lib/template-manifest";
import { evaluateTemplateSlotReport } from "@/lib/template-slot-guard";

type FrameVariant = "thumbnail" | "preview" | "workspace" | "published";

export type LeadFormFields = Record<string, FormDataEntryValue>;
export type LeadSubmitResult = { ok: boolean; message?: string };

type OpenSourceTemplateFrameProps = {
  id?: string;
  templateId: string;
  siteKey?: string;
  draft?: SiteDraft;
  locale?: Locale;
  variant?: FrameVariant;
  expectedTargets?: string[];
  onSelectTarget?: (target: string, label: string, prompt: string, slot?: string) => void;
  onApplyReport?: (report: {
    revision: number;
    appliedSlots: string[];
    visibleSlots: string[];
    visibleTextsBySlot: Record<string, string[]>;
    filledTargets: string[];
    aiFilledTargets: string[];
    pendingTargets: string[];
    residualDemoSlots: string[];
    unmappedRequiredTargets: string[];
    missingSlots: string[];
    incompatible: boolean;
  }) => void;
  onPreviewStateChange?: (state: "loading" | "ready" | "error") => void;
  onLeadSubmit?: (fields: LeadFormFields) => Promise<LeadSubmitResult>;
};

const EMPTY_EXPECTED_TARGETS: string[] = [];

const targetPrompts: Record<string, { label: string; prompt: string }> = {
  brand: { label: "品牌名称", prompt: "修改品牌名称，并保持当前开源模板的 Logo 区域和排版不变。" },
  heroTitle: { label: "首屏标题", prompt: "重写首屏标题，保持当前开源模板原有的字号、断行节奏和版式。" },
  heroSubtitle: { label: "首屏说明", prompt: "优化首屏说明，保留当前模板的信息密度并避免虚构企业事实。" },
  primaryCta: { label: "主行动按钮", prompt: "优化主行动按钮文案，使用清晰动词并保持当前模板按钮样式。" },
  products: { label: "产品与能力", prompt: "根据已导入商品优化产品与能力区块，不存在的信息标记为待补充。" },
  about: { label: "关于我们", prompt: "修改关于我们区块，只使用已经提供的企业事实。" },
  features: { label: "核心优势", prompt: "修改核心优势区块，保持当前模板的信息密度和卡片数量。" },
  services: { label: "服务模块", prompt: "修改服务模块，可指定第几个服务的标题或说明。" },
  contact: { label: "联系模块", prompt: "修改联系区块文案和联系方式，不得虚构数据。" },
};

export function OpenSourceTemplateFrame({
  id,
  templateId,
  siteKey,
  draft,
  locale = "zh",
  variant = "preview",
  expectedTargets = EMPTY_EXPECTED_TARGETS,
  onSelectTarget,
  onApplyReport,
  onPreviewStateChange,
  onLeadSubmit,
}: OpenSourceTemplateFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const resolvedRef = useRef(false);
  const resolvedExpectedTargets = useMemo(
    () => [...new Set([...getRequiredVisibleTargets(templateId), ...expectedTargets])],
    [expectedTargets, templateId],
  );

  useEffect(() => {
    resolvedRef.current = false;
    onPreviewStateChange?.("loading");
    const timeout = window.setTimeout(() => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      onPreviewStateChange?.("error");
    }, 8000);
    return () => window.clearTimeout(timeout);
    // 注意：不能依赖 draft?.revision —— AI 每次保存都推高 revision，revision 变化会
    // 反复复位 resolvedRef 并重置 8s 握手计时。就绪态应跨 revision 保持；8s 超时只在
    // 初次加载 / 模板切换 / variant 变化时武装（实测：修改后 revision 跳变 + applied
    // 多轮重发，窗口内偶发无 applied → 误报 error → workspace 重挂 iframe → 闪烁循环）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onPreviewStateChange, templateId, variant]);

  useEffect(() => {
    const frameWindow = frameRef.current?.contentWindow;
    if (!frameWindow) return;
    const payload = { type: "sitecraft:content", templateId, siteKey, draft, locale, expectedTargets: resolvedExpectedTargets, variant };
    frameWindow.postMessage(payload, "*");
    const retry = window.setTimeout(() => frameWindow.postMessage(payload, "*"), 500);
    const finalRetry = window.setTimeout(() => frameWindow.postMessage(payload, "*"), 1500);
    const hydrationRetry = window.setTimeout(() => frameWindow.postMessage(payload, "*"), 3500);
    const settledRetry = window.setTimeout(() => frameWindow.postMessage(payload, "*"), 6000);
    return () => {
      window.clearTimeout(retry);
      window.clearTimeout(finalRetry);
      window.clearTimeout(hydrationRetry);
      window.clearTimeout(settledRetry);
    };
  }, [draft, locale, resolvedExpectedTargets, siteKey, templateId, variant]);

  useEffect(() => {
    const receiveMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as {
        type?: string;
        templateId?: string;
        siteKey?: string;
        target?: string;
        slot?: string;
        revision?: number;
        appliedSlots?: string[];
        visibleSlots?: string[];
        visibleTextsBySlot?: Record<string, string[]>;
        residualDemoSlots?: string[];
        missingSlots?: string[];
        incompatible?: boolean;
        requestId?: string;
        fields?: LeadFormFields;
      };
      if (data?.type === "sitecraft:select" && data.target && onSelectTarget) {
        const target = targetPrompts[data.target];
        if (target) onSelectTarget(data.slot || data.target, target.label, target.prompt, data.slot);
      }
      if (data?.type === "sitecraft:ready") {
        // bridge 就绪：有 draft 时补发一次 content（防组件消息早于 bridge 加载而丢失）
        if (draft) {
          frameRef.current?.contentWindow?.postMessage(
            { type: "sitecraft:content", templateId, siteKey, draft, locale, expectedTargets: resolvedExpectedTargets, variant },
            "*",
          );
        }
        if (!draft && !resolvedRef.current) {
          resolvedRef.current = true;
          onPreviewStateChange?.("ready");
        }
      }
      if (data?.type === "sitecraft:applied" && typeof data.revision === "number") {
        const manifest = getTemplateManifest(templateId);
        const visibleTextsBySlot = data.visibleTextsBySlot ?? {};
        const report = evaluateTemplateSlotReport({
          requiredTargets: resolvedExpectedTargets,
          appliedSlots: data.appliedSlots ?? [],
          visibleSlots: data.visibleSlots ?? [],
        });
        const draftCoverage = draft && manifest
          ? classifyDraftCoverage({ draft, manifest, appliedTargets: [] })
          : {
              filledTargets: [],
              aiFilledTargets: [],
              pendingTargets: [],
              residualDemoSlots: [],
              unmappedRequiredTargets: [],
            };
        const visibleTargets = new Set(
          Object.entries(visibleTextsBySlot)
            .filter(([, texts]) => texts.some((text) => text.trim()))
            .map(([target]) => target),
        );
        const missingVisibleTargets = manifest
          ? manifest.slots.filter((slot) => slot.required && !visibleTargets.has(slot.target)).map((slot) => slot.target)
          : [];
        const detectedResidue = manifest
          ? detectTemplateDemoResidue({ manifest, visibleTexts: visibleTextsBySlot })
          : [];
        const residualDemoSlots = [...new Set([
          ...draftCoverage.residualDemoSlots,
          ...(data.residualDemoSlots ?? []),
          ...detectedResidue,
        ])];
        const pendingTargets = [...new Set([
          ...draftCoverage.pendingTargets,
          ...missingVisibleTargets,
          ...residualDemoSlots,
        ])];
        const pendingSet = new Set(pendingTargets);
        const filledTargets = draftCoverage.filledTargets.filter(
          (target) => visibleTargets.has(target) && !pendingSet.has(target),
        );
        const aiFilledTargets = draftCoverage.aiFilledTargets.filter(
          (target) => visibleTargets.has(target) && !pendingSet.has(target),
        );
        const incompatible = data.incompatible === true
          || report.incompatible
          || pendingTargets.length > 0
          || draftCoverage.unmappedRequiredTargets.length > 0;
        // 首次应用可能发生在模板字体/资源完成布局之前；短暂缺槽位不应锁死为降级。
        if (!resolvedRef.current && !incompatible) {
          resolvedRef.current = true;
          onPreviewStateChange?.("ready");
        }
        if (onApplyReport) {
          onApplyReport({
            revision: data.revision,
            ...report,
            visibleTextsBySlot,
            filledTargets,
            aiFilledTargets,
            pendingTargets,
            residualDemoSlots,
            unmappedRequiredTargets: draftCoverage.unmappedRequiredTargets,
            incompatible,
          });
        }
      }
      if (data?.type === "sitecraft:lead-submit" && data.templateId === templateId && data.siteKey === siteKey && data.fields && onLeadSubmit) {
        void onLeadSubmit(data.fields)
          .then((result) => {
            frameRef.current?.contentWindow?.postMessage(
              { type: "sitecraft:lead-result", templateId, siteKey, requestId: data.requestId, ...result },
              "*",
            );
          })
          .catch(() => {
            frameRef.current?.contentWindow?.postMessage(
              { type: "sitecraft:lead-result", templateId, siteKey, requestId: data.requestId, ok: false, message: "提交失败，请稍后重试。" },
              "*",
            );
          });
      }
    };
    window.addEventListener("message", receiveMessage);
    return () => window.removeEventListener("message", receiveMessage);
  }, [draft, locale, onApplyReport, onLeadSubmit, onPreviewStateChange, onSelectTarget, resolvedExpectedTargets, siteKey, templateId, variant]);

  const sendContent = () => {
    frameRef.current?.contentWindow?.postMessage(
      { type: "sitecraft:content", templateId, siteKey, draft, locale, expectedTargets: resolvedExpectedTargets, variant },
      "*",
    );
  };

  return (
    <iframe
      id={id}
      ref={frameRef}
      className={`open-source-template-frame open-source-template-frame-${variant}`}
      src={`/api/templates/${encodeURIComponent(templateId)}/preview?v=20260904-huagu`}
      title={`开源模板 ${templateId} 预览`}
      loading={variant === "thumbnail" ? "lazy" : "eager"}
      sandbox="allow-scripts allow-forms allow-same-origin"
      onLoad={sendContent}
      onError={() => {
        if (resolvedRef.current) return;
        resolvedRef.current = true;
        onPreviewStateChange?.("error");
      }}
    />
  );
}
