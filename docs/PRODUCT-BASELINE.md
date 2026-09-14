# 产品基线（PRODUCT-BASELINE）

> **本文件是三条建站链路与现有信息架构的唯一权威基线。**
> 与旧文档冲突时，**以本文件为准**；本文每个论断都带 `file:line` 证据，可复核。
>
> 基线日期：2026-09-12 · 依据：代码实读 + 真机走查
> 取代：[`plans/2026-09-10-screenshot-to-template-design.md`](plans/2026-09-10-screenshot-to-template-design.md)、
> [`plans/2026-09-11-composer-handoff.md`](plans/2026-09-11-composer-handoff.md)、
> [`plans/2026-09-10-three-directions-execution.md`](plans/2026-09-10-three-directions-execution.md)

---

## 一、产品定义

本产品 = durable.com + wegic.ai 两家能力的融合自助 SaaS。

**三个建站入口都是设计内能力**：

| # | 入口 | 实现路线 | 产出 |
|---|---|---|---|
| ① | **自然语言建站** | 22 个真实开源模板原件 + **适配器注入**（`lib/site-generator.ts` → `lib/template-slot-injection.ts`） | 真模板站，槽位由适配器决定 |
| ② | **截图转模板** | 模型出 DSL → **确定性拼装器**（`lib/template-from-screenshot.ts:315` → `lib/template-composer.ts:683`） | 自建模板，13–26 槽位 |
| ③ | **链接(URL)转模板** | 两种模式：`static` 原样搬运 / `rebuild` 复刻（复用 ② 的链路） | 见 §三 |

**产出统一锚定 22 个真实开源模板原件（适配器路线）。**
`template-composer` 拼装器**只服务截图/URL 链路**，**永不进 NL 主链**。

首批用户：制造业/外贸中小企业 + 国内小微。楔子是「中文业务 → 地道英文站」与「一句话到底」。

---

## 二、实测确认的现状（别重新发明，也别推翻）

- **首页是工作台式管理页**（侧边导航 + 最近站点 + 「开始一个新项目」CTA），
  **不是营销落地页，也不是单文本框**——信息架构清晰，不动。
- **`/generate` 是 STEP 01/03 三步向导**：textarea + 预填示例 chip
  （`app/generate/page.tsx:870`）+ 可折叠「粘贴公司简介」区。
  小白不会写 prompt 的问题**已由 chip 解决**，**不要改成三格表单**。
- **模板库「做新模板」弹窗质量已达标**：双 tab、用户语言文案
  （「复刻成新模板」`components/create-template-dialog.tsx:269` /
  「原样搬下来」`:274`）、版权提示（`:280`）、断点续做。
- **生成链路已是 SSE**。前端**逐 chunk 实时消费**（不是一次性刷新）：
  `app/generate/page.tsx:620-642` 在 `while` 读循环内、每个 chunk 调 12 个 setter
  （`setProgressText` / `setGenerationPhase` / `setCompletedSections` /
  `setActiveSections` / `setRecoveringSections` / `setFailedSections`）。
  进度**已渲染**：`:935`、`:986`、`:1219` 的 `{busy ? progressText : …}`、
  `:1229-1237` 的 `generationPhase` 驱动 building preview + saving shimmer、
  `:260-263` 的阶段态。
  → **真实差距是文案叙事感**（缺 Wegic 那种"正在读你发的图…"的分步人话），
  **不是"没有流式"**。⚠️ 旧走查记录曾误判为"实时呈现不存在"，此处已更正。
- **弹窗等待态是裸 spinner**（`components/create-template-dialog.tsx:309-311`），
  而后端 `lib/pending-job.ts` 已有步骤语义：
  `advanceJob`(`:108`) / `describeJob`(`:194`) / `jobProgress`(`:206`)，
  **前端一个都没用**——「能力已实现但没接上」。
- **板块级再生成已实现**（旧记录误判为"待新建"，此处已更正）：
  `app/workspace/page.tsx:193` 状态 · `:1263-1270` 的
  `重生成此板块` 按钮（选中预览槽位后出现）· `:502-550` 完整提交链
  （调 generate 的 `regenerate` step + SSE 进度 + 刷新草稿）· `:1497-1514` 弹窗。
  **形态是工具栏按钮，不是 iframe 内悬浮菜单**——功能等价且更稳（不依赖往渲染页注入 UI）。
- **e2e**：`templates.spec.ts:14/23` 断言过严（期望 22 实得 35，**运行时沉淀模板**所致），本轮修。
- **巨型文件军规生效中**：`app/workspace/page.tsx`(87.9KB)、`app/generate/page.tsx`(71.7KB)
  拒收新代码——**先拆后写**。

---

## 三、链接(URL)转模板：能力边界（代码已定死）

`components/create-template-dialog.tsx:59` 有 `urlMode: "static" | "rebuild"`，
`:145` 调 `from-url`、`:147` 调 `from-screenshot`。**默认值是 `"rebuild"`（复刻）**。

| 模式 | 保真度 | 可编辑 | AI 推荐 |
|---|---|---|---|
| `static` 原样搬站 | **高** | **最多 3 个位** | ❌ `isolated` |
| `rebuild` 复刻（默认） | 中（大致像） | 13–26 槽位 | ✅ |

**为什么搬站只能改三个位**——`lib/template-slot-injection.ts:57-77` 的 `INJECTION_RULES`
只有三条：`hero.title`(`<h1>`) / `contact.email`(`mailto:`) / `contact.phone`(`tel:`)。
集合槽**刻意不猜**（`:170-171`「挑错容器会让编辑与统计都落在错误节点上」），
而 `MINIMUM_EDITABLE_SLOTS`(`:109`) 要求四个槽 → 搬来的站必然缺后三个。

代码对用户就是这么说的（`lib/template-from-url.ts:174` 原文）：

> 其余内容改不了。想要能改的站请改用「截图生成模板」。

另有 `from-url/route.ts:105` 传 `skipQualityGate: true` → manifest 标
`recommendation: "isolated"` → **搬站产出永不进 AI 推荐**。

> ⚠️ **待拍板**：「搬站产出不能进 AI 推荐 / 无下游」是设计意图还是想改的行为。
> 本轮不动，见计划「需用户拍板」。

---

## 四、明确不模仿

- **Durable 产出同质化**——我们用 22 真实模板原件正是为避开，**不回填**；
- **Wegic 整页重生成**——增量 operations 模型是对的，**不换位**；
- **推倒现有首页/向导/弹窗结构**——实测已达标，本轮是**补流式体验，不是重做 IA**。

---

## 五、被本文取代的旧论断（逐条给原文位置）

| # | 旧论断 | 位置 | 本文件的结论 |
|---|---|---|---|
| 1 | 「**模型根据截图产出 HTML**」 | `screenshot-to-template-design.md` 决策 1 | **作废**。改为「模型只出 DSL，拼装器确定性产 HTML」——实测：开推理 16000 tokens / 槽位 **0 个**；关推理 9.2 秒 / 槽位 **23 个** |
| 2 | 「不调 `POST /api/templates/runtime`」 | 同上 §4.9 | **作废**。实际统一走该入口（composer §5；其 §12 风险 5 自认偏离） |
| 3 | 「SVG XSS 一起修」 | 同上 §4.10.3 | **作废**。改为非目标（composer §2），缓解：`accept` 只允许 png/jpeg/webp |
| 4 | 「静态区协议解决 A1」 | 同上 §4.5 | **以 §4.5.2 自我修正为准**：A1 真因在生成端 `hiddenSections`，不在注入端 |
| 5 | 「网址输入」在设计文档中缺失 | execution 标题 vs 设计 §4.1 | **本文件 §一/§三 补上** |
| 6 | 测试基线 497 / 514 | execution §七 / composer §1 | 时间先后，**以当日实际为准** |
| 7 | 三份文档的 ⏳ 标记 | execution §六 | **已过期**：阶段 A/C 已完成；A1/A2/A3 已在契约治理中修掉 |

---

## 六、纪律

本文件的任何修改都必须**先出方案等批准**。三条链路的红线见
[`AGENTS.md`](../AGENTS.md) 的「契约军规」11 条，逐条承接，不重复。
