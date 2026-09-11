"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { OpenSourceTemplateFrame, type LeadFormFields, type LeadSubmitResult } from "@/components/open-source-template-frame";
import { SiteRenderer } from "@/components/site-renderer";
import {
  normalizeDraft,
  type Locale,
  type SiteDraft,
} from "@/lib/site-model";

export default function PublishedSitePage() {
  const { siteKey } = useParams<{ siteKey: string }>();
  const [draft, setDraft] = useState<SiteDraft | null>(null);
  const [locale, setLocale] = useState<Locale>("zh");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [frameState, setFrameState] = useState<"loading" | "ready" | "error">("loading");
  const [submitted, setSubmitted] = useState(false);
  const [fallbackSubmitting, setFallbackSubmitting] = useState(false);
  const [fallbackError, setFallbackError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(null);
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
  }, [siteKey]);

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

  const submitFallbackLead = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (fallbackSubmitting) return;
    setFallbackSubmitting(true);
    setFallbackError(null);
    const fields = Object.fromEntries(new FormData(event.currentTarget).entries());
    const result = await submitLead(fields);
    if (result.ok) setSubmitted(true);
    else setFallbackError(result.message ?? "提交失败，请稍后重试。");
    setFallbackSubmitting(false);
  };

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
      {frameState === "error" ? (
        <SiteRenderer
          draft={draft}
          locale={locale}
          mode="published"
          submitted={submitted}
          onSubmitLead={submitFallbackLead}
          submitting={fallbackSubmitting}
          submitError={fallbackError}
        />
      ) : (
        <OpenSourceTemplateFrame
          templateId={draft.templateId}
          siteKey={siteKey}
          draft={draft}
          locale={locale}
          variant="published"
          onLeadSubmit={submitLead}
          onPreviewStateChange={setFrameState}
        />
      )}
    </main>
  );
}
