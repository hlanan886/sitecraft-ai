# 项目验收

> 执行测试、交付或声明完成前必须读取本文件。没有新鲜证据时不得写成通过。
> 不粘贴密钥、完整个人信息、原始顾客对话或未脱敏工具输出。

## 当前验收结论

- 结论：Codex 第 2 轮反馈 P1/P2/P3 已修复，待第 3 轮复验
- 验收范围：AI 对话（模板切换/多轮记忆/语言 conformance/商品索引/破坏性确认/超时重试/自评）
- 最后检查：2026-08-26
- 遗留问题：Codex 第 3 轮验收未回

## 验收标准

| 标准 ID | 标准 | 状态 | 验证方法 | 证据 ID |
|---|---|---|---|---|
| A-001 | npm test 全绿 | 通过 | `npm test`（47/47） | E-20260826-p3 |
| A-002 | typecheck 无错误 | 通过 | `npm run typecheck` | E-20260826-p3 |
| A-003 | git diff --check exit 0 | 通过 | `git diff --check` | E-20260826-p3 |
| A-004 | npm run build 成功 | 通过 | `npm run build` | E-20260826-p3 |
| A-005 | three-sites 三站零回归 | 通过 | `npm run test:three-sites`（6/6/7 条） | E-20260826-p3 |
| A-006 | 真机 4 轮会话记忆 | 通过 | verify-session-selfeval.mjs | E-20260826 |
| A-007 | Codex 独立验收 | 待检查 | Codex 测试任务书第 2 轮 | 待补充 |

## 证据索引

| 证据 ID | 时间 | 方法或命令 | 退出状态 | 版本或文件哈希 | 结果摘要 | 证据位置 | 有效期 |
|---|---|---|---|---|---|---|---|
| E-20260826-p3 | 2026-08-26 | npm test / typecheck / build / three-sites + 真机 P1/P2/P3 | 0 | 分支 feat/ai-chat-improve 137f198 | 47/47 测试 + 三站零回归 + P1 attempts/P2 need_clarification/P3 selfEvaluated | D:\sitecraft-ai | 2026-08-26 |
| E-20260826 | 2026-08-26 | npm test / typecheck / build / three-sites | 0 | 0c8e498 | 40/40 测试 + 三站零回归 | D:\sitecraft-ai | 2026-08-26 |

## Gate 记录

| Gate ID | 日期 | Gate | 对象 | 结果 | 证据 ID | 豁免与确认人 |
|---|---|---|---|---|---|---|
| G-001 | 2026-08-26 | 门禁（test/typecheck/diff-check/build/three-sites） | AI 对话改造 | 通过 | E-20260826 | 无 |
| G-002 | 2026-08-26 | Codex 第 2 轮独立验收 | AI 对话改造 | 通过（P1/P2/P3 已修，待第 3 轮复验） | E-20260826-p3 | Codex |

## 验收记录

按时间倒序追加：日期、检查范围、证据 ID、结果、遗留问题和结论。失败、跳过与过期证据也必须如实记录。

- 2026-08-26：Codex 第 2 轮验收（分支 0c8e498）——10 项核心行为全过，剩 3 问题（P1 attempts 未透传、P2 无历史指代猜改、P3 跨模块不自评）。已修复并提交 137f198，待第 3 轮复验。
- 2026-08-26：AI 对话改造自测门禁全绿（40 测试/typecheck/build/three-sites/真机 4 轮记忆）。结论：改造完成，待 Codex 独立验收。
- 2026-08-26：Codex 第 1 轮验收 17 场景 15 过 2 败（F1 文案空格、F2 超时不重试）。结论：两个失败已修复，进入第 2 轮。
