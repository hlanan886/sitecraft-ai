"use client";

import { useEffect, useState } from "react";
import { OpenSourceTemplateFrame } from "@/components/open-source-template-frame";
import { defaultDraft, type SiteDraft } from "@/lib/site-document";

// 与 app/generate/page.tsx 的 REAL_PREVIEW_DRAFT_KEY 保持一致：
// 从确认页点"查看真实预览"时写入用户改后的预览草稿（色板/板块/公司名/模板），
// 本组件读取并套用，确保新标签页看到的是"改变后的内容"而非模板默认页。
const REAL_PREVIEW_DRAFT_KEY = "sitecraft:real-preview-draft:v1";

/**
 * 真实模板预览的客户端容器：
 * - 若确认页存了改后 draft，则读取并传给 iframe 套用（postMessage 桥接）
 * - 否则回退到模板默认预览（与旧行为一致）
 */
export function ClientPreviewFrame({ templateId }: { templateId: string }) {
  const [draft, setDraft] = useState<SiteDraft | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(REAL_PREVIEW_DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SiteDraft>;
        // 只套用来自同模板的草稿；模板不一致时忽略（避免张冠李戴）
        if (parsed.templateId === templateId) {
          setDraft({ ...defaultDraft, ...parsed, templateId } as SiteDraft);
        }
        window.sessionStorage.removeItem(REAL_PREVIEW_DRAFT_KEY);
      }
    } catch {
      // 读取失败时降级为模板默认预览
    }
    setLoaded(true);
  }, [templateId]);

  if (!loaded) {
    return <div className="template-preview-loading" aria-busy="true">正在加载模板…</div>;
  }

  return (
    <OpenSourceTemplateFrame
      templateId={templateId}
      draft={draft ?? undefined}
      variant="preview"
    />
  );
}
