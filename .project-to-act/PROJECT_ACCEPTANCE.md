# 项目验收

> 执行测试、交付或声明完成前必须读取本文件。没有新鲜证据时不得写成通过。
> 不粘贴密钥、完整个人信息、原始顾客对话或未脱敏工具输出。

## 当前验收结论

- 结论：F-006/F-007/F-008/F-009/F-010、Task 6 发布回滚和 Task 7 strict 权限隔离专项验收通过；真实 provider 时延适配 F-011、Task 5 chat/execute 并发与最终对抗审查仍未通过/未完成
- 验收范围：AI 建站有限时间交付、真实流式状态、模板降级、刷新恢复、结构化运行观测、确认页体验、真实模板稳定性与工作台精修可靠性
- 最后检查：2026-09-03，本轮 288 项 Node 单测 + 类型检查 + 生产构建 + 定向 Playwright 关键场景
- 遗留问题：项目总体验收 A-001 至 A-004 不在本次专项范围；用户真实测试已证伪 45 秒产品硬截止，F-011 需完成慢请求分级、更晚硬截止和端到端提速

## 验收标准

| 标准 ID | 标准 | 状态 | 验证方法 | 证据 ID |
|---|---|---|---|---|
| A-001 | 项目目标达到可验证结果 | 待检查 | 对照 `PROJECT_OVERVIEW.md` | 无 |
| A-002 | 范围内功能满足完成条件 | 待检查 | 对照 `PROJECT_FEATURES.md` | 无 |
| A-003 | 项目约定的测试全部通过 | 待检查 | 运行完整测试命令 | 无 |
| A-004 | 阻塞与重大遗留问题已处理 | 待检查 | 对照 `PROJECT_PROGRESS.md` | 无 |
| A-005 | 单板块异常不会造成整站无限等待 | 通过 | 永不结算 provider 回归测试 | E-006 |
| A-006 | 部分成功内容保存且缺失板块可识别 | 通过 | 生成器聚焦测试 + 生成页交互 | E-006、E-007 |
| A-007 | 流式状态在桌面和移动端可见且进入明确终态 | 通过 | Playwright 交互与截图 | E-007 |
| A-008 | 完整建站终态可追溯且健康指标口径可验证 | 通过 | 指标单测 + Playwright 冲突存证与响应式面板 | E-009、E-010 |
| A-009 | 自然语言建站确认、有限等待、模板预览与工作台精修形成可靠闭环 | 通过 | Node 全量测试 + 生成/工作台/模板 Playwright + 类型检查 + 构建 + production smoke | E-011、E-012 |
| A-010 | AI 请求重复提交不会造成重复执行，完成请求可重放终态且不跨站点/跨路由串 key | 待检查 | 幂等存储/路由契约定向测试；analyze 真实重放 smoke；chat/execute 多标签、取消和跨实例仍需验证 | E-018、E-019、待补 |
| A-011 | 发布版本与草稿隔离，质量门/冲突阻断发布，版本可回滚且公开页显示最新 immutable 快照 | 通过 | release 单测、真实 publish/release/rollback Playwright/API、公开页 iframe 截图 | E-020 |
| A-012 | 私有 API 统一 workspace/actor 权限门禁，strict 模式拒绝缺上下文、跨 workspace 和 viewer 写操作 | 通过（strict flag） | 权限/租户单测、路由接线契约、strict-mode Playwright | E-021 |
| A-013 | 生成记录携带可复现 provenance，且默认不保存原始企业输入 | 待检查 | provenance 单测、类型检查；真实 PostgreSQL 写入与 chat 运行时仍待补 | E-022（部分） |
| A-014 | 模板覆盖门禁具备真断言并进默认回归；发布链路能拦住资产层缺陷；渲染事实被前端消费 | 通过 | coverage-scan 真断言 22/22；publish-gates 单测 5/5；发布探针实测拦截并修正 | E-025 |
| A-015 | 预览不再降级为本地近似渲染；配色与样式保持模板原生 | 部分通过 | 3 处降级调用已移除；色系选择已删。但 designTokens 仍在覆盖模板字体/圆角/间距（F-021 未做） | E-025 |

## 证据索引

| 证据 ID | 时间 | 方法或命令 | 退出状态 | 版本或文件哈希 | 结果摘要 | 证据位置 | 有效期 |
|---|---|---|---|---|---|---|---|
| E-000 | 未记录 | 未执行 | 未记录 | 未记录 | 无 | 无 | 未定义 |
| E-006 | 2026-09-02 | Node 全量单测 | 0 | 工作区未提交状态 | 149/149 通过；挂死板块、异常隔离、精确 missingSections、模板降级通过 | `tests/site-generator.test.ts` | 本次变更有效 |
| E-007 | 2026-09-02 | Playwright 生成流程桌面/移动端 | 0 | 工作区未提交状态 | 15/15 通过，动态框图聚焦复验 2/2；无横向溢出和框架错误 | `test-results/steps/chromium-generation-*.png` | 本次变更有效 |
| E-008 | 2026-09-02 | `npm run typecheck` + `npm run build` | 0 | 工作区未提交状态 | TypeScript 通过；Next.js 16.3.1 完成 14 个静态页面构建 | 命令输出 | 本次变更有效 |
| E-009 | 2026-09-02 | `npx playwright test e2e/specs/generation-observability.spec.ts --project=chromium` | 0 | 工作区未提交状态 | 2/2 通过；冲突请求只记录一个结构化终态；桌面/移动端六项指标无溢出或框架错误 | `e2e/specs/generation-observability.spec.ts`、`test-results/steps/chromium-generation-health-*.png` | 本次变更有效 |
| E-010 | 2026-09-02 | `npm run typecheck` + `npm run build` + `git diff --check` | 0 | 工作区未提交状态 | TypeScript、Next.js 16.3.1 生产构建（14 个静态页面）和差异空白检查通过 | 命令输出 | 本次变更有效 |
| E-011 | 2026-09-02 | `npm test`；`npx playwright test e2e/specs/generate-flow.spec.ts --project=chromium`；`npx playwright test e2e/specs/workspace.spec.ts --project=chromium`；`npm run typecheck`；`npm run build`；`git diff --check`；生产服务 smoke | 全部 0 | 工作区未提交文件 SHA-256：`lib/generation-experience.ts` `9877E4B1EF0718DC092801105765A56272CEF90CC0A632CA2F3EAC349E993EE2`；`app/generate/page.tsx` `6C950016146C993B55ABD4F587B92BEAA15837154CFBBE4C721DC5AC776BBC91`；`app/workspace/page.tsx` `DB1046541F92A5BDD60914B2871D655E460790BC03F84CEC8F444E5319DBD8CF`；`e2e/specs/generate-flow.spec.ts` `99E7DAA2312A026180DC16F1965E1941635C0861D33507A82AD832B98CDBDEE2`；`e2e/specs/workspace.spec.ts` `6B3909985A77759163A04AE7EB9F76273ECE643EF03ACCC8FF3BC423A0E45BE7` | Node `165/165`；generate `20/20`；workspace `7/7`；类型检查、生产构建和差异检查退出 0；production smoke 返回 200。覆盖 FAQ 兼容、分散推荐、已填预览、真实进度、共享 deadline/cancel、`done` 终态和确认冲突接管 | `tests/*.test.ts`、`e2e/specs/generate-flow.spec.ts`、`e2e/specs/workspace.spec.ts`、命令输出 | 本次未提交工作区有效；真实 provider 不在证据范围 |
| E-012 | 2026-09-02 | `npx playwright test e2e/specs/nextjs-landing-preview.spec.ts --project=chromium`；`npx playwright test e2e/specs/shadcn-pro-preview.spec.ts --project=chromium`；关键 CSS/JS/图片 smoke；`npm run typecheck`；`npm run build`；`git diff --check` | 全部 0 | 工作区未提交文件 SHA-256：`lib/template-static.ts` `A40B78D241D6871C8001662DDFFD20610DEAE631D7452831DC8DB32F09858357`；`app/api/templates/[templateId]/preview/route.ts` `750162B1A224D44A1CF62874C93C97BD0586CB558DD557A3218B75E104D33606`；NEXT `dist/index.html` `3BCF624A50CBCF8A111457EEB864206B82AF14EB700D3F52AD816073061752E7`；SHADCN `dist/index.html` `8CAE520B1FD529B914EF81587FF60DA6C9ACB067536FEFF5CFD1AC836FA8E768`；NEXT spec `9E49F15B7F4DC90AC4E623CD36997839EBECD312C9540268B17B4374BF4F23AA`；SHADCN spec `47C9AD919999591213E3CF02EBD0918518D3E1F3E387727F698EE2F7EFBBA56E` | NEXT `3/3`、SHADCN `1/1`；本地来源头、关键资产 200/MIME、iframe 样式/高度/像素通过；类型检查、生产构建和差异检查退出 0 | `e2e/specs/nextjs-landing-preview.spec.ts`、`e2e/specs/shadcn-pro-preview.spec.ts`、`test-results/steps/chromium-*-preview*.png` | 本次未提交工作区有效 |

| E-013 | 2026-09-02 | 用户在真实建站流程中观察 45 秒硬截止结果 | 不适用（用户真实交互反馈） | 不适用（运行时代码版本沿用 E-011） | 45 秒到达时仍无可用网站，固定阈值的产品适配性未通过；该证据不否定有限终态机制，只否定 45 秒硬截止假设 | 当前任务用户反馈 | 当前版本有效，阈值调整后需复验 |
| E-014 | 2026-09-03 | `node e2e/scripts/preflight.mjs`；`node --test --experimental-strip-types tests/contract-baseline.test.ts tests/preflight.test.ts`；`npm test`；`npm run build`；`npm run typecheck` | 全部 0 | 当前工作区；新增夹具/脚本/配置文件 | preflight 必需依赖均为 true 且 3210 空闲；契约 1/1、preflight 2/2；全量单测 226/226；Next.js 16.3.1 构建 14 个页面；类型检查通过。Node 测试有模块类型警告，未影响退出状态 | `docs/audits/2026-09-03-comprehensive-baseline.md`、`tests/contract-baseline.test.ts`、`tests/preflight.test.ts` | Task 0 完成后有效 |
| E-015 | 2026-09-03 | `node --test --experimental-strip-types tests/site-intent-normalization.test.ts tests/ai-provider-deadline.test.ts`；`npm test`；`npm run build`；`npm run typecheck` | 全部 0 | 当前工作区；`lib/site-intent.ts`、`lib/fact-check.ts`、`lib/ai-provider.ts`、`app/api/sites/[siteId]/generate/route.ts` | 归一化 3/3、provider 4/4；全量单测 230/230；Next.js 16.3.1 构建 14 个页面；类型检查通过。Node 测试有模块类型警告，未影响退出状态 | `tests/site-intent-normalization.test.ts`、`tests/ai-provider-deadline.test.ts` | Task 1 完成后有效 |
| E-016 | 2026-09-03 | 提升权限下 `npm test`；`npm run build`；`npm run typecheck` | 全部 0 | 当前工作区；`lib/template-catalog.ts` Locale 类型修复 | 全量单测 235/235；生产构建完成 14 个页面；类型检查通过。首次构建发现并修复 Locale 类型错误，复验构建和类型检查均退出 0；Node 测试仅有模块类型警告 | `tests/golden-intent.test.ts`、`tests/template-manifest.test.ts`、`tests/template-slot-guard.test.ts`、命令输出 | Task 2 完成后有效 |
| E-017 | 2026-09-03 | `node --test --experimental-strip-types tests/content-quality.test.ts tests/ai-provider-deadline.test.ts tests/site-generator.test.ts`；`npm test`；`npm run build`；`npm run typecheck`；`git diff --check` | 全部 0 | 当前工作区；`lib/content-quality.ts`、`lib/template-slot-guard.ts`、`lib/ai-provider.ts`、`lib/site-generator.ts`、`app/api/sites/[siteId]/generate/route.ts`、`app/generate/page.tsx` | 质量门 2/2；定向 provider/生成回归 41/41；全量单测 238/238；生产构建完成 14 个页面；类型检查和差异检查通过。质量报告已进入生成 SSE `done` 和前端人工复核提示；Node 测试仅有模块类型警告 | `tests/content-quality.test.ts`、`tests/ai-provider-deadline.test.ts`、命令输出 | Task 3 当前批次有效；真实 provider 未包含 |
| E-018 | 2026-09-03 | 提升权限 `node --test --experimental-strip-types tests/request-idempotency.test.ts tests/sse-response.test.ts tests/request-idempotency-contract.test.ts tests/sse-events.test.ts`；`npm test`；`npm run typecheck`；提升权限 `npm run build`；`git diff --check` | 全部 0 | 当前工作区；`lib/request-idempotency.ts`、`lib/sse-response.ts`、两个 API route、`app/generate/page.tsx`、`app/workspace/page.tsx`、新增测试 | 定向幂等/SSE/路由契约 10/10；全量单测 252/252；类型检查、生产构建（14 个页面）和差异检查退出 0。覆盖 TTL、释放、终态重放、route+site scope、前端请求 key 和 409 JSON 错误展示；未覆盖真实 API、多标签、跨实例、真实 provider 和取消后恢复 | `tests/request-idempotency.test.ts`、`tests/sse-response.test.ts`、`tests/request-idempotency-contract.test.ts`、命令输出 | Task 5 确定性部分有效，真实运行时验收待补 |
| E-019 | 2026-09-03 | 提升权限启动 `npm run dev -- --port 3210`；PowerShell 本地 smoke（`/api/health`、`/api/ai/status`、两次同 key `/api/sites/demo/generate`） | 全部 0（服务后以 Ctrl+C 停止） | 当前工作区；`.env.local` provider 状态为 deepseek-v4-flash | 健康 200；provider 状态可见；首次 analyze 200、约 10.6s；同 scope+key 重放 200、约 39ms；重放事件为 `done/ready`，保留 requestId/taskId/sequence/revision。未触发 chat/execute、多标签、取消后恢复、跨实例和第二次 commit 计数 | smoke 命令输出与开发服务日志 | 仅证明本地 analyze 重放路径，不能替代完整 A-010 |
| E-020 | 2026-09-03 | `node --test --experimental-strip-types tests/release-store.test.ts`；`npx playwright test e2e/specs/publish-rollback.spec.ts --project=chromium --workers=1` | 全部 0 | 当前工作区；`lib/release-store.ts`、`components/open-source-template-frame.tsx`、`e2e/specs/publish-rollback.spec.ts` | release 定向单测 5/5；Playwright 发布回滚 3/3：v1 快照不随草稿编辑变化，质量门拒绝未完成草稿且不写版本，revision 冲突不写版本，v2 递增，回滚生成 v3，重复回滚重放同一结果；公开页真实 iframe 显示回滚后的 v1 标题。截图 `test-results/steps/chromium-publish-rollback-desktop.png` | `tests/release-store.test.ts`、`e2e/specs/publish-rollback.spec.ts`、截图 | Task 6 专项有效；PostgreSQL 真实并发压测未执行 |
| E-021 | 2026-09-03 | `node --test --experimental-strip-types tests/request-context.test.ts tests/tenant-isolation.test.ts tests/access-route-contract.test.ts`；`SITECRAFT_ACCESS_MODE=strict npx playwright test e2e/specs/access-isolation.spec.ts --project=chromium --workers=1`；`npm run typecheck` | 全部 0 | 当前工作区；`lib/request-context.ts` 和私有 API routes | 权限/接线测试 8/8；strict-mode Playwright 1/1；类型检查退出 0。无上下文 401、跨 workspace 403、viewer 写操作 403、editor 读取 200、公开 siteKey 路径保持匿名。strict 模式依赖受控 headers，未接入真实内部网关签名 | `tests/request-context.test.ts`、`tests/tenant-isolation.test.ts`、`tests/access-route-contract.test.ts`、`e2e/specs/access-isolation.spec.ts` | Task 7 strict 专项有效；默认 relaxed 模式不提供生产隔离保证 |

| E-022 | 2026-09-03 | 提升权限 `node --test --experimental-strip-types tests/prompt-registry.test.ts tests/generation-provenance.test.ts tests/generation-record.test.ts`; `npm run typecheck` | 全部 0 | 当前工作区；`lib/prompt-registry.ts`、`lib/generation-record.ts`、`app/api/sites/[siteId]/generate/route.ts`、`lib/ai-provider.ts` | provenance/提示词注册 4/4，既有生成存证回归 5/5；TypeScript 退出 0。生成路由已接入唯一 `recordTerminal`，provider 提示词带 `id@version`，存证默认 input_text 为空并写 provenance JSONB；未验证真实 PostgreSQL 行、chat 存证、真实 provider 运行时 | `tests/prompt-registry.test.ts`、`tests/generation-provenance.test.ts`、`tests/generation-record.test.ts`、命令输出 | Task 8 基础契约有效，不能替代真实 API/数据库验收 |
| E-023 | 2026-09-03 | 提升权限 `node --test --experimental-strip-types tests/generation-deadline-contract.test.ts tests/generation-budget.test.ts` | 0 | 当前工作区；`app/generate/page.tsx`、`tests/generation-deadline-contract.test.ts` | deadline 契约 1/1、预算回归 4/4；analyze 不再写死 45 秒，统一使用 `GENERATION_BUDGET.clientHardDeadlineMs`，慢请求提示仍在 25/45 秒分级。未验证真实 DeepSeek P50/P95、完整交付率和超时率 | `tests/generation-deadline-contract.test.ts`、`tests/generation-budget.test.ts`、命令输出 | F-011 确定性修复有效，真实 provider 阈值仍待校准 |
| E-024 | 2026-09-03 | 提升权限 `npm test`；`npm run typecheck`；`npm run build`；`git diff --check`；关键生成/确认/模板/工作台 Playwright 定向验收；`node --test --experimental-strip-types tests/generation-cancellation-contract.test.ts` | 全部 0 | 当前工作区；`app/generate/page.tsx`、`components/client-preview-frame.tsx`、生成/确认/模板/工作台验收脚本 | 单测 288/288；取消契约 3/3；定向 Playwright 7/7；类型检查、生产构建（Next 16.3.1，14 页面）和差异检查退出 0。硬截止同时 `abort()`/`reader.cancel()`；已填预览文本可独立定位；过时 locator/22 模板数量已同步真实目录。未验证：两个 workspace 消息级撤销场景（测试 helper 与服务端 PostgreSQL 存储隔离）、真实 DeepSeek P50/P95/交付率、多实例幂等、SSE 真实乱序/重复和完整对抗性审查 | `tests/generation-cancellation-contract.test.ts`、`e2e/specs/confirm-flow.spec.ts`、`e2e/specs/generate-flow.spec.ts`、`e2e/specs/templates.spec.ts`、`e2e/specs/workspace.spec.ts`、`test-results/`、命令输出 | 确定性与关键前端验收有效；不构成 ready |
| E-025 | 2026-09-09 | `npm test`；`npx tsc --noEmit`；`npm run build`；`npx playwright test e2e/specs/coverage-scan.spec.ts --project=chromium --workers=1`（22 模板）；`npx playwright test e2e/specs/publish-rollback.spec.ts e2e/specs/workspace.spec.ts --project=chromium --workers=1`；本地发布探针（真实 API） | 单测 0（437/437）；类型检查 0；构建 0；coverage-scan 22/22 通过；发布回滚 20 通过 / 2 失败（workspace 撤销）；发布探针 201 | 当前工作区（**未提交**，含 271 项改动）；新增 `lib/publish-gates.ts`、`tests/publish-gates.test.ts`；改动 `e2e/specs/coverage-scan.spec.ts`、`e2e/helpers/coverage-scan.ts`、`playwright.config.ts`、`app/api/sites/[siteId]/publish/route.ts`、`components/open-source-template-frame.tsx`、`app/workspace/page.tsx`、`app/generate/page.tsx`、`app/published/[siteKey]/client.tsx`、`lib/content-quality.ts`、`lib/design-variants.ts`、`lib/template-manifests/{astrogent,screwfast}.ts` | 模板门禁从零断言变为真断言并进默认回归；发布链路接入资产门禁；`generatedContentSections` 接入前端；移除 3 处 `SiteRenderer` 降级；修正 A10 中文长度上限（11→15 字，发布探针 422→201）；移除色系选择。未通过：`workspace.spec.ts:321/345` 两个撤销场景（本轮未触及撤销链路，待归因） | `tests/publish-gates.test.ts`、`e2e/specs/coverage-scan.spec.ts`、`e2e/helpers/coverage-scan.ts`、命令输出 | 本轮未提交工作区有效；撤销场景失败不计入通过 |

## Gate 记录

| Gate ID | 日期 | Gate | 对象 | 结果 | 证据 ID | 豁免与确认人 |
|---|---|---|---|---|---|---|
| G-000 | 未记录 | 未定义 | 未定义 | 未检查 | 无 | 无 |
| G-001 | 2026-09-03 | Task 0 基线门禁 | 测试、构建、类型检查、Playwright 启动前置 | 通过 | E-014 | 后续业务任务仍需各自新鲜证据 |
| G-002 | 2026-09-09 | 模板覆盖门禁（L1） | 22 个模板的必需槽覆盖与 demo 残留 | 通过 | E-025 | 由零断言改为真断言并进入默认回归；此前被 testIgnore 排除 |
| G-003 | 2026-09-09 | 发布门禁（L2b 资产层） | 首屏 demo 主视觉 | 通过（警告级） | E-025 | 暂为警告不阻断：12/22 模板命中，阻断会使新建站点一律无法发布，属产品决策待定 |

## 验收记录

按时间倒序追加：日期、检查范围、证据 ID、结果、遗留问题和结论。失败、跳过与过期证据也必须如实记录。

- 2026-09-09：检查 F-018/F-019，证据 E-025，专项通过。模板覆盖门禁由零断言改为真断言并进入默认回归（22/22）；发布链路接入资产门禁（单测 5/5 + 真实 API 探针）；渲染事实接入前端；移除 3 处降级渲染；修正 A10 中文长度上限（探针 422→201）；移除色系选择。**失败项**：`workspace.spec.ts:321/345` 两个消息级撤销场景失败，本轮 workspace 改动仅新增 `structureNotice`、未触及撤销链路，归因待定，不计入通过。
- 2026-09-09：产品审计（只读代码，未执行测试），发现三项 P0 级真实性问题并登记为 F-020/F-021/F-022：① 首页 `app/page.tsx` 站点列表与统计为硬编码演示数据、站点卡片链接三元两边相同；② 设置页 4 个按钮 `onClick` 出现 0 次；③ `designTokens` 经 `!important` 覆盖 22/22 模板的字体/圆角/区块间距，削弱「真实开源模板」卖点。均未修复。
- 2026-09-02：真实 provider 用户测试，证据 E-013，45 秒产品硬截止未通过。确定性测试证明的“有限、可取消、终态明确”仍有效，但不能据此宣称真实建站成功率或速度达标；F-011 保持进行中，需把 45 秒改为慢请求告警点、采用更晚硬截止并继续提速。
- 2026-09-02：检查 F-010，证据 E-011/E-012，专项通过。Node、生成流、工作台、NEXT LANDING、SHADCN PRO、类型检查、生产构建、差异检查与 production smoke 均通过；遗留为真实 DeepSeek 外发测试尚未获用户明确授权，不将确定性测试等同真实 provider 样本。
- 2026-09-02：检查 F-009，证据 E-009/E-010，专项通过。遗留为真实模型样本积累与基于分布调参，不阻塞用户开始测试。
- 2026-09-02：检查 F-006/F-007/F-008，证据 E-006/E-007/E-008，专项通过。遗留为真实模型生产耗时观测，不阻塞本次功能验收。
- 2026-09-03：检查 F-014 确定性部分，证据 E-018。幂等存储、SSE 重放、路由/客户端契约、全量单测、类型检查和生产构建通过；真实 API、多标签、跨实例、取消恢复及 Playwright 重复提交场景未执行，因此 A-010 保持待检查。
- 2026-09-03：检查 F-014 analyze 真实 smoke，证据 E-019。健康与同 key 终态重放通过；chat/execute、多标签、取消恢复和跨实例仍未验证，A-010 继续待检查。
- 2026-09-03：检查 Task 6/F-015，证据 E-020，专项通过。发布、质量门、revision 冲突、版本历史、回滚和幂等重放均通过真实 API/Playwright；公开页 iframe 显示 immutable 回滚快照。PostgreSQL 并发压测未执行。
- 2026-09-03：检查 Task 7/F-016，证据 E-021，strict 专项通过。私有 API 统一授权并实际返回 401/403；默认 relaxed 模式和真实内部网关签名仍是残余风险。
- 2026-09-03：检查 F-010/F-011 确定性收尾，证据 E-024。生成超时取消、已填内容跨标签预览、确认页模板切换、板块恢复状态、22 模板列表和局部重生成取消均通过定向 Playwright；全量单测、类型检查、生产构建和差异检查通过。消息级撤销的两个浏览器场景因测试 helper 使用本地存储而服务使用 PostgreSQL，未将其误判为通过；真实 provider 时延、多实例幂等和最终对抗性审查仍阻塞 ready。
