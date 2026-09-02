"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { SiteRenderer } from "@/components/site-renderer";
import { normalizeDraft, type SiteDraft } from "@/lib/site-model";
import { defaultDraft } from "@/lib/site-document";

// 临时导出页：把指定 site 的草稿用 SiteRenderer 渲染（供固化成离线 HTML，用完删除）
export default function ExportPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const [draft, setDraft] = useState<SiteDraft | null>(null);
  const [locale, setLocale] = useState<"zh" | "en">("zh");
  // ?lang=en 时初始为英文（供导出英文版）

  useEffect(() => {
    setDraft(null);
    const lang = new URLSearchParams(window.location.search).get("lang");
    if (lang === "en") setLocale("en");
    fetch(`/api/sites/${encodeURIComponent(siteId)}/draft`, { cache: "no-store" })
      .then((response) => response.json())
      .then((snapshot: { draft?: unknown }) => {
        if (snapshot.draft) setDraft(normalizeDraft(snapshot.draft));
      })
      .catch(() => setDraft(defaultDraft));
  }, [siteId]);

  if (!draft) return <main className="export-shell" aria-busy="true" style={{ minHeight: "100vh" }} />;

  return (
    <main className="export-shell">
      <SiteRenderer
        draft={draft}
        locale={locale}
        mode="published"
        onLocaleChange={setLocale}
      />
    </main>
  );
}
