# Sitecraft 方案经验索引

| 标题 | 方向 | 状态 | 日期 | 来源 | 复用量 | 场景 |
| --- | --- | --- | --- | --- | ---: | --- |
| [生成过程可感知与真实流式预览](./20260902-perceived-streaming-generation.md) | 产品体验 / 流式架构 | 未验证 | 2026-09-02 | NN/g、MDN、Vercel AI SDK | 1 | 后台已有 SSE，但生成页长期显示静态框图，用户感受不到网站正在生成 |
| [AI 建站可靠性与编辑器反馈方案](./20260902-ai-builder-reliability-patterns.md) | 产品体验 / 数据一致性 / AI 交互 | 未验证 | 2026-09-02 | Wix Harmony、Webflow、Framer、Vercel AI SDK | 0 | 连续编辑丢更新、生成反馈、模板目录一致性和发布前草稿边界 |
| [模板预览与生成体验优化](./20260901-template-preview-generation-ux.md) | 产品体验 / 前端架构 | 已落地 | 2026-09-01 | Duda、Sanity、Career Pilot | 2 | 模板预览受上游 429 影响、切换反馈弱、生成等待不可见 |
| [AI 建站产品的模板展示与一句话生成调研](./20260901-ai-builder-template-showcase.md) | 产品设计 / 前端展示 | 已落地 | 2026-09-01 | Framer、Durable、Wix ADI、Webflow | 1 | 模板展示页体现不出"一句话建站"核心能力，需借鉴成熟 AI 建站产品的思路 |
| [模板化对策：补模板分类 + 放开跨分类 + 风格变体](./20260901-template-lock-in-mitigation.md) | 产品设计 / 模板系统 | 已落地 | 2026-09-01 | Durable、Wix Harmony、ScrewFast | 1 | 推荐锁分类但模板不够多、生成易模板化 |
| [开源模板库扩充：补外贸/专业/科技分类](./20260901-open-source-template-library-expansion.md) | 模板系统 | 已落地 | 2026-09-01 | Tailwind Landing、Next Landing、Shadcn Pro | 1 | 模板库分布失衡、需要更多分类可选 |
| [模板预览永久稳定：全部 22 模板本地快照化](./20260901-template-local-snapshots.md) | 运维 / 构建流水线 | 已落地 | 2026-09-01 | 各模板上游仓库 | 1 | 模板预览依赖远程 demo 导致 502、需要永久稳定 |

当前索引没有超过 6 个月未更新的方案。
