# AI Site Generation Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让自然语言建站在单个模型请求、板块或模板异常时仍能在有限时间内交付可编辑的部分站点，并让用户看到真实板块进展。

**Architecture:** 保留当前 `SiteDraft`、结构化操作、revision 单次提交和 SSE Route Handler。正常路径继续使用首屏批 A 与板块批 B 并行；异常路径在编排层通过可取消的硬超时结束等待，并将批 B 降级为逐板块隔离恢复。前端消费结构化板块状态，最终以完整、部分完成或明确失败三种终态收口。

**Tech Stack:** Next.js 16.3.1 App Router、React 19、TypeScript、zod、Web Streams/SSE、node:test。

## Global Constraints

- 目标用户是企业老板、外贸业务员等非技术用户；正常生成目标约 30 秒。
- 成功率和速度优先于最少模型调用次数；异常时允许逐板块追加调用。
- 首屏或部分板块可用时先创建网站，缺失板块进入工作台补全。
- 模板异常允许切换到兼容模板，但必须向用户说明切换原因。
- 不生成任意 HTML/CSS；继续使用模板结构、白名单操作和 design tokens。
- 不引入第二套生成器，不破坏现有草稿 revision、撤销历史和一次提交语义。
- 不自动提交 Git；当前工作区含用户未提交修改。

---

### Task 1: 有限时间生成与板块失败隔离

**Files:**
- Modify: `lib/site-generator.ts`
- Modify: `lib/ai-provider.ts`
- Test: `tests/site-generator.test.ts`

**Interfaces:**
- `DraftOpsProvider` 新增可选 `signal?: AbortSignal`。
- `GenerateDraftArgs` 新增可调的主批次、恢复批次和自评超时，仅由运行时使用；测试传入短时间预算验证真实行为。
- `GenerateDraftOutcome.missingSections` 精确返回失败板块，不再把整个批 B 一概标记缺失。

- [x] **Step 1: 写入“一个板块永不返回，其他板块仍完成”的失败测试**
- [x] **Step 2: 运行测试并确认唯一新增用例失败于 `hung`**
- [x] **Step 3: 实现可取消的任务截止函数**

```ts
async function runDraftTask(
  task: (signal: AbortSignal) => Promise<DraftOpsResult>,
  timeoutMs: number,
): Promise<DraftOpsResult>
```

- [x] **Step 4: 正常批 B 失败后，按 `plan.scope.sections` 并行恢复，每个板块独立结算**
- [x] **Step 5: 给自评增加 fail-open 截止时间，禁止质检拖住保存**
- [x] **Step 6: 运行生成器测试，确认红灯变绿且原有行为不回归**

### Task 2: SSE 终态与真实板块状态

**Files:**
- Modify: `app/api/sites/[siteId]/generate/route.ts`
- Modify: `lib/site-generator.ts`
- Test: `tests/site-generator.test.ts`

**Interfaces:**
- `GenerationProgress` 增加 `failedSections` 与稳定的 `activeSections`；失败板块不再保持旋转。
- Route Handler 继续使用 `ReadableStream`，所有预期失败通过 `done` 事件表达；流开始后不尝试修改 HTTP 状态码。

- [x] **Step 1: 写失败测试，证明超时板块会离开 active 并进入 failed**
- [x] **Step 2: 写失败测试，证明抛异常的 provider 被转换为可恢复结果**
- [x] **Step 3: 实现状态集合并确保每条异常路径发送终态事件**
- [x] **Step 4: 运行聚焦测试**

### Task 3: 部分成功交付与可感知生成页面

**Files:**
- Modify: `app/generate/page.tsx`
- Modify: `app/globals.css`
- Test: `tests/site-generator.test.ts`

**Interfaces:**
- 客户端板块状态为 `waiting | active | done | recovering | failed`，由服务端事件驱动，不用定时器伪造百分比。
- 部分完成后跳转工作台并保留 `partial=1`；页面明确列出需要补全的板块。

- [x] **Step 1: 将生成卡片从二元 active/done 改为五态展示**
- [x] **Step 2: 增加已用时间、恢复提示和失败终态，保持容器尺寸稳定**
- [x] **Step 3: 首屏完成后显示可继续交付的真实状态，不让其他板块覆盖首屏成功**
- [x] **Step 4: 用桌面与移动端运行生成流程视觉验收**

### Task 4: 模板兼容降级与任务恢复

**Files:**
- Modify: `app/api/sites/[siteId]/generate/route.ts`
- Modify: `app/generate/page.tsx`
- Modify: `lib/site-generator.ts`
- Test: `tests/site-generator.test.ts`

**Interfaces:**
- 模板切换只使用 `templateCatalog` 中存在的兼容模板；返回 `requestedTemplateId`、`appliedTemplateId` 和原因。
- 刷新恢复以站点草稿和服务端已提交 revision 为准，不在浏览器保存完整生成内容。

- [x] **Step 1: 写模板不存在或不兼容时选择稳定模板的失败测试**
- [x] **Step 2: 实现显式模板降级结果，不静默修改用户选择**
- [x] **Step 3: 刷新时读取已创建站点草稿；已存在部分结果时直接进入工作台**
- [x] **Step 4: 运行全量测试、类型检查、生产构建和生成页交互验收**

## Acceptance

- 永不结束的板块不能让生成 Promise 永不结算。
- 成功板块被保存；缺失板块精确列出并可在工作台补全。
- 失败板块不会继续显示旋转；SSE 一定出现 `done` 终态。
- 正常路径不增加模型调用；只有批次异常才逐板块恢复。
- `node --test --test-isolation=none --experimental-strip-types tests/*.test.ts`、`npm run typecheck`、`npm run build` 均以退出码 0 完成。
- `/generate` 桌面与移动端无框架错误层、无相关控制台错误、状态不重叠且目标交互可完成。
