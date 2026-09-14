import type { Metadata } from "next";

import { getPublishedRelease } from "@/lib/release-store";
import { normalizeDraft } from "@/lib/site-model";
import { deriveSeoMetadata } from "@/lib/seo-metadata";
import PublishedSiteClient from "./client";

/**
 * 发布页外壳（服务端）。
 *
 * A11（2026-09-09）：此前该页整体是客户端组件，**没有 SEO 元数据**——
 * 分享链接无预览、搜索引擎抓不到摘要。拆成「服务端外壳 + 客户端渲染」后：
 * - 服务端读发布快照 → 派生 `generateMetadata`（title/description/OG）
 * - 同时把草稿作为 `initialDraft` 传给客户端，**首屏不再空等 fetch**
 *
 * 注意：`release-store` 是服务端专用（PG / 文件存储），不能进客户端包。
 */
export async function generateMetadata({ params }: { params: Promise<{ siteKey: string }> }): Promise<Metadata> {
  const { siteKey } = await params;
  try {
    const release = await getPublishedRelease(siteKey);
    if (!release?.draft) return { title: "站点未发布" };
    const draft = normalizeDraft(release.draft);
    const seo = deriveSeoMetadata(draft, draft.locale);
    return {
      title: seo.title,
      description: seo.description,
      openGraph: { title: seo.ogTitle, description: seo.ogDescription, type: "website" },
    };
  } catch {
    // SEO 失败不应阻断页面渲染
    return { title: "企业官网" };
  }
}

export default async function PublishedSitePage({ params }: { params: Promise<{ siteKey: string }> }) {
  const { siteKey } = await params;
  let initialDraft = null;
  try {
    const release = await getPublishedRelease(siteKey);
    if (release?.draft) initialDraft = normalizeDraft(release.draft);
  } catch {
    // 读取失败时交给客户端走原有的 fetch + 错误提示路径
    initialDraft = null;
  }
  return <PublishedSiteClient siteKey={siteKey} initialDraft={initialDraft} />;
}
