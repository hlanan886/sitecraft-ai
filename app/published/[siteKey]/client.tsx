"use client";

import { useCallback, useEffect, useState } from "react";
import { OpenSourceTemplateFrame, type LeadFormFields, type LeadSubmitResult } from "@/components/open-source-template-frame";
import {
  normalizeDraft,
  type Locale,
  type SiteDraft,
} from "@/lib/site-model";

export default function PublishedSiteClient({ siteKey, initialDraft }: { siteKey: string; initialDraft: SiteDraft | null }) {
  const [draft, setDraft] = useState<SiteDraft | null>(initialDraft);
  // 2026-09-10：初始语言跟随草稿（此前硬编码 "zh"），否则英文站首帧是中文，
  // 与 `generateMetadata` 用的 `draft.locale` 不一致——访客要手动切换才看到正确语言。
  const [locale, setLocale] = useState<Locale>(initialDraft?.locale ?? "zh");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [frameState, setFrameState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (initialDraft) { setFrameState("ready"); return; }
    setLoadError(null);
    setFrameState("loading");
    fetch(`/api/public/${encodeURIComponent(siteKey)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`站点加载失败（${response.status}）`);
        return response.json();
      })
      .then((snapshot: { release?: { draft?: unknown } }) => {
        if (!snapshot.release?.draft) throw new Error("站点还没有已发布版本");
        setDraft(normalizeDraft(snapshot.release.draft));
      })
      .catch(() => {
        setLoadError("站点暂时无法加载，请稍后刷新重试。");
      });
  }, [siteKey, initialDraft]);

  const submitLead = useCallback(async (fields: LeadFormFields): Promise<LeadSubmitResult> => {
    const payload = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, typeof value === "string" ? value : value.name]),
    );
    try {
      const response = await fetch(`/api/public/${encodeURIComponent(siteKey)}/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ ...payload, idempotencyKey: typeof payload.idempotencyKey === "string" ? payload.idempotencyKey : crypto.randomUUID() }),
      });
      const result = await response.json().catch(() => null) as { ok?: boolean } | null;
      if (!response.ok || !result?.ok) {
        return { ok: false, message: locale === "zh" ? "提交失败，请稍后重试。" : "We could not submit your request. Please try again." };
      }
      return { ok: true, message: locale === "zh" ? "已收到你的需求，我们会尽快与你联系。" : "We received your request and will be in touch soon." };
    } catch {
      return { ok: false, message: locale === "zh" ? "网络暂时不可用，请稍后重试。" : "The network is unavailable. Please try again later." };
    }
  }, [locale, siteKey]);

  if (!draft) {
    return (
      <main className="published-template-shell" aria-busy={!loadError}>
        {loadError ? <div className="published-load-error" role="alert">{loadError}</div> : null}
      </main>
    );
  }

  return (
    <main className="published-template-shell">
      <div className="published-template-locale" aria-label="站点语言">
        <button className={locale === "zh" ? "active" : ""} onClick={() => setLocale("zh")}>中</button>
        <button className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")}>EN</button>
      </div>
      <OpenSourceTemplateFrame
        templateId={draft.templateId}
        siteKey={siteKey}
        draft={draft}
        locale={locale}
        variant="published"
        onLeadSubmit={submitLead}
        onPreviewStateChange={setFrameState}
      />
    </main>
  );
}
