# AI 建站产品的模板展示与一句话生成调研

- 日期：2026-09-01
- 场景：模板展示页体现不出"一句话建站"核心能力，需要借鉴成熟 AI 建站产品的思路与决策来优化模板展示和生成
- 方向：产品设计 / 前端展示
- 置信度：7
- 层级：复合
- 状态：已落地（A/B 已落地，D 部分落地）
- 复用量：1
- 来源：[Framer AI Website Builder](https://www.framer.com/solutions/ai-website-builder/)、[Durable AI 建站流程评测](https://www.makingthatwebsite.com/how-to-build-a-website-with-durable-ai-website-builder/)、[Wix ADI → Harmony 演变](https://www.wix.com/blog/wix-artificial-design-intelligence)、[Framer 模板市场](https://www.framer.com/community/marketplace/templates)、[Webflow 模板市场](https://webflow.com/templates)

## 问题

产品核心能力是"自然语言一句话建站"（一句话 → AI 理解意图 → 推荐模板 → 自动生成初稿），但模板展示页 `/templates` 完全是"传统模板市场"叙事（16 张静态卡片 + 官方 demo + 源码链接），没有任何"一句话"痕迹，用户看不出这是 AI 建站产品。

## 借鉴方案

调研了 9 个主流 AI 建站产品（Framer、Durable、Wix ADI→Harmony、v0、Lovable、Bolt、Dora、Mixo、10Web），提炼出三条核心规律：

1. **成功产品几乎全是 prompt-first**——"翻模板库"不是主入口。模板要么隐于幕后由 AI 自动匹配（Durable/Wix ADI），要么是生成后的换肤选项（Mixo/10Web），要么与提示词双入口并列（Framer）。
2. **模板的价值从"挑选入口"变成"生成后的可控性"**——AI 先给结果，模板/风格负责"不满意就换一个"。
3. **Wix Harmony 模式最贴"模板库为主、带 AI 能力"**：模板与提示词并存，生成后 AI 与手动编辑随时切换，不锁死单一流程。"模板不是独立起点，而是 AI 生成系统的组成部分"。

Framer 的"模板前置"是例外（用户是设计师、已习惯模板库工作流），不是"一句话建站"产品该抄的。

落地时结合现有架构：`SiteRenderer` 是单一抽象渲染器（模板差异靠 `template.colors` + per-template CSS），`promptProfile.starters` 是现成的"一句话驱动"素材。没有引入第二套渲染体系。

## 关键决策

- **A 卡片带一句话入口**：每个模板卡片展示 2 条 `promptProfile.starters` 示例（如"把首屏改成精密零部件出口企业"），点击跳转 `/generate?q=<starter>&templateId=<id>` 并预填，让"每个模板都能被一句话驱动"直接可见。
- **B 顶部加一句话入口**：模板页顶部加 prompt-first 输入框（"说一句话让 AI 直接建站"），Enter 或点击按钮跳转 `/generate?q=<输入>`。双入口并存（挑模板 / 说一句话）。
- **D 扩充开源模板库**：从 GitHub 新增 2 个 MIT 模板（fresh ⭐670、shadcn-landing ⭐2k），注册为子模块 + 加 `templateCatalog` 条目 + per-template CSS。
- **预填机制**：`/generate` 支持 `?q=` 预填 message、`?templateId=` 预选模板；query 优先于 sessionStorage 草稿恢复（防旧草稿覆盖）。
- **不采用 C（预览页生成对比）**：用户明确不做，避免过度改动预览页。

## 搜索策略

方向词：`Framer AI site generator template gallery prompt website builder UX`、`Durable AI user flow template selection`、`Wix ADI artificial design intelligence questionnaire`、`v0 Bolt Lovable prompt to website`。渠道有效性：**WebSearch 摘要 + WebFetch 抓官方页面**有效；WebFetch 对 framer.com 可用（返回高质量一手内容）；webflow.com 有 header overflow（需 r.jina.ai 代理）；GitHub API 搜索用 `gh api search/repositories` 有效（避开 WebFetch 429）。发现的关键约束：**选开源模板必须校验 license**（astroship 是 GPL-3.0 不可用，MIT 才符合本项目策略）。

## 验证记录（证据链）

- 自动化：`npm test` 141 项全部通过；`npx tsc --noEmit` exit 0；`npm run build` 成功（18 个模板相关页面正常生成）。
- 运行时（Playwright，新 dev server 3100 端口）：`/templates` 显示顶部输入框（placeholder 正确）、3 个示例 chips、36 个 starter chips（18 模板 × 2）、18 张模板卡片（含 fresh/shadcn）；点击 starter 跳转 `/generate?q=<starter>&templateId=<id>` 并预填成功；顶部输入框输入→点击→跳转 `/generate?q=<输入>` 预填成功；`/templates/fresh/preview` 和 `/templates/shadcn-landing/preview` 均渲染正常。
- 已验证范围：DOM 级验证充分；截图因环境限制未人工查看。
- 未验证范围：shadcn-landing 本地 `index.html` 仅 1.9KB（可能是壳页面，完整内容依赖构建产物）；fresh 根目录无 `index.html`（Astro 项目需构建），本地结构预览走 `SiteRenderer` 兜底。

## 落地版

- `app/templates/page.tsx`：顶部一句话输入框 + 示例 chips + 卡片 starter 入口，全部跳转 `/generate` 预填。
- `app/generate/page.tsx`：支持 `?q=` 预填 message、`?templateId=` 预选模板，query 优先于草稿恢复。
- `app/globals.css`：新增 prompt-band / starter 区块样式 + fresh / shadcn-landing 的 per-template CSS。
- `lib/template-catalog.ts`：新增 `fresh`、`shadcn-landing` 模板条目（category 科技企业）。
- `.gitmodules` / `vendor/open-source-templates/`：新增 2 个子模块。
- `OPEN_SOURCE_TEMPLATES.md`：登记 2 个新模板。

## 当前结论

方案已在本项目落地并验证。置信度暂定 7——核心规律（prompt-first、模板是生成系统的组成部分）跨多个产品一致验证，但"一句话 starter 入口对转化率的影响"尚无数据验证。若未来补足 shadcn/fresh 的本地完整快照、并统计 starter 入口的使用率，可提升到 8。
