"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { OpenSourceTemplateFrame } from "@/components/open-source-template-frame";
import { RealTemplateExportButton } from "@/components/real-template-export-button";
import { normalizeDraft, type SiteDraft } from "@/lib/site-model";

const EXPORT_FRAME_ID = "sitecraft-real-template-export-frame";

export default function ExportPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const [draft, setDraft] = useState<SiteDraft | null>(null);
  const [locale, setLocale] = useState<"zh" | "en">("zh");
  const [error, setError] = useState<string | null>(null);
  const [appliedRevision, setAppliedRevision] = useState<number | null>(null);

  useEffect(() => {
    setDraft(null);
    setError(null);
    setAppliedRevision(null);
    const lang = new URLSearchParams(window.location.search).get("lang");
    if (lang === "en") setLocale("en");
    fetch(`/api/sites/${encodeURIComponent(siteId)}/draft`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("site_not_found");
        return response.json();
      })
      .then((snapshot: { draft?: unknown }) => {
        if (!snapshot.draft) throw new Error("draft_not_found");
        setDraft(normalizeDraft(snapshot.draft));
      })
      .catch(() => setError("没有找到可导出的站点草稿。"));
  }, [siteId]);

  const handleApplyReport = useCallback((report: { revision: number; incompatible: boolean }) => {
    setAppliedRevision(report.incompatible ? null : report.revision);
  }, []);

  if (error) return <main className="export-shell"><p role="alert">{error}</p></main>;
  if (!draft) return <main className="export-shell" aria-busy="true" style={{ minHeight: "100vh" }} />;

  const ready = appliedRevision === draft.revision;
  return (
    <main className="export-shell">
      <div className="export-toolbar">
        <div>
          <strong>{draft.siteName}</strong>
          <span>{ready ? "真实模板内容已核验" : "正在应用真实模板内容…"}</span>
        </div>
        <div className="export-actions">
          <div className="segmented-control" aria-label="导出语言">
            <button type="button" className={locale === "zh" ? "active" : ""} onClick={() => { setLocale("zh"); setAppliedRevision(null); }}>中</button>
            <button type="button" className={locale === "en" ? "active" : ""} onClick={() => { setLocale("en"); setAppliedRevision(null); }}>EN</button>
          </div>
          <RealTemplateExportButton
            frameId={EXPORT_FRAME_ID}
            siteId={siteId}
            templateId={draft.templateId}
            revision={draft.revision}
            disabled={!ready}
          />
        </div>
      </div>
      <OpenSourceTemplateFrame
        id={EXPORT_FRAME_ID}
        templateId={draft.templateId}
        siteKey={siteId}
        draft={draft}
        locale={locale}
        variant="published"
        onApplyReport={handleApplyReport}
      />
    </main>
  );
}
