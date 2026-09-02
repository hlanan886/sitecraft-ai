# Codex 任务 B 探测报告

## [🟠 高 · 已修，已全量复跑] 确认页 - 快速隐藏多个板块只保留最后一次

- 场景：一句话建站确认页，连续关闭多个板块。
- 操作：依次快速点击 5 个 `.generate-toggle`，不等待单个板块的隐藏动画结束。
- 实际：只有最后一次点击进入 `hiddenSections`；前四次被共用的 520ms 定时器取消。
- 期望：每次点击都立即提交独立的显示状态，动画不得影响产品状态。
- 来源：[MDN aria-pressed](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-pressed)、[W3C ARIA5](https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA5)。两者都要求切换状态在交互后同步更新并向辅助技术暴露。
- 选型：继续使用现有 React state 和预览反馈，不引入状态库；`hiddenSections` 立即函数式更新，timer 仅清除动画反馈，预览在 hide 动画期间临时保留当前板块。
- 修复：`app/generate/page.tsx`。
- 回归：`e2e/specs/confirm-flow.spec.ts` - “全隐藏与全显示均有清晰状态”。

## [验证项] A - 一句话建站

- 首轮通过：空输入、纯 emoji、纯标点、中英混杂、模糊需求澄清、越界拒绝、切模板后板块状态、导入上下文、断网、重复提交。
- 全量复跑：空/emoji/标点、超长输入、中英混杂、模糊需求、越界拒绝、模板切换、导入、快速重复生成、刷新恢复均通过。

## [验证项] B - 确认页

- 首轮发现并修复：快速连续隐藏造成状态丢失。
- 全量复跑：全隐藏、全显示、模板切换后业务事实与意图摘要均通过。

## [验证项] C - 工作台

- 首轮通过：完成引导关闭、iframe 失败回退本地预览。
- 全量复跑：撤销/重做、连续 5 次修改、换模板二次确认、中英文隔离、预览失败降级均通过。

## [验证项] D - 模板选择

- 首轮通过：16 个卡片全部使用本地 `SiteRenderer` 且非空白。
- 全量复跑：分类筛选数量、快速切换和 16 个模板本地预览均通过。

## [验证项] E - 全局异常

- 首轮通过：断网友好错误、提交期间 disabled 防重复、首页关键导航可见。

## [🟡 中 · 已修，已全量复跑] 工作台 - 顶部命令在宽屏拆成单字换行

- 场景：工作台桌面宽度，左侧对话与右侧预览同时显示。
- 操作：打开任意站点并观察预览顶部“商品”“换方向重新生成”“发布”。
- 实际：flex 子项被压缩，“商品”“发布”拆成单字两行，长命令也不必要换行。
- 期望：命令文字保持单行；空间不足时由移动端现有横向滚动承载。
- 修复：`app/globals.css` 为 `.preview-toolbar-right` 直接子项增加 `flex: 0 0 auto` 与 `white-space: nowrap`。
- 回归：`e2e/specs/design-tokens-visual.spec.ts` - “工作台工具栏命令保持单行可读”。

## [🟠 高 · 已修，已全量复跑] 生成页 - 生成中刷新丢失原始需求

- 场景：确认模板后开始生成，长耗时期间误刷新页面。
- 操作：输入完整需求、进入生成进度页，在 API 完成前刷新。
- 实际：页面回到输入态且文本框为空，用户必须重新输入。
- 期望：至少保留原始需求与导入上下文；不尝试伪造或恢复未完成的服务端执行状态。
- 来源：[ReactUse sessionStorage](https://reactuse.com/blog/react-usesessionstorage-hook/)、[OpenReplay form persistence](https://blog.openreplay.com/persist-form-state-browser/)。主流模式是单标签页用 sessionStorage、恢复时校验、成功后清除、存储不可用时 fail-open。
- 选型：版本化键名，仅保存非敏感的 `message`/`extraContext` 并严格截断到现有输入上限；不保存 intent、AI 响应、站点数据或密钥。
- 修复：`app/generate/page.tsx`。
- 回归：`e2e/specs/generate-flow.spec.ts` - “生成中刷新保留原始需求”。

## [⚪ 低 · 已修] E2E 基础设施 - 步骤截图落入错误目录

- 场景：designTokens 三档视觉验收截图。
- 实际：`testInfo.config.rootDir` 是 `e2e/`，截图落到 `e2e/test-results/steps`，与 README 和 `.gitignore` 不一致。
- 期望：统一落到仓库根 `test-results/steps` 并附加到 report。
- 修复：`e2e/helpers/ui.ts` 使用 `process.cwd()`；`.gitignore` 兼容忽略旧目录，旧证据不删除。

## [功能验收] designTokens 协调性

- 规则：主色/强调色对比度低于 1.35 回退模板色；技术语气与宽松密度冲突时改为紧凑；工业/工程行业的编辑字体改为技术字体。
- 单测：`tests/design-variants.test.ts` 已完成 3 项 RED→GREEN。
- UI：确认页通过 `.design-coordination-notice` 明示自动调整原因。
- 视觉：协调、撞色回退、语义冲突回退三档通过真实 `set_design_tokens` 写入工作台并截图。

## [最终验收] 2026-09-01

- Mock Playwright：`30 passed / 1 skipped`。
- 真实 DeepSeek：`1 passed`，覆盖一句话分析、模板确认、站点生成、进入工作台和一次真实 chat。
- 单元测试：`141 passed / 0 failed`。
- TypeScript：`npm run typecheck` 通过。
- 生产构建：`npm run build` 通过（Next.js 16.3.1）。
- 未在无 `DEEPSEEK_API_KEY` 的独立进程中启动验证；断网与请求失败的友好错误已覆盖。
- 导入入口、完成引导、确认提示的移动端截图验收仍可补充；不影响已通过的桌面和交互回归。
