# sitecraft-ai 一句话建站 · Codex 任务（执行人 B）

## 你的任务范围（只做这些，别的不用碰）

你在 D:/sitecraft-ai 做**视觉/交互/探测类**任务，分两块：

- **块 1：装 Playwright + 写自动探测脚本**（第一~四步）——模拟真人找 bug 的探测式测试，发现即修。
- **块 2：设计协调视觉验收 + UI 视觉精修**（第七步 B 段）——新增质量功能需要眼睛看的部分。

**边界（重要，避免和另一个执行人重复）**：
- **另一个执行人（Claude）负责逻辑类**：事实校验/结构检测/存证表/导入/引导的**逻辑实现** + 对应单测。你**不写这些的逻辑**，也**不重复写它们的单测**。
- 你的探测脚本 = 测**现有行为**的交互合理性（空输入、快速连点、撤销重做等）。**不改现有逻辑去迁就脚本**。
- 你只负责自己新增/改动的文件；涉及 generate 页、site-generator 等共同文件时，改动前先确认对方是否在改，避免冲突。

## 块 1：装 Playwright + 探测脚本（第一~四步）

在 D:/sitecraft-ai 装 Playwright，写一套**模拟真人找 bug 的自动探测脚本**（探测式测试）。装完、写完后跑通，交付用法说明。

**工作流**：脚本发现 bug → **你先上网搜业界最佳实践** → 结合项目实际选方案 → **修复它** → 加回归测试 → 复跑验证。**不是只找不修**——发现的问题要解决，且解决方式要贴合本项目架构、借鉴已验证的成功方案，不自创偏门解法。

## 环境（已核实）

- Node v24，Windows，Git Bash。项目 `package.json` 无 `@playwright/test`，`test` 脚本是 `node --test --experimental-strip-types tests/*.test.ts`（单测 **138/138 全绿**，**不要动它**）
- 生产模式运行（dev 有 Turbopack EPERM bug）：`npm run build && npm run start`
- Docker Postgres 在跑（`sitecraft-ai-postgres-1`，5432）；`.env.local` 有 `SITE_STORE=postgres` + `DEEPSEEK_API_KEY`（生产模式强制 Postgres store）
- 端口 3000 被占，E2E 一律用 **3210**
- 前端 SSE 解析：`readSseEvents` 按 `data: {...}\n\n` 分割（generate/page.tsx:86、workspace:122）——**mock SSE 必须用该格式**
- 模板：16 个开源模板（canvas 自由设计已删除），分类 制造业1/外贸2/科技6/专业服务7
- 关键 selector：输入框 `.generate-textarea`、主按钮 `.generate-input .primary-button`、确认页 `.generate-confirm`、板块开关 `.generate-toggle`、澄清 `.generate-clarify-list`、字符计数 `.generate-char-count`、错误 `.generate-error`
- **已新增（不要重复做）**：`lib/fact-check.ts`（事实校验）、`lib/structure-check.ts`（结构检测）、`lib/generation-record.ts` + `/api/generation-records`（存证）、generate 页导入 textarea（`.generate-import`）、工作台引导条（`.generate-guide-note`，触发 `?generated=1`）

## 第一步：安装

```bash
cd /d/sitecraft-ai
npm i -D @playwright/test
npx playwright install chromium
```
Git Bash 下若 `npx` 报 EPERM，用 `./node_modules/.bin/playwright install chromium`。代理下载失败设 `export PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright` 再装。

## 第二步：配置

### package.json 追加 scripts（原 test 不动）
```jsonc
"test:e2e": "playwright test",
"test:e2e:headed": "playwright test --headed",
"test:e2e:report": "playwright show-report",
"test:e2e:real": "node e2e/scripts/run-real.mjs",
"e2e:install": "playwright install chromium"
```

### playwright.config.ts（根目录）
- `testDir: "./e2e"`、`testMatch: "**/*.spec.ts"`（与 tests/*.test.ts 隔离）
- `fullyParallel: false, workers: 1`（串行：共享 DB + 避免竞争）
- `timeout: 60_000, expect: { timeout: 15_000 }`
- `outputDir: "test-results"`
- reporter: `["list"]` + html（outputFolder `playwright-report`, open "never"）+ json（outputFile `test-results/results.json`，给 Codex 程序化读结果）
- `use: { baseURL: "http://127.0.0.1:3210", trace: "retain-on-failure", screenshot: "only-on-failure" }`
- `globalSetup: "./e2e/global-setup.ts"`
- webServer: `command: "node e2e/scripts/serve.mjs"`, `url: "http://127.0.0.1:3210/"`, `timeout: 300_000`, `reuseExistingServer: !process.env.CI`, `env: { ...process.env, PORT: "3210" }`
- projects: chromium Desktop Chrome

### tsconfig.json
exclude 加 `"e2e"` 和 `"playwright.config.ts"`（否则 next build 会类型检查 e2e）。另建 `e2e/tsconfig.json`（extends 根，`compilerOptions.types: ["@playwright/test"]`）仅供编辑器。

### .gitignore 追加
`test-results/`、`playwright-report/`、`e2e/.cache/`

## 第三步：基础设施（新建 e2e/）

### e2e/scripts/serve.mjs（webServer，自包含可复现）
1. 探测 5432：不通则 `docker compose up -d postgres` + 轮询就绪；`E2E_SKIP_DOCKER=1` 跳过
2. 探测 `.next/BUILD_ID` 是否比源码新：`E2E_FORCE_BUILD=1` 强制重 build，否则存在且较新则跳过（加速迭代）
3. spawn `next start -p 3210`（用 `process.execPath` + 绝对路径，规避 Windows shell wrapper），转发信号并保持存活

### e2e/scripts/run-real.mjs
Node 设 `E2E_REAL_AI=1` 后 spawn `playwright test --grep @real`（跨 shell 设环境变量）

### e2e/global-setup.ts
幂等校验（首页可达、5432、容器名），必要时 demo 站点 PUT replace_draft 重置干净

### e2e/helpers/mock-ai.ts（全方案确定性基础）
- `sseBody(events)`：`events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("")`
- `readyIntent(over)`：满足 siteIntentSchema 的完整对象（businessType/companyName/industry/targetAudience/tone/colorTone/coreSections/recommendedTemplateId/summary/status:"ready"）
- `mockAnalyze(page, { onMessage })`：`page.route("**/api/sites/demo/generate")`，body.step 非 "analyze" 就 route.fallback()；按 message 返回 ready/need_info/rejected 三种 SSE 事件
- 三态事件形状：
  - ready：`[{type:"status"...},{type:"done",status:"ready",intent:readyIntent(),siteLanguage:"zh",template:{id:"forge",name:"...",category:"制造业",reason:"..."},hiddenSections:[]}]`
  - need_info：`{...readyIntent(), status:"need_info", needsInfo:[...]}`
  - rejected：`{...readyIntent(), status:"rejected", rejectionReason:"..."}`
  - **注意：服务端 `done.status` 恒为 "ready"，业务决策在 `done.intent.status`**（route.ts 90-94）
- execute 完成事件极简：`[{type:"status"...},{type:"done",status:"applied"}]`
- `mockChat(page, siteId, { onDone })`：拦截 `**/api/sites/${siteId}/chat`，二次确认（body.confirmedDestructive）走 applied 分支

### e2e/helpers/api.ts
`createSite`/`getDraft`/`putManualOps`（PUT draft source:"manual" 造 history）/`healthWait`

### e2e/helpers/ui.ts
- `analyzeAndConfirm(page, message, { mayClarify })`：goto /generate → fill → click 主按钮 → 若 clarify 可见则补充 → expect `.generate-confirm` 可见
- `waitForStep(page, step)`：轮询 eyebrow 文本
- `expectNoCrash(page)`：body 非空、无 React 错误覆盖层、无 "Application error" 文本
- `watchPageErrors(page)`：page.on('pageerror') 收集，测试尾断言为空
- `snap(page, name, testInfo)`：截图 attach 进 report + 落盘 test-results/steps/

### e2e/helpers/fixtures.ts
`demoSite` fixture：`request.post("/api/sites", { name: e2e-${Date.now()}, templateId:"forge", locales:["zh","en"] })` → 返回 id（每测试独立站点）

### e2e/README.md（给 Codex 用法）
装/起 DB/跑法/看 report/读 results.json/@real 开关/失败定位

## 第四步：探测脚本（怀疑清单 A-E）

### e2e/specs/generate-flow.spec.ts（A 一句话建站全流程）
用 `mockAnalyze`（不碰真实 AI）：
1. 空输入 → 点按钮 → `.generate-error` 显示"请输入文字描述…"、URL 不变、按钮重新 enabled
2. 纯 emoji `😀😀😀` / 纯标点 `!!!` → 同上友好提示
3. 500 字超长 → fill 绕过 maxLength → 观察 `.generate-char-count`（越界即 bug 候选）→ 提交后不白屏、服务端 400 友好错误
4. 中英混杂/错别字/口语化 → mock 返回 ready → 进 confirm
5. 模糊需求 → mock 返回 need_info → 澄清页可见
6. 越界 → mock 返回 rejected → error 显示 rejectionReason、停留 input
7. 换模板后切板块 → mock ready → 切板块 → 状态不混乱
8. 快速连点生成 → `Promise.all([btn.click()×3])` + mock 计数 → 断言 execute/create-site 请求只 1 次
9. 生成中刷新 → mock execute 慢返回 → reload → 断言无崩溃（数据保持与否是观察项）
10. 导入入口：`.generate-import` 粘贴文本 → 提交 → 断言 analyze 请求带 `extraContext`

### e2e/specs/confirm-flow.spec.ts（B 确认页）
1. 全隐藏板块 → mock ready → 隐藏所有 → 生成 → 断言结果符合预期
2. 全显示 → 正常
3. 切模板后意图摘要是否还匹配（观察记录）

### e2e/specs/workspace.spec.ts（C 工作台）
1. 同槽位 5 连改 → 每次 mockChat applied → 断言状态一致、预览同步
2. 对话换模板 → 断言二次确认弹窗出现
3. 撤销/重做 → **用真实 PUT draft 造 3 条 history**（不用 mock chat）→ 点 UI 撤销/重做 → 断言 revision、history 行数、disabled 态
4. 中英切换语言漂移 → mockChat 只改对应 locale → GET draft 断言另一语言字段未动
5. 预览加载失败 → route.abort preview → 断言不白屏
6. 引导条：访问 `/workspace?siteId=X&generated=1` → `.generate-guide-note` 可见 → 关闭后消失

### e2e/specs/templates.spec.ts（D 模板选择）
1. 分类筛选 → 断言卡片数 1/2/6/7/16
2. 预览图渲染（SiteRenderer 本地，无 429）
3. 快速切分类 → 不卡顿错乱
4. preview 路由 429 → route.abort → 断言 fallback（不白屏）

### e2e/specs/global-checks.spec.ts（E 全局）
1. 未配 key → 断言明确提示不崩溃
2. 断网 → route.abort → 友好错误
3. 重复提交 → 防重复
4. 按钮 disabled 状态合理
5. 首页导航可达

### e2e/specs/smoke-real.spec.ts（@real，`test.skip(!process.env.E2E_REAL_AI)`）
真实 DeepSeek 整链：一句话建站到 done + 工作台一次真实 chat。**费 token、慢**，默认跳过，`npm run test:e2e:real` 才跑。

### e2e/specs/probe-extra.spec.ts
扩展占位（产品导入 modal、import=products 参数、新增质量校验的 UI 提示条等，可后续补）

## 第五步：跑通 + 交付

```bash
npm run test:e2e        # mock 用例（自动起 DB+build+start），预期全绿
npm run test:e2e:real   # @real 冒烟（真实 AI 整链）
npm test                # 确认原单测 138/138 不回归
npm run typecheck       # 0 errors
```

交付：脚本全绿 + e2e/README.md 用法 + 一份「发现并解决的 bug 清单」。

## 第六步：发现 bug 后的处理工作流（关键）

每个探测脚本发现的 bug，按这个流程处理（**先搜后改，贴合项目**）：

### 6.1 分类严重度
🔴 阻断（无法继续）｜🟠 高（明显错误）｜🟡 中（体验差）｜⚪ 低（小瑕疵）

### 6.2 上网搜最佳实践（先搜，别急着写代码）
- **搜什么**：按 bug 类型搜业界成熟方案。关键词建议：
  - 输入校验类 → "form validation UX best practice" / "invalid input feedback pattern"
  - 并发/重复提交 → "double submit prevention" / "idempotency frontend"
  - 长耗时/进度 → "long task progress UI pattern" / "async operation feedback UX"
  - 语言切换 → "i18n language switch UX" / "localization best practices"
  - 预览降级 → "image/iframe fallback pattern" / "graceful degradation"
  - 区块显隐 → "toggle visibility affordance accessibility" / "aria-pressed pattern"
- **搜完要能回答**：业界怎么解决的？有没有被验证过的主流做法？哪些方案适合我们这种 Next.js+React 项目？哪些不适用（过重/需重架构/违背现有设计）？
- 好来源：官方文档（Next.js/React 官网）、GitHub 高 star 项目、大厂工程博客（Vercel/Netlify）；避开个人博客无佐证的观点

### 6.3 选方案 + 贴合项目
- **优先复用项目已有资产**：先 grep 项目里有没有已实现的类似机制（如已有 `previewFeedback` 板块高亮、`hasText` 纯符号校验、`designTokens` 风格变量），能在现有基础上改就不要新造
- **贴合现有架构**：沿用项目的 zod schema 校验、SSE 事件模式、draft/revision 乐观锁、SiteRenderer/OpenSourceTemplateFrame 双渲染通道。不引入未用过的重依赖（如装整个 state 库只为一个 flag）
- **小步改**：每个 bug 独立改、独立验证，避免一次改多处导致定位困难

### 6.4 修复 + 回归测试
- 改完给该 bug 补一个**回归用例**（加进对应 spec，标注 `// regression: <bug 描述>`）
- 复跑 `npm run test:e2e` 确认修复且无新回归
- 若 bug 在纯逻辑层（如校验/解析），也补进 `tests/*.test.ts` 单测（node --test）

### 6.5 记录
每个解决的 bug 在探测报告里记：`严重度 | 场景 | 操作 | 实际 | 期望 | 搜到的方案来源(链接) | 选型理由 | 修复文件 | 回归用例`

### 6.6 明确不修项（记录即可，不折腾）
- 🔴🟠 但修复会引入重架构/大重构 → 记录"建议，需人工决策"，不动手
- 纯视觉美观差异（脚本测的是交互合理性/边界/错误处理，不测视觉）
- 属已知边界（见下方约束）

## 块 2：设计协调视觉验收 + UI 视觉精修（第七步 B 段）

### B. 视觉类（你做 / Codex，需要眼睛看效果）

**Q1. designTokens 协调性校验（先写规则，你截图验收）**
- [搜方案] 关键词："color harmony contrast ratio design token validation" / "accessible color palette check"
- 规则校验（不调模型）：primary 与 accent 撞色（用色差/对比度算）、tone 与 density 冲突、fontStyle 与行业匹配；不合理 → 回退该类默认
- **注意**：`lib/design-variants.ts` 已有 `deriveDesignTokens`（从 intent.colorTone/tone 推导），**在这基础上加协调性检查，不重写**
- **你负责**：用 Playwright 截图三档变体（撞色/协调/冲突回退），确认视觉协调
- 纯逻辑部分（色差计算）可参考 `lib/fact-check.ts`/`structure-check.ts` 的纯函数模式 + 单测

**UI 视觉精修（探测脚本 + 质量任务涉及的所有 UI）**
- 导入入口、完成引导、确认页提示条的**视觉精修**（沿用现有 token，不重新设计）
- 用 Playwright 截图验收每个新增 UI



### 明确不做（本次范围外）
- ❌ 发布上线拿链接（暂不做）
- ❌ 询盘入库（本次不做）
- ❌ 多方案生成 / 额度限制 / 导出代码

### 验证（你负责的部分）
- `npm run test:e2e:real` 真实生成截图存证 + UI 截图（你验收）
- 确认页能显示事实待确认 / 设计变量协调性提示（截图确认）
- 导入入口生效（导入文本后意图更准，截图确认）

## 约束

- 原 `tests/*.test.ts` 单测和 `npm test` 不动
- mock AI 为主（0 token 秒级确定性），真实 AI 只留 @real 冒烟
- 生产模式（非 dev）
- 每测试独立站点（fixture），串行 workers=1
- **修复必须贴合项目现有架构 + 复用现有资产**，先搜最佳实践再动手；不引入重依赖、不大重构
