import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, ExternalLink, Github, Sparkles } from "lucide-react";
import { allTemplates } from "@/lib/site-model";
import { isRuntimeTemplatePath } from "@/lib/template-runtime";
import { collectSlotTargetsFromHtmlString, readTemplateEntryHtml } from "@/lib/template-runtime-loader";
import { ClientPreviewFrame } from "@/components/client-preview-frame";
import { StartSiteButton } from "@/components/start-site-button";

/**
 * 数一个模板 HTML 里实际存在的编辑位。
 *
 * 返回 `[]` 表示读不到 HTML（不该发生，但不值得为此让整页 500）。
 */
function editableSlotsOf(localPath: string): string[] {
  const html = readTemplateEntryHtml(localPath);
  return html ? collectSlotTargetsFromHtmlString(html) : [];
}

export default async function TemplatePreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ templateId: string }>;
  searchParams: Promise<{ siteId?: string | string[] }>;
}) {
  const { templateId } = await params;
  const previewSearchParams = await searchParams;
  const siteId = typeof previewSearchParams.siteId === "string" ? previewSearchParams.siteId : undefined;
  // 「还没注册」与「真的不存在」要给出不同反馈。
  // 沉淀模板只在**有磁盘的那个进程**里可见（见 lib/template-runtime.ts），
  // 所以换进程/冷启动后看到 404 是完全正常的状态——直接 notFound() 会让用户
  // 以为模板被删了，而其实重启服务就能看到。
  const template = allTemplates().find((item) => item.id === templateId);
  if (!template) notFound();

  /**
   * 自己做的模板要**如实说明可编辑程度**（2026-09-11）。
   *
   * 为什么非说不可：截图生成的模板有十几个编辑位、网址搬来的常常只有 1 个，
   * 而两者在这一页长得**一模一样**。用户点到那个 1 的，进去发现什么都改不了，
   * 只会以为是 bug——而其实是我们没告诉他这两类产物的差别。
   *
   * 基线模板（22 个开源模板）不显示这条——它们的可编辑性由模板自身的
   * adapter 决定，与这里数出来的槽位数不是一回事，混在一起讲反而误导。
   */
  const isMine = isRuntimeTemplatePath(template.source.localPath);
  const slots = isMine ? editableSlotsOf(template.source.localPath) : [];
  const barelyEditable = isMine && slots.length <= 3;

  return (
    <main className="template-preview-page">
      <header className="template-preview-toolbar">
        <div className="template-preview-toolbar-title">
          <Link href="/templates" className="icon-button" aria-label="返回模板列表">
            <ArrowLeft size={15} />
          </Link>
          <div>
            <strong>{siteId ? "已填内容预览" : template.name}</strong>
            <span>开源模板本地快照 · {template.source.name} · {template.source.license}</span>
          </div>
        </div>
        <div className="template-preview-toolbar-actions">
          <a className="secondary-button" href={template.source.repoUrl} target="_blank" rel="noreferrer">
            <Github size={14} /> 源码
          </a>
          <a className="secondary-button" href={template.source.demoUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> 查看官方演示
          </a>
          {/* 显式建站：点它才 createSite 并跳 ?siteId=。理由见 start-site-button.tsx */}
          <StartSiteButton templateId={template.id} label="用此模板建站" />
        </div>
      </header>
      {isMine && (
        <div className={`template-edit-notice ${barelyEditable ? "notice-warn" : ""}`}>
          {barelyEditable ? <AlertTriangle size={14} /> : <Sparkles size={14} />}
          <div>
            {barelyEditable ? (
              <>
                <strong>这个模板基本只能看，不能改。</strong>
                <span>
                  它是从网址<strong>原样搬下来</strong>的静态页，只认得出 {slots.length} 个可编辑位置
                  {slots.length > 0 ? `（${slots.slice(0, 3).join("、")}）` : ""}。
                  想要能改的站，回到模板库用<strong>截图</strong>做一个新的。
                </span>
              </>
            ) : (
              <>
                <strong>这个模板有 {slots.length} 个可编辑位置。</strong>
                <span>
                  进工作台后，首屏、产品、联系方式等都能直接点着改
                  （切到「直接编辑」模式），或者用一句话让 AI 改。
                </span>
              </>
            )}
          </div>
          <StartSiteButton templateId={template.id} label="拿去建站" />
        </div>
      )}
      <div className="template-preview-canvas">
        <ClientPreviewFrame templateId={template.id} siteId={siteId} />
      </div>
    </main>
  );
}
