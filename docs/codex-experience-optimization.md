# sitecraft-ai 一句话建站体验优化 · 交给 Codex 的实现要点

> 面向 **Codex（有视觉能力）** 的实现任务书。先读「现状核实」——**多个问题其实已实现**，只做真实缺口，避免重复造轮子。每项给「改动文件 + 验收标准」。

## 〇、必读现状（省得重复工作）

1. **板块开关已较明确**：`app/generate/page.tsx` confirm 步骤已有 `generate-toggle on/off`（Eye/EyeOff 图标 + 绿/灰底色 + 删除线 + "已显示/已隐藏"文字，globals.css L726-732）。**不是"没有差异"，是要更强**。
2. **确认页预览已本地即时**：generate 页用 `SiteRenderer`（`components/site-renderer.tsx`）`key={template.id}` 重挂载，切模板/板块**即时本地重渲染、不触网**（副标题已写"本地结构预览 · 不依赖官方演示站"）。模板卡片预览（templates 页）同样本地。
3. **429 只在工作区**：工作区用 `OpenSourceTemplateFrame`（iframe → `/api/templates/[id]/preview`）。该路由先 `readTemplateStaticFile` 找本地快照，但 **16 个模板的 submodule 目录全空** → 必然 `fetch(template.source.demoUrl)` 第三方 → 429 系统性风险。**确认页无此问题**。
4. **设计 token 机制已存在**：`lib/site-document.ts` `designTokens`（primary/secondary/accent + fontStyle + radius + density）+ `lib/design-variants.ts` 从 intent.colorTone/tone 推导。SiteRenderer 用 `--site-*` CSS 变量覆盖（site-renderer.tsx L99-105），iframe 桥接脚本用 `--sitecraft-*` 注入 + `!important`（preview route L75-95）。**模板骨架+深度定制的地基已有**，缺「逐模板适配 + 视觉验收」。
5. **canvas 自由设计已存在**：`templateId === "canvas"`（workspace 走 SiteRenderer），但边界未向用户声明。
6. **生成已并行**：`lib/site-generator.ts` `generateDraftOperations` 批A/批B **已是 `Promise.all` 并行**，合并单 commit；SSE `onProgress` 透传真实阶段（route L144/171）。
7. **DeepSeek 429 安全**：官方并发限制 v4-flash **2500**（pro 500），我们一次生成仅 2 并发。**不需要**"短间隔并发"降级。

---

## 一、真实缺口 + 实现要点（按优先级）

### P0-1. 工作区预览 429 降级（#2，系统性）
- **现状**：iframe 加载失败（第三方 429/超时）→ 整块空白或 fallback。
- **方案**：**双层预览**——iframe 加载失败（`onLoad` 检测、或 `X-Sitecraft-Preview-Source` 头判断、或超时未收到 `sitecraft:applied`）→ 自动 fallback 到 `SiteRenderer` 近似渲染 + 顶栏标注"预览降级为本地近似渲染，最终以发布为准"。
- **改动**：`app/workspace/page.tsx`（iframe 失败状态 → 切换 `<SiteRenderer mode="preview">`）；`components/open-source-template-frame.tsx`（暴露 loading/error 状态回调）。
- **验收**：模拟第三方 429（临时改 demoUrl 为不可达）→ 工作区自动显示本地近似预览 + 明确标注，不白屏。
- **不可行项**：拉 16 个 submodule 做本地快照（成本高、需逐模板适配）——不做。

### P0-2. 生成文案去误导（#4）
- **现状**：确认页按钮"用此模板生成初稿"（page.tsx L549）、generating 视图"正在套用现有模板"（L557）已部分修正，但"生成初稿/生成骨架"仍隐含"从 0 生成"。
- **方案**：统一改为**"用此模板生成站点内容"**类表述；SSE status 文案明示"复用模板结构，AI 填充内容"。
- **改动**：`app/generate/page.tsx` 按钮/进度文案、`app/api/sites/[siteId]/generate/route.ts` SSE status、`lib/site-generator.ts` hint。
- **验收**：用户首次看到流程时，能明白"模板结构 + AI 填充"，不以为是从 0 造。

### P0-3. 板块开关反馈强化（#1）
- **现状**：已有图标+色块+删除线。缺"切换时预览联动"。
- **方案**：切换板块显隐时，**预览区对应 section 高亮闪烁一次**（SiteRenderer 支持的话，或包一层过渡）；加 hover 过渡动画（当前只有 translateY(-1px)）。
- **改动**：`app/generate/page.tsx`（切换事件 → 预览区对应 section 闪烁）、`globals.css`（过渡 + 高亮 keyframe）。
- **验收**：点板块开关 → 对应板块在预览里明显闪一下，用户知道"这个板块被操作了"。

### P1-4. 模板深度定制 · 逐模板适配 + 视觉验收（#5）
- **现状**：iframe 的 `--sitecraft-*` `!important` 覆盖依赖模板自身 CSS 选择器命中（h1/h2/h3/button/卡片）。不同模板 DOM 差异 → 覆盖可能不完整。
- **方案**：建**逐模板适配表**（记录每个模板哪些选择器能被 `--sitecraft-*` 命中、哪些漏），针对漏的模板在桥接脚本补针对性选择器；**Codex 逐模板截图比对**（designTokens 各变体 × 16 模板）形成视觉验收报告。
- **改动**：`app/api/templates/[templateId]/preview/route.ts` bridgeScript（按 templateId 条件补选择器）；新 `docs/template-design-token-adaptation.md`（适配表）。
- **验收**：取 3 个差异大模板（forge/atlas/signal），designTokens 三档变体下截图，颜色/字体/圆角/密度覆盖完整。

### P1-5. 自由设计边界如实声明（#6）
- **现状**：canvas 模板存在，但 UI 未声明边界。
- **方案**：canvas 路径（templates 页卡片 + workspace 入口）加徽标/文案"受控空白画布：可改配色、字体、圆角、密度与板块组合，不自由生成全新复杂布局"。
- **改动**：`app/templates/page.tsx`、`app/workspace/page.tsx`。
- **验收**：用户选 canvas 前知道能力边界，不产生"能自由画布局"的误解。

### P1-6. 生成进度强化（#7）
- **现状**：已并行 + SSE 阶段（理解→匹配→并行生成→保存）。缺"每批板块完成打勾 + 总耗时"。
- **方案**：generating 视图的步骤条补**板块级进度**（如"首屏 ✓ / 关于 ✓ / 产品生成中…"），完成后显示总耗时。
- **改动**：`app/generate/page.tsx` generating 视图 + SSE status 细分。
- **验收**：生成期间用户能看到哪些板块已完成、哪些进行中，而非笼统一条。

### P1-7. 切换模板/板块的即时反馈强化（#3）
- **现状**：generate 确认页已用 `SiteRenderer` `key={template.id}` 本地即时重渲染（切模板/板块立即变），但**过渡生硬、无选中态强化**，用户切换后视觉"跳变"而不是"平滑过渡"，感知不够直观。
- **方案**：
  - **模板切换**：加淡入过渡（如 120ms fade/slide），让"旧模板 → 新模板"有视觉承接；当前选中模板卡片/下拉有明确高亮态。
  - **板块切换**：已有"预览区对应 section 高亮闪烁"（P0-3），此处补齐"隐藏板块在预览里淡出消失"，而非瞬间消失。
- **改动**：`app/generate/page.tsx`（模板切换过渡 + 选中态）、`globals.css`（fade/slide keyframe + 淡出）。
- **验收**：切换模板后预览平滑过渡而非生硬跳变；隐藏板块淡出；选中模板有明显高亮。

### P1-8. 确认页结构近似预览如实声明（补充4）
- **现状**：generate 确认页副标题已写"本地结构预览 · 不依赖官方演示站"，但**没说明它和最终外部模板有视觉差异**——用户可能以为看到的就是最终样子。
- **方案**：副标题补一句明确差异："**本地结构近似预览**：反映板块与内容布局，最终视觉以模板正式版为准（风格变体/细节可能存在差异）"。若实现 P0-1 的预览降级，工作区降级时也用同一句。
- **改动**：`app/generate/page.tsx` 确认页副标题文案。
- **验收**：用户首次看到确认页，能明白"这是近似预览，不是最终 1:1 效果"，不产生"所见即最终"的误解。

---

## 二、验证命令

```bash
cd D:/sitecraft-ai
npm test          # 预期 100/100
npm run typecheck
npm run build
# 服务（需 Docker Postgres 先起）：nohup npm run start &
```

## 三、验收清单（Codex 视觉部分）

| # | 验收项 | 方法 |
|---|--------|------|
| 1 | 板块开关点击有视觉差异 + 预览联动 | 浏览器操作 generate 确认页截图 |
| 2 | 工作区第三方 429 时降级不白屏 | 改 demoUrl 模拟，截图 |
| 3 | 模板切换平滑过渡 + 选中态明显 + 隐藏板块淡出 | 切换模板/板块截图对比 |
| 4 | 生成文案不再误导 | 读生成页文案 |
| 5 | designTokens 三档 × 3 模板覆盖完整 | 截图比对 |
| 6 | canvas 边界声明可见 | templates 页截图 |
| 7 | 生成进度分板块 + 耗时 | 真实生成截图 |
| 8 | 确认页标注"结构近似预览，非最终 1:1" | 读确认页副标题 |
