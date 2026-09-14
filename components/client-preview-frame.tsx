"use client";

import { useEffect, useState } from "react";
import { OpenSourceTemplateFrame } from "@/components/open-source-template-frame";
import { siteDraftSchema, type SiteDraft } from "@/lib/site-document";

const REAL_PREVIEW_DRAFT_KEY = "sitecraft:real-preview-draft:v1";
const REAL_PREVIEW_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * 新标签共享的是同源 localStorage。快照有明确时效和完整 schema 校验，
 * 防止旧业务内容或损坏数据被套到另一份模板上。
 */
export function ClientPreviewFrame({ templateId, siteId }: { templateId: string; siteId?: string }) {
  const [draft, setDraft] = useState<SiteDraft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDraft(null);
    setLoaded(false);
    setLoadError(false);

    const loadDraft = async () => {
      try {
        if (siteId) {
          const response = await fetch(`/api/sites/${encodeURIComponent(siteId)}/draft`, { cache: "no-store" });
          if (!response.ok) throw new Error("Draft request failed");
          const payload = await response.json() as { draft?: unknown };
          const parsedDraft = siteDraftSchema.safeParse(payload.draft);
          if (!parsedDraft.success || parsedDraft.data.templateId !== templateId) throw new Error("Draft does not match template");
          if (!cancelled) setDraft(parsedDraft.data);
          return;
        }

        const raw = window.localStorage.getItem(REAL_PREVIEW_DRAFT_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { savedAt?: unknown; draft?: unknown };
          const age = typeof parsed.savedAt === "number" ? Date.now() - parsed.savedAt : Number.POSITIVE_INFINITY;
          const parsedDraft = siteDraftSchema.safeParse(parsed.draft);
          if (age >= 0 && age <= REAL_PREVIEW_MAX_AGE_MS && parsedDraft.success && parsedDraft.data.templateId === templateId) {
            if (!cancelled) setDraft(parsedDraft.data);
          } else {
            window.localStorage.removeItem(REAL_PREVIEW_DRAFT_KEY);
          }
        }
      } catch {
        if (!cancelled && siteId) setLoadError(true);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };

    void loadDraft();
    return () => { cancelled = true; };
  }, [siteId, templateId]);

  if (!loaded) {
    return <div className="template-preview-loading" aria-busy="true">正在加载模板…</div>;
  }

  if (loadError) {
    return <div className="template-preview-loading" role="alert">站点草稿暂时无法读取</div>;
  }

  if (draft) {
    return (
      <section className="filled-content-preview">
        <div className="filled-content-preview-label">
          <span>已填内容预览</span>
          <span aria-hidden="true"> · v{draft.revision}</span>
        </div>
        <OpenSourceTemplateFrame
          templateId={templateId}
          draft={draft}
          locale={draft.locale}
          variant="preview"
        />
      </section>
    );
  }

  return (
    <section className="original-template-preview">
      <div className="filled-content-preview-label">模板原貌</div>
      <OpenSourceTemplateFrame templateId={templateId} variant="preview" />
    </section>
  );
}
