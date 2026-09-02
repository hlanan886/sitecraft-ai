# 给 Codex 的交叉验证任务：sitecraft-ai 一句话建站 · 边界加固验证

## 你的任务

对 D:/sitecraft-ai 分支 feat/nl-site-generation 上最近一次提交的「自然语言边界加固」改动做交叉验证。**不要修复任何代码**，只验证改动是否真实、完整、无回归，输出验证报告。发现任何不符合下述描述的情况，逐条列出（含文件、行号、证据）。

## 背景

一句话自然语言建站：用户输入一句话 → 意图理解 → 模板匹配 → 整站初稿 → 工作区精修。本次提交针对 17 项边界测试清单中的 7 个能力缺口做了加固：

1. **#7 目标过模糊** → 现在应追问（need_info），不再瞎猜
2. **#9/#10 越界/违规请求** → 现在应拒答（rejected + rejectionReason）
3. **#5 风格冲突** → 现在应识别矛盾（追问给选项 或 ready+conflicts）
4. **#6 模板能力外要求** → 现在应标 limits 带替代建议
5. **#8 只给品类** → 应默认值标注或追问，不瞎猜
6. **#12 语言漂移** → 站点语言跟随输入语言
7. **#16/#17 超长/纯表情** → 前端 maxLength + 服务端拦截

## 声称的改动（请逐条核实）

### 1. `lib/site-intent.ts`
- `INTENT_STATUSES = ["ready","need_info","rejected"]`、`IntentResponse` 类型
- `createSiteIntentResponseSchema`：`siteIntentSchema.partial()` + 新字段（notices/needsInfo/conflicts/limits/rejectionReason，均有 max/default）+ superRefine（rejected 必须有 rejectionReason；ready 时核心字段必须过 siteIntentSchema 完整校验）
- `parseSiteIntentContent` 改用新 schema（旧格式缺省 ready）
- `toReadyIntent(resp)`：ready 时收紧为严格 SiteIntent
- `buildIntentPrompt` 重写：6 条判定规则（拒绝→追问→矛盾→能力边界→默认值标注→语言/防注入）+ 4 个输出示例（ready/默认值/need_info/rejected）；规则 4 强制"无论 ready 还是 need_info 只要检测到能力外要求就必须写 limits"；规则 6"回复语言与输入一致、站点内容跟随输入语言"
- **验收点**：规则 4 和规则 6 的措辞是否正确传达上述语义

### 2. `lib/ai-provider.ts`
- `requestSiteIntent` 新增 `history?: Array<{role, text}>`，拼进 messages 中间层（system → history → user）
- `max_tokens` 1000→1500；超时 30s→45s
- 对话链路 system prompt（约 L136）新增："站点内容保持当前语言（中文站用中文，英文站用英文），除非用户明确要求切换语言"
- **验收点**：history 注入位置是否正确（不得改变 system 优先级）；超时/重试逻辑未被破坏

### 3. `app/api/sites/[siteId]/generate/route.ts`
- `messageField`：`.refine` 拦纯表情（`\p{Extended_Pictographic}`），analyze 和 execute 共用
- analyze 分支：`history` 透传（max 6）；`resp.status !== "ready"` 时直接回 SSE done（intent 原样）；ready 时 `toReadyIntent` 收紧 + `resolveTemplate`（历史用户文本+当前文本拼接）
- execute 分支：`intent: siteIntentSchema` 不变（新字段被 zod strip）
- **验收点**：SSE 事件流（status/done）格式未破坏；execute 分支对带新字段的 intent 是否兼容

### 4. `app/generate/page.tsx`
- Step 加 `"clarify"`；`clarifyState{needsInfo, history}` + `clarifyText`
- analyze 分支三态：need_info → 存 history 进 clarify；rejected → error 横幅回 input；ready → confirm
- clarify UI：问题列表 + textarea(maxLength 400 + 计数) + 「返回修改」「继续理解」；3 轮上限 → "按默认值继续生成"
- input textarea maxLength 400 + 计数；点击校验纯表情给友好提示
- confirm 页提示条（notices/conflicts/limits）
- **验收点**：状态机流转正确（input→clarify→confirm 或 input→confirm）；busy 状态串行化未被破坏

### 5. `tests/site-intent.test.ts`
- 现有 13 例零改动；新增 8 例（旧格式兼容/need_info 放宽/rejected 缺原因/rejected 带原因/ready 核心坏/toReadyIntent/prompt 边界指令/prompt 三态示例）
- **验收点**：新增测试与声称的 schema 行为一致；没有改动现有测试来迁就新实现

### 6. `scripts/verify-intent-clarify.mjs`
- 真机验证脚本：10 用例（#9/#10/#7/#5/#6/#8/#12/#7c/#16/#17），自动重试（无 done 或 error done 时重试，最多 2 次）
- **验收点**：脚本逻辑能区分"模型偶发失败"与"真实 bug"

## 验证命令（按顺序）

```bash
cd D:/sitecraft-ai
npm test                 # 预期 94/94 全绿
npm run typecheck        # 预期无错误
npm run build            # 预期构建成功
```

## 真机验证（可选，需服务在跑）

```bash
# 服务已在 localhost:3000（最新 build）
node scripts/verify-intent-clarify.mjs   # 预期 10/10 通过
```

## 输出格式

```
## 验证结果
1. 代码改动与描述一致性：逐文件 ✅/❌（不符处给行号+实际代码）
2. 测试覆盖：94/94？新增 8 例是否真实覆盖所声称行为
3. 回归风险：现有 13 例是否被改动；对话链路（chat）是否受影响
4. 真机验证：10 用例结果
5. 潜在问题：你发现的任何遗漏/缺陷/安全隐患
6. 结论：改动是否可信、可合并
```
