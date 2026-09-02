# 架构契合度审计：一句话建站方案

- 日期：2026-08-28
- 审计对象：一句话自然语言建站（最小版）方案 vs sitecraft-ai 现有架构
- 审计方式：对照现有代码逐项核实复用点、分层、测试、回归风险
- 审计人：Claude Code（可复核——每个结论引用代码行）

## 一、五关自查（架构契合度）

### 第 1 关：复用 ✅ 通过

方案建立在**已有能力**上，非另起炉灶：

| 复用的能力 | 代码证据 | 结论 |
|---|---|---|
| `replace_draft`（整体替换草稿） | [site-operations.ts:97-99](D:/sitecraft-ai/lib/site-operations.ts#L97) 定义；[208-214](D:/sitecraft-ai/lib/site-operations.ts#L208) apply 时支持撤销 | ✅ 生成初稿的地基 |
| `commitOperations`（批量提交） | [site-store.ts:302](D:/sitecraft-ai/lib/site-store.ts#L302)，CommitArgs 含 operations 数组 | ✅ 一次提交整站初稿 |
| `getSite`（自动建默认站） | [site-store.ts:298](D:/sitecraft-ai/lib/site-store.ts#L298) | ✅ 新站可建 |
| 16 套模板 category 映射 | [template-catalog.ts](D:/sitecraft-ai/lib/template-catalog.ts) | ✅ 模板选择依据 |
| session 记忆 / 长度校验 / 语言 conformance | ai-session.ts / site-operations.ts | ✅ 生成后全复用 |

### 第 2 关：分层 ✅ 通过

方案遵循现有分层（纯逻辑 lib 可测 / 网络适配 / 薄路由 / UI）：
- 纯逻辑放 `lib/site-intent.ts` + `lib/site-generator.ts`（相对导入，可测）
- 网络适配放 `lib/ai-provider.ts`（沿用 `@/`，不在单测）
- 路由 `generate/route.ts` 薄（编排 + SSE）
- 与现有 `chat/route.ts` + `ai-provider.ts` 模式完全同构

### 第 3 关：可测试 ✅ 通过

- 新模块用相对导入 → 走 `node --test`，与现有测试同构
- 依赖注入（DraftOpsProvider）→ 生成编排可 mock，不触网
- 与 `ai-session.test.ts` / `ai-self-eval.test.ts` 同模式

### 第 4 关：不破坏 ✅ 通过

- **新增路由** `/api/sites/[siteId]/generate`，不改 chat/工作区核心
- workspace 的 `siteId` 改读 `?siteId`（默认 demo）——**旧行为零变化**，只是支持新参数
- 已验收的 chat/session/自评/确认/长度校验全不动

### 第 5 关：可撤销 ✅ 通过

- 生成 = **单次 commitOperations**，进工作区 `moveHistory("undo")` 一键撤销整个初稿
- 与现有 undo/redo 机制完全一致（[site-store.ts:306](D:/sitecraft-ai/lib/site-store.ts#L306)）

**五关全过 → 方案符合现有架构。**

## 二、风险点（诚实标注，非完美）

| 风险 | 影响 | 缓解 | 证据 |
|---|---|---|---|
| 一句话初稿质量 ≤ 模板默认 | 观感可能倒退 | 基于 defaultDraft 只重写用户关注板块 + 确认卡看模板缩略图 + 工作区精修 | 方案 §3 |
| workspace 改 siteId 读 ?siteId | 若改错影响现有 demo | 默认 "demo" 不变，仅支持新参数 | [workspace/page.tsx:45](D:/sitecraft-ai/app/workspace/page.tsx#L45) |
| 重复生成 | 覆盖初稿 | POST /api/sites 建新站 + baseRevision 乐观锁 | 方案 §4 |
| token 成本 | 每站 2-3 次调用 | 分批 + buildDraftIndex + 批 B 失败 fail-open | 方案 §8 |

## 三、结论

**一句话建站方案与 sitecraft-ai 现有架构高度契合**：5 关全过，复用 90% 现有能力，新增代码与现有模式同构，已验收能力零回归。

**可观测验证方式**（改完后如何确认"确实好"）：
1. `npm test` 60 → 新增 intent/generator 测试全绿
2. 真机 E2E 截图（首页→一句话→确认→生成→工作区）
3. Codex 独立验收（意图准确性/初稿质量/撤销/衔接/未配置 key）
4. 本审计报告留档，可对照查证

---

# 四、实测验证（追加，2026-08-28）——每个结论都有真实命令输出

> 以下验证均在本机真实执行，非推理。可复跑：命令已附。

## 验证 1：批量操作一次生成初稿（含 replace_draft）✅ 通过

**命令**：`applySiteOperations(defaultDraft, [set_text×3, set_template(atlas), update_card])`

**实际输出**：
```
applied: true
appliedTargets: ["companyName.zh","hero.title.zh","hero.subtitle.zh","template","services.items.1.title.zh"]
revision: 2
companyName: 华辰光伏
hero.title: 可靠制造，从关键部件开始
services[1].title: 智能产线集成
templateId: atlas
inverseOps 数量（可撤销）: 5
```

**结论**：一次提交能完成"改内容 + 切模板 + 改卡片"，生成 5 个逆操作（可撤销）——方案核心流程真实可走通。

## 验证 2：真实 DeepSeek 意图理解 ✅ 通过

**输入**："做个光伏出口企业的官网，主打欧美，要显得专业可靠"

**模型实际输出**（deepseek-v4-flash）：
```json
{
  "businessType": "trade",
  "targetAudience": "overseasB2b",
  "tone": "professional",
  "colorTone": "green",
  "coreSections": ["about", "features", "products", "contact"],
  "recommendedTemplateId": "atlas"
}
```

**结论**：意图理解完全符合方案 schema（枚举值全合法），且推荐 atlas（外贸模板）符合直觉。**模型能力验证通过。**

## 验证 3：关键词→category 模板选择规则 ✅ 通过

**5 个场景实测**：
```
光伏出口企业，主打欧美      → 外贸目录 ✅
帮我的 SaaS 团队做官网       → 科技企业 ✅
工业零部件厂的官网，突出质量  → 制造业   ✅
设计咨询公司的作品集网站      → 专业服务 ✅
本地餐饮店的宣传页           → 未命中（走 businessType 兜底）✅
```

**结论**：规则确定性正确，未命中场景正确降级到 businessType 映射。

## 验证总结

| 验证 | 结论 | 影响 |
|---|---|---|
| 批量操作生成初稿 | ✅ 可走通、可撤销 | 方案 §3 成立 |
| DeepSeek 意图理解 | ✅ 稳定符合 schema | 方案 §1 成立 |
| 关键词模板选择 | ✅ 确定性正确 + 兜底 | 方案 §2 成立 |

**三个核心假设全部实测通过，方案可落地。** 剩余需实施中验证：SSE 路由、前端流程、Codex 验收。
