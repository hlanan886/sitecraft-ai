# 模板化对策：补模板分类 + 放开跨分类 + 风格变体

- 日期：2026-09-01
- 场景：用户反馈"推荐的现有模板只能匹配类似相关的吗？这样生成的会不会模板化都一样"——锁定匹配但自身模板不够多时体验受限
- 方向：产品设计 / 模板系统
- 置信度：7
- 层级：复合
- 状态：已落地
- 复用量：1
- 来源：[Durable Restyle 区块换风格](https://www.makingthatwebsite.com/how-to-build-a-website-with-durable-ai-website-builder/)、[Wix Harmony 不锁死用户](https://www.wix.com/blog/wix-artificial-design-intelligence)、[ScrewFast GitHub](https://github.com/mearashadowfax/ScrewFast)

## 问题

推荐逻辑按 category 精确锁定（关键词→分类→分类内选模板），但制造业只有 1 个模板（forge）、外贸只有 2 个（atlas/landwind），用户说"做个精密零部件厂官网"100% 出 forge，可选空间几乎为零。加上本地 `SiteRenderer` 是单一抽象渲染器（同一套 DOM 结构，差异只是 per-template CSS），18 个模板本质是"同一结构的 18 种皮肤"，产生强烈的"模板化"感。

## 借鉴方案

从 Durable（Restyle 区块换风格）和 Wix Harmony（不锁死用户、AI 与手动编辑随时切换）提炼四条对策：

1. **补分类模板**：制造业缺口最大，补 MIT 开源模板 ScrewFast（⭐1.4k，Astro，工业制造定位），让制造业从 1 个变 2 个。
2. **放开跨分类选择**：确认页换模板下拉从"只列同 category"改为"全部模板按分类分组（推荐分类排前）"，用户可自由换到其他方向的模板，不被分类锁死。
3. **增强设计变量变体**：色板从 6 种扩到 12 种（新增 teal/crimson/indigo/graphite/forest/sky），同步扩 `COLOR_TONES` 枚举和 `buildIntentPrompt` 的 colorExamples，让同一模板能变出更多气质。
4. **生成后换风格引导**：确认页加风格选择器（12 色板），实时预览 `--site-primary` 变化；用户手动选风格后，execute 时用 `effectiveColorTone` 覆盖 intent 传给生成 API，保证预览与生成一致（生成器已通过 `set_design_tokens` 操作持久化 designTokens）。

## 关键决策

- ScrewFast 选型：MIT 协议 + Astro + 工业制造定位 + 有 live demo（screwfast.uk），直接补制造业缺口。不用 GPL 的 astroship（协议不宽松）。
- 跨分类下拉用 `<optgroup>` 分组 + 推荐分类标注"（推荐）"，比平铺列表清晰，且不改变 `resolveTemplate` 的推荐逻辑（只放开用户手动选择空间）。
- 风格切换的持久化：预览用 `effectiveColorTone`（手动选优先），execute 时 `styleTone ? {...intent, colorTone: styleTone} : intent`，保证生成结果与预览一致。
- 本地预览策略：ScrewFast 是 Astro 项目（无 index.html），本地结构预览走 `SiteRenderer` 兜底，与 fresh/shadcn 一致。

## 搜索策略

用 `gh api "search/repositories?q=topic:astro-template+stars:%3E100"` 搜模板合集，比 WebFetch 的 GitHub 搜索更稳（避开 429）。发现 **ScrewFast**（⭐1.4k，MIT，Astro，工业制造定位）是补制造业缺口的理想来源。关键教训：**搜索时 license 一定要过滤**（astroship GPL-3.0 就不可用）。

## 验证记录（证据链）

- 自动化：`npm test` 142 项全部通过（含新增 graphite 色板测试）；`npx tsc --noEmit` exit 0；`npm run build` 成功。
- 运行时（Playwright，stub `/api/sites/demo/generate` 返回 ready）：模板页 19 张卡片、SCREWFAST 卡片存在、制造业过滤 2 个；确认页跨分类下拉有 4 个 optgroup 分组（制造业（推荐）/外贸目录/科技企业/专业服务）；风格选择器 12 个选项；切 teal 后 `--site-primary` 变为 `#0f6b6b`（实时预览生效）。
- 已验证范围：DOM 级验证充分。
- 未验证范围：真实意图分析 API 的 end-to-end 生成（stub 只验证到确认页 UI）；生成后 designTokens 在 workspace 实际渲染效果。

## 落地版

- `lib/template-catalog.ts`：新增 `screwfast` 模板条目（category 制造业）。
- `lib/design-variants.ts`：palettes 扩到 12 色板。
- `lib/site-intent.ts`：`COLOR_TONES` 扩到 12，`colorExamples` 同步。
- `app/generate/page.tsx`：确认页跨分类 `<optgroup>` 下拉 + 风格选择器 + execute 时 `effectiveColorTone` 覆盖。
- `app/globals.css`：screwfast per-template CSS + 风格选择器样式。
- `.gitmodules` / `vendor/open-source-templates/screwfast`：新增子模块。
- `OPEN_SOURCE_TEMPLATES.md`：登记 SCREWFAST。

## 当前结论

方案已落地并验证。置信度暂定 7——补分类模板 + 放开跨分类 + 风格变体有效缓解"模板化"，但"模板化"的根本（`SiteRenderer` 单一结构、制造业模板数仍偏少）需要持续补模板才能真正解决。若未来制造业/外贸模板各补到 4+，且 workspace 生成后能一键 Restyle，可提升到 8。
