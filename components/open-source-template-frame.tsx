"use client";

import { useEffect, useRef } from "react";
import type { Locale, SiteDraft } from "@/lib/site-model";

type FrameVariant = "thumbnail" | "preview" | "workspace" | "published";

export type LeadFormFields = Record<string, FormDataEntryValue>;
export type LeadSubmitResult = { ok: boolean; message?: string };

type OpenSourceTemplateFrameProps = {
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
    missingSlots: string[];
  }) => void;
  onPreviewStateChange?: (state: "loading" | "ready" | "error") => void;
  onLeadSubmit?: (fields: LeadFormFields) => Promise<LeadSubmitResult>;
};

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
  templateId,
  siteKey,
  draft,
  locale = "zh",
  variant = "preview",
  expectedTargets = [],
  onSelectTarget,
  onApplyReport,
  onPreviewStateChange,
  onLeadSubmit,
}: OpenSourceTemplateFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const resolvedRef = useRef(false);

  useEffect(() => {
    resolvedRef.current = false;
    onPreviewStateChange?.("loading");
    const timeout = window.setTimeout(() => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      onPreviewStateChange?.("error");
    }, 8000);
    return () => window.clearTimeout(timeout);
  }, [draft?.revision, onPreviewStateChange, templateId, variant]);

  useEffect(() => {
    const frameWindow = frameRef.current?.contentWindow;
    if (!frameWindow) return;
    const payload = { type: "sitecraft:content", templateId, siteKey, draft, locale, expectedTargets, variant };
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
  }, [draft, expectedTargets, locale, templateId, variant]);

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
        missingSlots?: string[];
        requestId?: string;
        fields?: LeadFormFields;
      };
      if (data?.type === "sitecraft:select" && data.target && onSelectTarget) {
        const target = targetPrompts[data.target];
        if (target) onSelectTarget(data.slot || data.target, target.label, target.prompt, data.slot);
      }
      if (data?.type === "sitecraft:ready" && !draft && !resolvedRef.current) {
        resolvedRef.current = true;
        onPreviewStateChange?.("ready");
      }
      if (data?.type === "sitecraft:applied" && typeof data.revision === "number") {
        if (!resolvedRef.current) {
          resolvedRef.current = true;
          onPreviewStateChange?.("ready");
        }
        if (onApplyReport) {
          onApplyReport({ revision: data.revision, appliedSlots: data.appliedSlots ?? [], missingSlots: data.missingSlots ?? [] });
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
  }, [draft, onApplyReport, onLeadSubmit, onPreviewStateChange, onSelectTarget, siteKey, templateId]);

  const sendContent = () => {
    frameRef.current?.contentWindow?.postMessage(
      { type: "sitecraft:content", templateId, siteKey, draft, locale, expectedTargets, variant },
      "*",
    );
  };

  return (
    <iframe
      ref={frameRef}
      className={`open-source-template-frame open-source-template-frame-${variant}`}
      src={`/api/templates/${encodeURIComponent(templateId)}/preview?v=20260902-12`}
      title={`开源模板 ${templateId} 预览`}
      loading={variant === "thumbnail" ? "lazy" : "eager"}
      sandbox="allow-scripts allow-forms"
      onLoad={sendContent}
      onError={() => {
        if (resolvedRef.current) return;
        resolvedRef.current = true;
        onPreviewStateChange?.("error");
      }}
    />
  );
}
