# 模板预览与生成体验优化

- 日期：2026-09-01
- 场景：一句话建站的推荐模板预览不稳定、上游演示站可能返回 429、模板与自由设计边界不清、内容生成等待时间长且反馈不足
- 方向：产品体验 / 前端架构
- 置信度：8
- 层级：复合
- 状态：已落地
- 复用量：2
- 来源：[Duda Template Chooser](https://developer.duda.co/docs/building-a-template-chooser)、[Sanity Section Builder](https://github.com/maciejtrzcinski/sanity-plugin-section-builder)、[Career Pilot template gallery issue](https://github.com/anurag3407/career-pilot/issues/1104)

## 问题

模板卡片和确认页如果依赖第三方官方演示，会受到限流、超时和 DOM 变化影响；用户切换模板或板块时也难以确认操作是否生效。另一方面，产品把“复用模板结构并填充内容”描述成“从零生成网站”，会造成能力预期偏差。生成过程原本缺少板块级进度，等待感明显。

## 借鉴方案

从模板选择器和 section builder 的成熟做法中提炼三条：模板选择阶段优先提供稳定、可比较的本地预览；板块采用受控组合与明确状态反馈；外部预览失败时显示可工作的降级内容和边界说明，而不是空白或把第三方错误直接留给用户。

落地时保留项目原有的 `SiteRenderer`、草稿操作、SSE 和模板目录架构，没有引入第二套页面生成器。自由设计也被收敛为 design token 与既有板块组合，不允许模型输出任意 HTML/CSS。

## 关键决策

- 模板列表和生成确认页使用本地 `SiteRenderer`，官方演示只由用户主动打开。
- 工作区继续优先使用真实开源模板 iframe；8 秒内没有收到内容应用回执或 iframe 报错时，自动降级为本地结构近似渲染。
- 降级后建立本地可编辑槽位清单，AI 对话不会因第三方预览失败而被禁用。
- 用结构化 `designTokens` 表达颜色、字体气质、圆角和密度，并通过可撤销操作提交，避免任意样式注入。
- `forge`、`atlas`、`signal` 使用不同颜色适配策略；字体、圆角、密度使用共同的保守语义选择器。
- 首屏和其余板块并行请求，合并校验后只提交一次；SSE 持续回传阶段、已完成板块和进行中板块。
- 所有界面文案明确说明“复用模板结构，AI 填充内容”以及本地预览与正式模板的差异。

## 搜索策略

使用的方向词包括 `template chooser local preview official demo fallback`、`section builder controlled sections preview`、`template gallery preview loading error`。官方产品文档适合确认模板选择器的信息组织与预览职责；GitHub 项目和 issue 更适合发现真实的加载失败和用户反馈。只采用与当前 Next.js + 本地模板目录架构匹配的做法，没有照搬特定平台的数据模型。

本轮可用来源为官方文档与公开 GitHub 页面。未把官方演示站的可用性当作方案成立的前提，也没有把未执行的截图比较写成已验证证据。

## 验证记录（证据链）

- 自动化：`npm test` 实际执行 123 项，123 项通过、0 失败；覆盖设计变量可撤销、并行调用、批次失败策略、真实完成板块和本地预览槽位清单。
- 聚焦验证：生成编排与模板槽位保护共 35 项通过，确认批 B 失败时只报告 `hero` 已完成，本地预览不再声明未渲染字段。
- 静态检查：`npm run typecheck` exit 0；`git diff --check` exit 0。
- 构建：Next.js 16.3.1 生产构建成功，TypeScript、页面数据收集和 12 个静态页面生成均完成。
- 运行时：最新生产构建在 `http://localhost:3000` 启动；`/generate`、`/templates`、`/templates/forge/preview`、`/templates/atlas/preview`、`/templates/signal/preview`、`/templates/canvas/preview`、`/workspace`、`/api/health` 均返回 HTTP 200。
- 内容证据：三个代表模板预览页返回本地模板结构说明；canvas 预览返回受控画布与复杂布局边界说明。
- 未验证范围：按用户要求不做截图验收；开源模板子模块为空，未对官方演示 DOM 做逐模板、逐 token 的视觉比较。

## 落地版

- `app/generate/page.tsx`：本地模板预览、模板/自由设计模式、显隐过渡、板块进度和耗时。
- `app/templates/page.tsx` 与模板预览页：稳定的本地结构预览与独立官方演示入口。
- `components/open-source-template-frame.tsx`、`app/workspace/page.tsx`：预览状态回调、超时降级和可继续编辑的本地槽位能力。
- `lib/template-slot-guard.ts`：本地预览只声明 `SiteRenderer` 真正显示的槽位；降级或 canvas 模式在 revision 更新后直接完成本地同步反馈。
- `lib/design-variants.ts`、`lib/site-document.ts`、`lib/site-operations.ts`：受控设计变量及可撤销草稿操作。
- `app/api/templates/[templateId]/preview/route.ts`：共享 token 注入及三类代表模板适配器。
- `lib/site-generator.ts` 与 generate API：并行内容生成、一次提交和真实 SSE 进度。

## 当前结论

方案已在本项目落地，代码级与构建级验证完成后可作为后续模板体验工作的基线。置信度暂定 8；若未来补齐固定版本的本地模板快照并完成三档 token 的视觉验收，可提升到 9。
