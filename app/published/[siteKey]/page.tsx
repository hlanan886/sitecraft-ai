"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { OpenSourceTemplateFrame } from "@/components/open-source-template-frame";
import {
  defaultDraft,
  normalizeDraft,
  type Locale,
  type SiteDraft,
} from "@/lib/site-model";

export default function PublishedSitePage() {
  const { siteKey } = useParams<{ siteKey: string }>();
  const [draft, setDraft] = useState<SiteDraft | null>(null);
  const [locale, setLocale] = useState<Locale>("zh");

  useEffect(() => {
    setDraft(null);
    fetch(`/api/sites/${encodeURIComponent(siteKey)}/draft`, { cache: "no-store" })
      .then((response) => response.json())
      .then((snapshot: { draft?: unknown }) => {
        if (snapshot.draft) setDraft(normalizeDraft(snapshot.draft));
      })
      .catch(() => {
        setDraft(defaultDraft);
      });
  }, [siteKey]);

  if (!draft) return <main className="published-template-shell" aria-busy="true" />;

  return (
    <main className="published-template-shell">
      <div className="published-template-locale" aria-label="站点语言">
        <button className={locale === "zh" ? "active" : ""} onClick={() => setLocale("zh")}>中</button>
        <button className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")}>EN</button>
      </div>
      <OpenSourceTemplateFrame templateId={draft.templateId} draft={draft} locale={locale} variant="published" />
    </main>
  );
}
