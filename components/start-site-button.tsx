"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";

/**
 * 「用这个模板建站」按钮——**显式建站**，不在预览页里偷偷建。
 *
 * ## 为什么单独一个组件（而不是内联在预览页里）
 *
 * 预览页 `app/templates/[templateId]/preview/page.tsx` 是**服务端组件**，
 * 体内不能挂 `onClick`。而建站要发请求 + 跳转，所以必须是个客户端组件。
 *
 * ## 为什么不用 `<Link href="/workspace?template=...">`
 *
 * 那条路径**不带 siteId**：工作台的 `siteId` 默认 `"demo"`
 * （`app/workspace/page.tsx:146`），而 `?template=` 的守卫只认**编译期 22 个基线**
 * （`:298`），运行时模板（用户自己做的）不在其中 → `set_template` 不执行 →
 * 打开的其实是 `demo` 站点自己那个模板（实测显示 foxi 模板 + 云湃智算）。
 *
 * 现在改成直接 `POST /api/sites`（`app/api/sites/route.ts:10` 的校验用 `allTemplates()`，
 * 认运行时模板），拿到真站再跳 `?siteId=`——发布/素材/版本历史都可用。
 *
 * ## 与模板库页那个 CTA 的关系
 *
 * 两处是**同一个动作的两个入口**（模板库底部 / 预览页工具栏）。
 * 逻辑一样但**没有抽公共 hook**：抽出去要新建一个 lib 文件，
 * 而这两处只差在一个可选的 `presetPrompt`——为 20 行逻辑引入一层间接不划算。
 * 若将来出现第三处，再抽。
 */
export function StartSiteButton({
  templateId,
  label = "用这个模板建站",
  className = "primary-button",
}: {
  templateId: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: templateId, templateId, locales: ["zh", "en"] }),
      });
      const body = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!response.ok || !body?.id) throw new Error(body?.error || "建站失败，请稍后重试");
      router.push(`/workspace?siteId=${encodeURIComponent(body.id)}` as Route);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "建站失败");
      setBusy(false);
    }
  };

  return (
    <>
      <button className={className} disabled={busy} onClick={() => void start()}>
        {busy ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}
        {busy ? "正在建站…" : label}
      </button>
      {error && <span className="template-start-error">{error}</span>}
    </>
  );
}
