# 文档索引

> 本目录只保留**产品文档**与**验收记录**。开发过程产物（计划、审计、协作底稿）
> 不进仓库——它们随时间失效，留着只会误导。

## 先读这几份

| 文档 | 讲什么 | 什么时候读 |
|---|---|---|
| [`../README.md`](../README.md) | 项目是什么、怎么跑起来 | **第一次接触项目** |
| [`PRODUCT-BASELINE.md`](PRODUCT-BASELINE.md) | 产品口径、三条建站链路 | 改产品逻辑前（**与旧设计文档冲突时以它为准**） |
| [`deploy-auth.md`](deploy-auth.md) | 生产鉴权：网关注头 | **部署前必读** |
| [`glossary.md`](glossary.md) | 术语表与命名依据 | 改字段名/枚举前 |
| [`../.project-to-act/`](../.project-to-act/) | 项目账本：总览 / 功能清单 / 验收 / 进度 / 版本 | 想知道"做到哪了" |

## 其余文档

| 文档 | 内容 |
|---|---|
| [`architecture-audit.md`](architecture-audit.md) | 架构审计 |
| [`boundary-test-report.md`](boundary-test-report.md) | 边界测试报告 |
| [`2026-09-13-production-auth-inventory.md`](2026-09-13-production-auth-inventory.md) | 生产鉴权现状盘点 |
| [`ai-chat-evidence.md`](ai-chat-evidence.md) | AI 对话能力验收证据 |
| [`template-design-token-adaptation.md`](template-design-token-adaptation.md) | 模板设计令牌适配说明 |
| [`screwfast-acceptance-checklist.md`](screwfast-acceptance-checklist.md) | screwfast 模板验收清单 |
| [`screwfast-visual-review-log.md`](screwfast-visual-review-log.md) | screwfast 视觉走查记录 |

## 工程约定在哪

代码规范与合约纪律写在仓库根的 [`AGENTS.md`](../AGENTS.md)——
它是**给 AI 协作者**的契约（命名、派生、门禁、并发），
新人也可以读，但先看上面那几份产品文档。
