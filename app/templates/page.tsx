"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  ExternalLink,
  Sparkles,
  LoaderCircle,
  Upload,
  WandSparkles,
  MessageSquareText,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CreateTemplateDialog } from "@/components/create-template-dialog";
import { OpenSourceTemplateFrame } from "@/components/open-source-template-frame";
import { templates } from "@/lib/site-model";

const filters = ["全部模板", "制造业", "外贸目录", "科技企业", "专业服务"];

const starterExamples = [
  "做个光伏出口企业的官网，主打欧美，要显得专业可靠",
  "帮我的 SaaS 团队做官网，用户是海外开发者",
  "工业零部件厂的官网，突出质量和服务",
];

/**
 * 运行时模板（用户自己做的）在列表里的形状。
 *
 * 单独一个类型而不是复用 `Template`：那个类型要求 `promptProfile`、`source.repoUrl`
 * 等一堆**只会出现在基线模板上**的字段，为了展示一张卡片去伪造它们
 * （填假 repoUrl、编 starters）比多写一个类型糟得多。
 */
type RuntimeTemplateCard = {
  id: string;
  name: string;
  category: string;
  description: string;
  tags: string[];
  source: { name: string; framework: string };
  /** 可编辑位置的数量——**A 路径与 B 路径差别最大的地方**，必须让它可见 */
  slots: number;
};

export default function TemplatesPage() {
  const router = useRouter();
  const [filter, setFilter] = useState("全部模板");
  const [selected, setSelected] = useState("forge");
  const [prompt, setPrompt] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  /**
   * 用户自己做的模板（运行时注册）。
   *
   * **客户端拿不到**——运行时注册表只在服务端进程里有，
   * 客户端 bundle 里 `allTemplates()` 恒等于 22 个基线模板
   * （见 `lib/site-model.ts` 的 `runtimeLoader` 说明）。所以只能走接口。
   */
  const [mine, setMine] = useState<RuntimeTemplateCard[]>([]);
  const [mineError, setMineError] = useState("");

  const loadMine = useMemo(
    () => async () => {
      try {
        const response = await fetch("/api/templates/runtime", { cache: "no-store" });
        if (!response.ok) {
          setMineError("读不到你自己做的模板（接口返回了错误）。");
          return;
        }
        const body = (await response.json()) as { templates?: RuntimeTemplateCard[] };
        setMine(body.templates ?? []);
      } catch {
        setMineError("读不到你自己做的模板（网络问题）。");
      }
    },
    [],
  );

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  const visible = useMemo(
    () =>
      filter === "全部模板"
        ? templates
        : templates.filter((item) => item.category === filter),
    [filter],
  );
  /** 自己做的模板同样受分类筛选——不筛的话切到"科技企业"还能看到制造业的自己做模板，很怪。 */
  const visibleMine = useMemo(
    () => (filter === "全部模板" ? mine : mine.filter((item) => item.category === filter)),
    [filter, mine],
  );
  const goGenerate = (q?: string, templateId?: string) => {
    const params = new URLSearchParams();
    const value = (q ?? prompt).trim();
    if (value) params.set("q", value);
    if (templateId) params.set("templateId", templateId);
    router.push(`/generate${params.toString() ? `?${params.toString()}` : ""}` as Route);
  };
  /**
   * 建站：**显式点 CTA 才产生一个站**（2026-09-13 用户裁决：预览与建站解耦）。
   *
   * ## 为什么不再是"点卡片直接进工作台"
   *
   * 旧行为（2026-09-09 加）是点卡片就 `router.push('/workspace?template=<id>')`——
   * 而那条路径**不带 siteId**。工作台的 `siteId` 默认 `"demo"`（`workspace/page.tsx:146`），
   * 而 `?template=` 的守卫又只认**编译期 22 个基线**（`:298` 的 `templates.some(...)`），
   * **运行时模板（用户自己做的）不在其中** → `set_template` 不执行 →
   * 用户点自己的模板，打开的却是 `demo` 站点（实测：显示 foxi 模板 + 云湃智算）。
   *
   * 现在改成两段式：**点卡片只更新预览**（零站点、零记录，反复比较零成本），
   * **点 CTA 才真的 createSite 并跳 `?siteId=`**（拿到的是一个真站，发布/素材/版本历史都可用）。
   *
   * 用 `POST /api/sites` 而不是再走 `?template=`：那条路的鉴权与校验
   * （`app/api/sites/route.ts:10` 用 `allTemplates()`，认运行时模板）都已经是对的，
   * 直接复用，不在前端重造一遍。
   */
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const startSite = async (templateId: string, presetPrompt?: string) => {
    if (starting) return;
    setStarting(true);
    setStartError("");
    try {
      const name = templates.find((item) => item.id === templateId)?.name
        ?? mine.find((item) => item.id === templateId)?.name
        ?? "我的站点";
      const response = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, templateId, locales: ["zh", "en"] }),
      });
      const body = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!response.ok || !body?.id) throw new Error(body?.error || "建站失败，请稍后重试");
      // 建站成功 → 进工作台。带 siteId，**不带 template**（模板已经在建站时定好）。
      // 点 starter 文字来时额外带 `prompt`——工作台会**预填到输入框**，
      // 不自动发送（2026-09-09 用户确认：避免没看清就烧掉一次 AI 调用）。
      const params = new URLSearchParams({ siteId: body.id });
      if (presetPrompt?.trim()) params.set("prompt", presetPrompt.trim());
      router.push(`/workspace?${params.toString()}` as Route);
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "建站失败");
      setStarting(false);
    }
  };
  return (
    <div className="template-page">
      <header className="topbar">
        <div className="breadcrumbs">
          <Link href="/">
            <ArrowLeft size={14} />
          </Link>
          <ChevronRight size={12} />
          <strong>选择一个方向</strong>
        </div>
        <div className="top-actions">
          <span className="save-status">
            <Check size={13} />
            自动保存
          </span>
          <span className="eyebrow" style={{ marginLeft: 7 }}>
            Step 01 / 03
          </span>
        </div>
      </header>
      <main className="page-content">
        <div className="template-intro">
          {/* ⚠️ 数字**派生**自编译期基线常量，不手抄（军规 1）。
              这里原本写死 "22 open-source templates"——正是这页把"用户做的模板"
              加进来的原因注释里点名的那句假话：基线加了新模板它不会变。 */}
          <div className="eyebrow">{templates.length} open-source templates{visibleMine.length > 0 ? ` + 你做的 ${visibleMine.length} 个` : ""}</div>
          <h1>
            先选一个方向，
            <br />
            <span style={{ color: "#2e6b4f" }}>再让 AI 继续。</span>
          </h1>
          <p>
            每个模板都能被一句话驱动：直接说你的业务，AI 会推荐并生成初稿。
            <br />
            <strong>也可以传一张截图、给一个网址，让 AI 做一个新的。</strong>
          </p>
        </div>
        {/* 「用截图/网址做新模板」的入口。
            做成**独立的一块**而不是输入框上的一个加号——因为这条路的产出
            与"用一句话建站"完全不同（一个是造新模板，一个是选已有模板），
            藏进加号里会让人以为"这只是另一种输入方式"（计划 §3.1 的判断）。 */}
        <div className="template-create-band">
          <div>
            <strong>有现成的截图或网址？</strong>
            <span>传一张截图（能编辑的新模板），或者给一个网址（复刻 / 原样搬下来）</span>
          </div>
          <button className="primary-button" onClick={() => setDialogOpen(true)}>
            <Upload size={14} /> 做新模板 <ArrowRight size={14} />
          </button>
        </div>
        <div className="template-prompt-band">
          <MessageSquareText size={17} className="template-prompt-icon" />
          <input
            className="template-prompt-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="说一句话让 AI 直接建站，例如：做个光伏出口企业的官网，主打欧美"
            maxLength={400}
            onKeyDown={(e) => {
              if (e.key === "Enter" && prompt.trim()) goGenerate();
            }}
          />
          <button
            className="primary-button"
            disabled={!prompt.trim()}
            onClick={() => goGenerate()}
          >
            <WandSparkles size={14} /> 用这句话建站 <ArrowRight size={14} />
          </button>
        </div>
        <div className="template-prompt-examples">
          {starterExamples.map((ex) => (
            <button key={ex} className="template-chip" onClick={() => goGenerate(ex)}>
              {ex}
            </button>
          ))}
        </div>
        <div className="template-filters">
          {filters.map((item) => (
            <button
              key={item}
              className={`filter ${item === filter ? "active" : ""}`}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="template-grid">
          {visible.map((template) => (
            <article
              className={`template-card ${selected === template.id ? "selected" : ""}`}
              key={template.id}
              // 点卡片 = **只选中并预览**（2026-09-13 用户裁决：预览与建站解耦）。
              // 不建站、不写任何记录——误点与反复比较是零成本的。
              // 想用这个模板建站，走底部那条显式 CTA。
              onClick={() => setSelected(template.id)}
            >
              <div className="template-cover template-live-cover">
                <OpenSourceTemplateFrame templateId={template.id} variant="thumbnail" />
                <div className="template-live-badge">本地模板预览 · MIT</div>
                <Link
                  href={`/templates/${template.id}/preview` as Route}
                  className="template-preview-open"
                  onClick={(event) => event.stopPropagation()}
                >
                  预览整页 <ExternalLink size={11} />
                </Link>
              </div>
              <div className="template-info">
                <h3>{template.name}</h3>
                <p>{template.description}</p>
                <div className="template-tags">
                  {template.tags.map((tag) => (
                    <span className="template-tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="template-ai-profile">
                  <Sparkles size={11} />
                  <span>{template.promptProfile.role}</span>
                </div>
                <div className="template-starter" onClick={(event) => event.stopPropagation()}>
                  <span className="template-starter-label">你可以对 AI 说</span>
                  {template.promptProfile.starters.slice(0, 2).map((starter) => (
                    <button
                      key={starter}
                      className="template-starter-chip"
                      onClick={() => void startSite(template.id, starter)}
                    >
                      {starter}
                    </button>
                  ))}
                </div>
                {/* 卡片底部的「预览」入口已删除（2026-09-09）：封面本身就是整页缩略预览，
                    再挂一条文字链是重复入口。放大看整页仍走封面右下角的「预览整页」。
                    原「官方演示」外链更早一步删过——demoUrl 实测为空 href，点了没反应。 */}
                <div className="template-source">
                  <span>{template.source.name} · {template.source.framework}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
        {/* 用户自己做的模板（运行时注册）。
            此前它们**根本不出现在这一页**——`templates` 是编译期 22 个固定条目，
            而拼装/截图/搬站产出的是运行时注册的。结果用户做完模板回来找不到它，
            页头那句「22 open-source templates」也变成了假话（计划 §9.5）。 */}
        {visibleMine.length > 0 && (
          <section className="template-mine">
            <div className="template-mine-head">
              <h2>你做的模板</h2>
              <span>
                共 {visibleMine.length} 个 · 点卡片直接拿去建站
              </span>
            </div>
            <div className="template-grid">
              {visibleMine.map((item) => (
                <article
                  className={`template-card ${selected === item.id ? "selected" : ""}`}
                  key={item.id}
                  // 同上：只选中预览。运行时模板尤其需要——旧路径点它会掉进 `?template=`
                  // 那条只认编译期基线的守卫，打开的是**别的站**（2026-09-13 修）。
                  onClick={() => setSelected(item.id)}
                >
                  <div className="template-cover template-live-cover">
                    <OpenSourceTemplateFrame templateId={item.id} variant="thumbnail" />
                    {/* 可编辑位置数是**这一页最该显示的信息**：
                        B 路径产物有 11–13 个，A 路径搬来的常常只有 1 个，
                        而两者卡片长得一样。不标出来，用户会以为都能改。 */}
                    <div className={`template-live-badge ${item.slots <= 3 ? "badge-warn" : ""}`}>
                      {item.slots <= 3 ? `仅 ${item.slots} 处可编辑` : `${item.slots} 处可编辑`}
                    </div>
                    <Link
                      href={`/templates/${item.id}/preview` as Route}
                      className="template-preview-open"
                      onClick={(event) => event.stopPropagation()}
                    >
                      预览整页 <ExternalLink size={11} />
                    </Link>
                  </div>
                  <div className="template-info">
                    <h3>{item.name}</h3>
                    <p>{item.description}</p>
                    <div className="template-tags">
                      {item.tags.slice(0, 4).map((tag) => (
                        <span className="template-tag" key={tag}>
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="template-source">
                      <span>{item.source.name} · {item.source.framework}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {mineError && <p className="template-mine-error">{mineError}</p>}

        {/* 底部：**预览 + 显式 CTA**（2026-09-13 用户裁决：预览与建站解耦）。
            此前这条只是"已选模板 XXX"一个死条，而点卡片就直接进工作台——
            现在卡片只选中，建站必须点这里的 CTA。
            小字如实说明两者差别：预览不产生站点，发布/素材/版本历史要建站后才有。 */}
      </main>
      <div className="template-selected">
        <div>
          <strong>
            {templates.find((item) => item.id === selected)?.name
              ?? mine.find((item) => item.id === selected)?.name
              ?? selected}
          </strong>
          <small>
            已选 · 上方卡片只切换预览，**不会**生成站点；点右边按钮才会用它建一个站
          </small>
          {startError && <small className="template-start-error">{startError}</small>}
        </div>
        <button
          className="primary-button"
          disabled={starting}
          onClick={() => void startSite(selected)}
        >
          {starting ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}
          {starting ? "正在建站…" : "用这个模板开始"}
        </button>
      </div>
      {dialogOpen && (
        <CreateTemplateDialog
          onClose={() => {
            setDialogOpen(false);
            // 关掉弹窗后刷新"你做的模板"——刚做好的那个应当立刻出现在列表里
            void loadMine();
          }}
        />
      )}
    </div>
  );
}
