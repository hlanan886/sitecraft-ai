# 开源模板库扩充：补外贸/专业/科技分类

- 日期：2026-09-01
- 场景：一句话建站"锁定匹配但模板不够多"，用户要求从 GitHub 找开源模板扩充各分类
- 方向：模板系统
- 置信度：7
- 层级：复合
- 状态：已落地
- 复用量：1
- 来源：[Tailwind Landing Page](https://github.com/tailwindtoolbox/Landing-Page)、[Next.js Landing Starter](https://github.com/ixartz/Next-JS-Landing-Page-Starter-Template)、[Shadcn Landing (nobruf)](https://github.com/nobruf/shadcn-landing-page)

## 问题

模板库扩充后分布仍失衡：制造业 2、外贸 2、科技 9、专业 8。制造业/外贸是最空的两块，但 GitHub 直接搜"manufacturing/industrial template"几乎找不到高质量 MIT 模板（结果多 <10 星）。需要扩充更多分类的可用模板，尤其是外贸/专业。

## 借鉴方案

从高星 MIT 仓库批量扩充 3 个模板（重点补外贸/专业，避免科技重复过多）：

1. **tailwind-landing**（tailwindtoolbox/Landing-Page，⭐1.4k，MIT，HTML+Tailwind，有 live demo）→ 外贸目录。有本地 index.html，可完整本地预览。
2. **nextjs-landing**（ixartz/Next-JS-Landing-Page-Starter-Template，⭐2.1k，MIT，Next.js+Tailwind，有 live demo）→ 专业服务。
3. **shadcn-landing2**（nobruf/shadcn-landing-page，⭐1.3k，MIT，Next.js+shadcn，有 live demo）→ 科技企业。

## 关键决策

- **优先补最空的分类**：外贸从 2→3，专业从 8→8（新增 nextjs-landing），避免继续往科技（已 9）堆。
- **license 强制 MIT**：cruip（⭐4.5k）无明确 license 不可用，astroship（⭐1.9k）GPL-3.0 不可用，都排除。tailwindtoolbox/Landing-Page 和 ixartz 均为 MIT。
- **git submodule 直连克隆**：GitHub API 频繁 unexpected EOF（网络抖动），但 git clone 直连更稳；失败重试一次即可。
- **本地 index.html 决定预览策略**：tailwind-landing 有（完整本地预览），nextjs-landing/shadcn-landing2 是框架项目无（走 SiteRenderer 兜底）。
- **id 命名**：新增用 `tailwind-landing`/`nextjs-landing`/`shadcn-landing2`（避免与已有 `shadcn-landing` 冲突）。

## 搜索策略

- GitHub 直接搜 `manufacturing/industrial template` 结果低质（<10 星），**行业专用模板在 GitHub 稀缺**——应找高质量企业/B2B 通用模板再归到外贸/专业。
- 有效渠道：WebSearch 找"best free open source business website templates"合集 → 找到候选 → gh API 确认 license/homepage → git submodule 直连克隆。
- 关键规律：**license 一定要先确认**（README 里的 license 徽章不可靠，直接读 LICENSE 文件或用 gh api 的 license.spdx_id）。
- 坑：gh api 的 `search/repositories` 频繁 unexpected EOF，但 `repos/<name>` 和 `repos/<name>/contents/LICENSE` 相对稳；git clone 直连 github.com 最稳。

## 验证记录（证据链）

- 自动化：`npm test` 142 项全部通过；`npx tsc --noEmit` exit 0；`npm run build` 成功。
- 运行时（Playwright）：模板页 22 张卡片；分类分布 制造业 2 / 外贸目录 3 / 科技企业 9 / 专业服务 8；新模板 TAILWIND LANDING / NEXT LANDING / SHADCN PRO 均存在。
- 未验证：新模板的完整本地预览（nextjs-landing/shadcn-landing2 无 index.html，走 SiteRenderer 兜底）。

## 落地版

- `.gitmodules` / `vendor/open-source-templates/`：新增 3 个子模块（tailwind-landing、nextjs-landing、shadcn-landing2）。
- `lib/template-catalog.ts`：新增 3 个模板条目。
- `app/globals.css`：新增 3 段 per-template CSS。
- `OPEN_SOURCE_TEMPLATES.md` / `app/templates/page.tsx`：登记 + 数量更新为 22。

## 当前结论

模板库从 19 扩到 22，外贸/专业补上可选空间。但制造业仍只有 2（forge/screwfast）——行业专用模板稀缺是持续瓶颈。若未来要补制造业，可从 AstroFlow（物流/制造模板）或自建工业风格模板入手。置信度暂定 7。
