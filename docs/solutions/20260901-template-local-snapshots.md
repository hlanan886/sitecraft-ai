# 模板预览永久稳定：全部 22 模板本地快照化

- 日期：2026-09-01
- 场景：用户发现"打开网站找不到模板"——原仓库模板和工作台预览全部 502 降级
- 方向：运维 / 构建流水线
- 置信度：9
- 层级：复合
- 状态：已落地
- 复用量：1
- 来源：无外部借鉴，纯本地排查与构建（源码来自各模板上游仓库）

## 问题

用户反馈"打开网站后原仓库模板找不到了，比换颜色还严重"。三路排查（模板库完整性、渲染链路、运行现状）定位到根因：

1. **preview API 依赖远程 demo**：`app/api/templates/[templateId]/preview/route.ts` = 优先本地快照（`getTemplateStaticRoot` 找 `dist/index.html`）→ 否则代理 `demoUrl`（15s 超时）→ 失败 502。
2. **19/22 模板无本地快照**：vendor 子模块是源码克隆，Astro/Next 的 `dist/` 是构建产物（上游 .gitignore 忽略），克隆后不存在。
3. **远程 demo 双重失败**：forge（vercel.app）国内直连被墙、Next 进程又不继承用户级代理 → 502；fresh/odyssey 域名 DNS 已失效 → 502。

## 借鉴方案

**核心决策：把 22 个模板全部构建出本地快照，preview 永不依赖远程。** 具体做法：

1. **逐个在 vendor 子模块内执行 `npm install && build`** 生成 `dist/index.html`，`getTemplateStaticRoot` 命中本地快照（`X-Sitecraft-Preview-Source: local-open-source-snapshot`）。
2. **Next.js 模板适配**：`getTemplateStaticRoot` 增加 `.next/server/app/index.html` 和 `.next/server/pages/index.html` 两处查找（Next build 输出到 `.next/server/` 而非 `dist/`）。
3. **构建策略（踩坑沉淀）**：
   - npm 走代理（7890）频繁 `EIDLETIMEOUT` → 改用国内镜像 `--registry=https://registry.npmmirror.com` 稳定且快。
   - 依赖冲突（astroplate）→ `--legacy-peer-deps`。
   - pnpm 项目（fresh）→ 用 `pnpm install` 装依赖（npm 装不全会缺 run-s），构建时绕过 `run-s` 直接调 `astro build`。
   - bash 风格构建脚本（awesome 的 `NODE_ENV=production astro build`）在 Windows cmd 跑不了 → 用 `npx astro build` 或 `NODE_ENV=production npx astro build`。
   - astropaper 的 `astro check` TS 类型错误（og.png.ts ReactPortal 不兼容）+ og 字体需下载 → 临时移走 og 页构建，完成后恢复。
   - genai 缺 vite → `npm install vite` 补装。

## 关键决策

- **目标：22 个模板全部 local-open-source-snapshot，0 个 remote/502**（梯子关不关都稳定）。
- 修改 `lib/template-static.ts` 增加 Next.js 产物路径（app + pages），不改 preview route 逻辑。
- dist/ 是构建产物，本地存在、git 忽略（上游 .gitignore），不上传仓库——每次 clone 后需重新构建（可用脚本批量）。

## 搜索策略

无外部搜索（纯本地排查 + 构建）。构建策略的踩坑经验（镜像/legacy-peer-deps/pnpm/bash 脚本）是最有价值的部分，已记录在本方案。

## 验证记录（证据链）

- **全量 22 模板 preview 实测**：全部 `200 + X-Sitecraft-Preview-Source: local-open-source-snapshot`，0 个 502、0 个 remote。
- 回归：`npm test` 142 项全过；`npx tsc --noEmit` exit 0；`npm run build` 成功。
- 端到端：dev server（http://localhost:3000）正常运行，模板列表页 22 张卡片。

## 落地版

- `lib/template-static.ts`：`getTemplateStaticRoot` 增加 `.next/server/app` 和 `.next/server/pages` 两处 Next.js 产物查找。
- `vendor/open-source-templates/<22 个模板>/dist/`：全部构建产物（本地，git 忽略）。
- 各模板 node_modules：已安装依赖（本地，git 忽略）。

## 当前结论

**效果**：模板预览永久稳定——22 个模板全部本地快照，不依赖远程 demo、不依赖梯子。用户打开模板库/工作台/发布页，每个模板都能渲染真实的开源模板 HTML。置信度 9（全量验证通过，唯一变数是未来 clone 新环境需重新构建）。
