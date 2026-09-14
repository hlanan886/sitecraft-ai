# 术语表（Glossary）

> 契约治理的**唯一命名依据**。流程见 [`contracts-unify-prompt-for-deepseek.md`](contracts-unify-prompt-for-deepseek.md)，
> 冲突证据见 [`2026-09-12-contract-conflict-inventory.md`](2026-09-12-contract-conflict-inventory.md)。
>
> 用户裁决（2026-09-12）：建议 #2、#3 照准；#1 拆分——类型与 payload 统一到 `item`
> 并入改名范围，**操作名（`update_card`/`add_card`）留到阶段 4 做别名兼容**，
> 禁止混入改名提交。

---

## 一、核心术语（一词一概念）

| 术语 | 含义 | 权威定义 | 反例（禁用） |
|---|---|---|---|
| `item` | **一条内容条目**：`features`/`services`/`faq` 数组里的一项 | 类型 `EditableItem`（`lib/site-document.ts` 的 `editableItemSchema`）；草稿字段 `content.<section>.items` | `card`（作为**名词**使用时）、`entry`、`element` |
| `slot` | **DOM 上的可编辑位置**，点分路径，可带 locale 与下标：`hero.title.zh`、`features.items.0.title.zh`、`navigation.<id>.zh` | `data-sitecraft-slot` 属性；`lib/inline-edit-mapping.ts` 的文件头 | —— |
| `presentationSlot` | **模板原生排版的业务段名**，裸名无点分：`"features"`、`"services"`（**还有 `hero`**，它不是 `sectionKeys` 的一员） | `TemplatePresentationBlock.presentationSlot`（`lib/template-manifests/types.ts`） | ⚠️ 见下方「同名不同义」 |
| `section` | **站点业务板块**：`about`/`features`/`services`/`products`/`contact` | `sectionKeys`（`lib/site-document.ts`） | `block`、`module`、`section` 以外的叫法 |
| `target` | **操作指向的字段路径**（`set_text` 的 `target`）：`hero.title`、`about.body` | `textTargets`（`lib/site-operations.ts`） | `field`、`key` |
| `manifest` | **模板的内容契约**：槽位声明 + 排版角色 + 容量 | `TemplateManifest`（`lib/template-manifests/types.ts`） | `schema`（那个词留给 zod） |
| `maxLength` / `SLOT_MAX_LENGTH` | **槽位能装的字符数**，长度类约束的**唯一事实源** | `lib/template-slot-contract.ts` | ⚠️ 禁止在任何别处另写一个数字 |
| `capacityMax` | **模板原生排版能显示几条**（与 `maxLength` 是两条独立约束） | `TemplatePresentationBlock.capacity.max` | 不要与 `maxLength` 混用 |

### 为什么 `maxLength` 与 `capacityMax` 必须分开

它们是**两个问题**：前者是"存不存得下"（schema 层，超了会读取失败），
后者是"排版能显示几条"（观感层，超了只是不好看）。
2026-09-12 的事故正是把两者混为一谈：用**可读性建议值**（40）去拦**存储容量**（800）。

---

## 二、同名不同义：**必须保留两名，不得合并**

> 硬性约定：以下每组是**两个不同的概念**，强行统一会破坏语义。
> 用户裁决（2026-09-12）：五项全部保留，写入反面清单。

### 1. `slot` vs `presentationSlot`

| | `slot` | `presentationSlot` |
|---|---|---|
| 形态 | 点分路径，带 locale/下标：`features.items.0.title.zh` | 裸段名：`"features"` |
| 用途 | 定位 DOM 上的可编辑节点 | 查模板原生排版角色与容量 |
| 定义处 | `data-sitecraft-slot`、`inline-edit-mapping.ts` | `TemplatePresentationBlock.presentationSlot` |

⚠️ **这两者格式不同，混用会造成静默失效**——2026-09-12 修掉的 P0（冲突 #1）正是如此：
校验器按 `${section}.items` 查生产传来的裸段名，于是 `add_card` 容量门**从未生效**。

**约定**：代码里读 `presentation.slot` 的字段一律叫 `presentationSlot`；
描述 DOM 位置的才叫 `slot`。

> **附则 2 的实例（2026-09-12 自查发现）**：阶段 3 改完名后，本表**有两行没跟着改**——
> 上面写的 `editableCardSchema` 与 `TemplatePresentationBlock.slot` **在代码里已不存在**。
> 权威表的价值全在"能据它找到真东西"，指向不存在的符号等于自毁。
> 教训：**改名提交必须连带更新术语表**，否则改名的就是术语表自己。

### 2. `ComposerBlock` vs `TemplatePresentationBlock`

前者是**拼装器 DSL 里"选了哪个组件+版式"**（`template-composer-dsl.ts`）；
后者是**模板 manifest 里"这个业务槽原生长什么样、能装几条"**（`template-manifests/types.ts`）。
都叫 block，层级不同——**不要合并类型**。

### 3. `cardSections` vs `sectionKeys`

`cardSections = ["features","services","faq"]` 是"**哪些节能被 `update_card` 写**"；
`sectionKeys = ["about","features","services","products","contact"]` 是"**站点有哪五节**"。
成员不同是**设计**，不是漂移。

### 4. 基线模板契约 vs 运行时 `KNOWN_TARGETS`

两者**本就不是同一张表**（`lib/template-runtime.ts` 注释明说）。
沉淀模板的契约由运行时注册，基线由编译期常量维护。

### 5. `hero.subtitle` 的版式启发值 vs `about.body` 的契约容量

`hero.subtitle` 在 manifest 里**没有槽位**，只能按版式经验判（40/25）；
`about.body` **有契约容量**（800），必须按契约判。
**不要为了"统一"把它们并回一组数字**——那正是本轮事故的成因。

---

## 三、待办登记区

> 已识别但**尚未排期**的缺口。登记在此，不擅自修。

### 状态一览（2026-09-12 阶段 4 收口时点）

| 编号 | 一句话 | 状态 | 归属 |
|---|---|---|---|
| T-1 | `faq` 的 `add_item` 无容量校验 | **未做**（登记待排期） | 待用户排期 |
| T-2 | `products` 契约两层不一致（22/17） | **只登记**（用户裁决不处理） | 关闭 |
| T-3 | 枚举中文释义维护了三套 | **未做** | 后续批次 |
| T-4 | `template-catalog.ts` 的 `guardrails` 数值规则未逐条核实 | **未做** | 后续批次 |
| T-5 | `presentationSlot` 注释手抄段名枚举 | **已完成**（`90dee19`） | 关闭 |
| T-6 | `applySiteOperations` 无入参校验 | **宽修已完成**（2026-09-13，`c07e740`+`0fa9b4b`）：`validateOperationShapes` 权威派生校验 + 生成出口闸门 + /draft 拒单条保其余 + 入口未知 op 断言；重放不过宽修（Q4），locale 窄修降级为防御断言（Q3） | 关闭 |
| T-7 | e2e 测试进程与 `next start` **连不同的库**（脑裂） | **已完成**（`81220d5`） | 关闭 |
| T-8 | 「e2e 全走 HTTP」（不再直接 import `lib/`） | **有意暂缓·2026-09-12 用户裁决** | 长期项 |
| T-9 | e2e 文件后端模式不可达 | **已正式降级为「仅 PG 后端」** | 关闭（降级） |
| T-10 | `JOBS_DIR` 按 cwd 冻结 + `SITECRAFT_DATA_ROOT` 部署配置面 | **未做**（只出方案，不实施） | 与 T-11 并案，等部署议题一起裁 |
| T-11 | `site-store` 的 `storageRoot` **模块级常量冻结**（cwd/env 在首次加载时固化） | **未做**（用户 2026-09-13 裁决：不废，禁本轮单修） | 与 T-10 并案，等部署议题一起裁 |
| T-12 | **没有删除站点的 API**——e2e 造的站只能留在库里 | **未做**（用户 2026-09-13 裁决：本轮不修） | 待排期 |
| T-13 | **前端生产鉴权未接入**——非 development 默认 strict，而前端一个访问头都不发 | **未做**（用户 2026-09-13 裁决：独立批次，插 B4 前） | 先出方案 |
| T-14 | **生产 CSP 只放行桥接脚本 nonce，模板自带内联脚本被拦 → 受影响模板生产预览白屏（间歇）** | **已修复（2026-09-14）**——旧实现 `948d4a8`／新实现「稳定观察版」`57adf7c`；两版判据均 `EMPTY 0/50`；**摘 skip 后全套 e2e 待补跑** | 见下 |
| T-15 | **全幅背景式 hero 图在点选链路不可达**——forge 类模板用户点不到首屏主视觉 | **未做**（用户 2026-09-13 裁决：独立条目） | 待排期 |
| T-16 | **跨用例状态污染 / 时序型偶发失败**：① `templates.spec.ts:190`（**证据已丢失**——第一次 3 连跑现场被覆盖）；② `generate-flow.spec.ts:283` desktop+mobile（**现场完整保留**：`test-results/run-1/` 下 error-context+快照，断言 `.recovering` 期望 3 实收 0；RUN1 红 / RUN2、RUN3 绿） | **待查·已移交 T-13 批** | **由红率数据定夺撤销或坐实**；两条单跑均未复现 |
| T-17 | **dev 口径模板内容出现可见 `[object Object]`**——header 品牌位与正文各一处 | **未做**（2026-09-13 复审新登记） | 见下 |
| T-18 | **`/draft` 的 `rejected` 字段前端未消费**——B3 新增的对用户可见通道，目前没有任何 UI 读它（`rejected` 会被静默忽略） | **未做**（用户 2026-09-13 裁决：**并入 B6 批一起排，别单开**） | B6 |
| T-26 | 商品导入**没有现成样例表格**，用户得去外部打听列名格式 | **已完成（2026-09-14，`5b65267`）**——弹窗内「下载样例表格」，表头从 `PRODUCT_COLUMN_ALIASES` 派生（军规 1），6 条单测 + 双向负向验证 | 已并入本批 |
| T-27 | **上传主图后「看不到回显」**——诊断已定，见下方专节 | **诊断已完成 · 未修**（用户 2026-09-14 裁决：并入 **B4b** 同文件作业） | 见下 |

**已知·有意暂缓（2026-09-12 用户裁决：本轮治理到「收口」为止，不追求门禁全建齐）**：
宽修（`applySiteOperations` 入口全面校验）· T-1 · T-3 · T-4 · T-8
· 债务文档阶段 B1（pre-commit）· B3（同值检测）· B4（gate-inventory）· 阶段 C
· Recipe 接 analyze · 配方 id/name 一致。

### T-7 · e2e 测试进程与 `next start` **连不同的库**（**已完成**）

**处置**（commit `81220d5`）：在 `playwright.config.ts` 里把测试进程的环境与
`serve.mjs` 给被测进程的那一份**同源化**——加载 `.env.local`→`.env` 补齐非连接类配置，
再用 `resolveServerEnv()` **覆盖连接串**，让两边指向同一个库；并加同库断言，
不一致就**当场报错**（而不是让断言以 UI 症状失败）。

⚠️ **第一次修是错的，实测才暴露**：只加载 `.env` 会让测试进程连里面的 5432、
被测服务连 compose 的 5433 → **修完仍然不同库**（`connect ECONNREFUSED 127.0.0.1:5432`）。
教训：**连接串必须由"e2e 实际起了哪个库"来定，不能由 `.env` 来定。**

**效果**：`workspace.spec.ts` 17/17 全绿；全套 e2e 由 96/10/2 → **99/7/2**，
差集恰为 T-7 相关的 3 条。

### T-9 · e2e 文件后端模式**不可达** → 正式降级为「仅 PG 后端」

三条路都试过、都失败，且**都不在 e2e 红线内可解**：

| 尝试 | 结果 |
|---|---|
| ① `next start` + env `NODE_ENV=development` | 被 `next start` 覆盖 → 被测服务 driver 仍是 `postgres` |
| ② `next start --require <preload>` 钉住 NODE_ENV | `next` CLI 不认该参数：`unknown option '--require'` |
| ③ `next dev` | 撞 `.next/dev/lock`：`Another next dev server is already running`（PID 26872，用户在跑的开发服务器） |

**根因**：三个 store 的判定是 `SITE_STORE === "postgres" || NODE_ENV === "production"`，
而 `next start` 必然把 `NODE_ENV` 设成 `production` → **文件后端在"生产形态"下不可达**。
绕开它要么改 `lib/`（三处判定或生产守卫），要么改 `next.config.*`（配独立 `distDir`
才能与在跑的 dev server 共存）——两者都在本批红线之外。

**处置**：门禁 3 **正式降级为「仅 PG 后端」**，不留半截。
`op-rename-roundtrip.spec.ts` 在文件模式下**显式 skip 并打印原因**（不是静默跳过）。
文件后端的往返覆盖由单元级承担：`tests/site-store-op-rename.test.ts`
（真实文件读写 + 归一化 + undo 重放 + 新名落盘）。

### T-7 · 原登记（历史，见上方「已完成」）

**现象**（实测，不是推理）：`e2e/specs/workspace.spec.ts:6` 直接
`import { commitOperations } from "../../lib/site-store"`，在 **Playwright 测试进程**里调用。
而那个进程里：

```
NODE_ENV = production          ← playwright 会设（与 next start 一致）
SITE_STORE = undefined         ← .env 没被 playwright 加载
DATABASE_URL 端口 = (未设置)    ← 同上
→ getSite 直接抛：DATABASE_URL 未配置，生产环境不会退回本地文件存储。
   at getPostgresSite (lib/site-store.ts:441:9)
```

**同时**，被测服务（`next start`）**会**加载 `.env`，连的是 `127.0.0.1:5432` 的 Postgres。

→ **两个进程连的是两个不同的库**。测试里 `await commitOperations(...)` 从未生效，
但因为它在 `test()` 体内是**未被等待的 rejection**（`expect(ai.status)` 拿到了 undefined
而不抛当前错误），失败以"页面说没有可撤销的 AI 修改"的形式出现，**根因被伪装成 UI 问题**。

**为什么是结构性的，不是改名造成的**：
这个 `await` 在改名**之前**就抛——连接在 `getSite()` 阶段就断了，
而 `getSite` 与 `commitOperations` **出自同一个 `lib/site-store.ts`**，
与 op 名没有任何关系。

**影响面**：`workspace.spec.ts` 的 2 条用例（`321`/`345`），
以及任何依赖"测试进程直接写库"的 e2e。其余 8 条失败与该模块无因果关系
（其中 7 条 spec 连 import 都没有）。

**处置意向**（需用户定，两条都有代价）：
1. **测试进程补 `.env` 加载**（`process.loadEnvFile` 或等价手段）——最小改动，
   但会让测试进程连**真实的 5432/5433 库**，与"e2e 不碰真实数据"的既有约定冲突；
2. **让 e2e 走 HTTP 而不是直接 import `lib/`**——结构上更正确
   （e2e 本就该测 HTTP 面），但要重写那两条用例的夹具方式。

**未做的原因**：两条路都涉及测试架构取向，属独立批次；且本轮 e2e 批次的临时红线
限定 diff 只允许出现在 `e2e/`、`scripts/`、`.env.example`、`docker-compose.yml`——
选项 1 需要动测试进程的启动形态，选项 2 要改既有 spec 的夹具，都不是能顺手夹带的。

### T-13 · 前端生产鉴权**未接入**：非 development 默认 strict，而前端一个访问头都不发

**不是读代码读出来的，是实测出来的**（2026-09-13，0.5=B2 写路由端到端测试时）。

`lib/request-context.ts:77-81` 的缺省规则是"非 `development` 一律 **strict**"，
而 strict 下 workspace / actor / role **三头缺任一即 401**（`:97`）。
**前端一个都不发**（`grep -rln "sitecraft-workspace-id" app components` → 0 处；
全仓库设置这些头的只有 `scripts/*.mjs` 与两条路由自己的转发），
也**没有任何中间层替它发**（无 `middleware.ts`、无中央 fetch 封装）。

**实测**（起真实服务，`SITECRAFT_ACCESS_MODE=strict` 写进 `.env.local`）：

```
无头 GET  /api/sites             -> 401
无头 POST /api/templates/from-url -> 401   ← 带齐三头则 201，链路本身正常
```

**影响面**：见 [`2026-09-13-production-auth-inventory.md`](2026-09-13-production-auth-inventory.md)
（穷举 23 个路由 × 全部前端调用点）。结论是**前端全部非公开读写**——
站点列表、工作台、生成页、线索页、导出页、模板库建站/生成，
合计 **22 个「端点 × 方法」在生产 strict 下必然 401**。

**用户裁决（2026-09-13）**：真实缺陷，非有意配置；**独立批次，插 B4 之前**。
**方向预警**：自助 SaaS 的用户手里**不该**有三个内部头——这大概率不是
"给前端补三行头"，而是**登录态 / 凭据签发**的设计问题。**先出方案**
（须含"维持现状 + 网关注头"这一备选），等拍板。

⚠️ **生产鉴权链断在两个独立环节**（结构性结论，2026-09-13）：

| # | 环节 | 表现 | 归属 |
|---|---|---|---|
| 1 | **前端不发头** | 所有非公开读写 401 | **T-13（本项）** |
| 2 | **后端转调丢头** | 两个模板路由转调登记时漏转发 workspace 头 → strict 下登记必 401 | **已修**（`de10d83`） |

**只通一环不算通**：T-13 的批次必须做**两端贯通验证**（前端拿到凭据 →
路由收到 → 转调带齐 → 登记成功），**不能只盯前端**。
只测前端"发出去了"，等于只测了一半——`de10d83` 那个缺陷正是藏在后半段。

**⚠️ 排查时踩过的坑（记录以免重走）**：`SITECRAFT_ACCESS_MODE` 放在
**shell 环境变量**里会被 `next.config.ts` 的 `loadEnvConfig` 覆盖，只有写进
**`.env.local`** 才生效。我据此误把一次 relaxed 下的 200 当成"strict 下鉴权被绕过"，
写进盘点初稿后复核才发现。**判严格态前先用一个已知需鉴权的端点自证 401。**

**⚠️ 更严重的一次失误（2026-09-13，已立为军规附则 A1「假实验」）**：
发现环节 2 之后，我做了个"对照实验"——在 **relaxed** 下跑通同一条链路拿到 201，
便判定"前缀判定作废"，**把一条正确的 P0 结论撤销了**，并扩散进本表与一个 commit。
**那个实验什么都证明不了**：relaxed 下根本不检查这三个头。后经三条独立取证
（路由入口打印 / 转调到达处打印 / 源码字节 grep）才纠回，并把附则 A1 立了起来。

### T-14 · 生产 CSP 只放行桥接 nonce → 模板自带内联脚本被拦 → 白屏

**发现路径**：0.6 修 `shadcn-pro-preview` 时，旧归因"抖动"被**证伪**
（实测 **5/5 稳定失败**），逐层取证到 CSP。

**机制**：`localPreviewCsp()`（`app/api/templates/[templateId]/preview/route.ts:35`）
在 **production** 下只给**桥接脚本**发 nonce，模板自带的内联脚本一律被 CSP 拦。
注释写明这是有意设计（"nothing template-shipped runs unverified"）。
而 e2e 跑 `next start` = production，故**这是生产形态的真实表现**。

**证据链**（实测，非推断）：

| 步骤 | 结果 |
|---|---|
| 直接开 `/api/templates/shadcn-landing2/preview`（**顶层**，非 iframe） | `{"h1":0,"sections":0}` |
| 工作台 iframe 内 | `{"h1":0,"sections":0}` |
| 浏览器 | `h1Count=0`、`sectionCount=0` |

→ `shadcn-landing2` 是 Next.js **导出站**：它的整棵 DOM 只存在于
`self.__next_f.push(...)` 的 **flight 脚本载荷**里，**HTML 里本来就没有可渲染的内容**。
CSP 拦住这些内联脚本 → 载荷永不执行 → **从头到尾什么都没有** → 白屏。

> ⚠️ **一处我先写错了、已更正**（2026-09-13）：
> 我最初写的是"服务端交付的 HTML 结构完好，是**运行时被清空**"，
> 依据是"静态文件里 `section=13`"。**那个测量是无效证据**——
> 我数的是 `<section>` **标签**，而它们**位于 `<script>` 的字符串载荷里**，
> 不是可渲染的 DOM 节点。顶层直开也是 0，正说明"内容从一开始就不存在"，
> 不是"先有后被清"。
> **结论方向不变**（生产预览白屏），但因果描述已按实测改正。
> 教训见 `AGENTS.md` 附则 A2。

**影响面（22 个基线模板已全量盘点，脚本 `e2e/scripts/probe-inline-scripts.ts`）**：

| 类 | 数量 | 模板 |
|---|---|---|
| **拦了会白屏**（需 JS 渲染） | **1** | **`shadcn-landing2`** |
| 有内联脚本但内容仍在静态 HTML | 17 | Astro 为主，内联多为增强 |
| 仅 JSON-LD（拦了无影响） | 4 | `landwind` / `fresh` / `shadcn-landing` / `nextjs-landing` |

> ⚠️ **这条清单把 T-13 批次的修复面钉死了**：不是"全局 CSP 契约重做"，
> 而是**1 个模板的 CSP 策略**（给该模板的内联脚本放行，或把它改成不需内联的产物形态）。
> 工作量按此估。

**当前处置**（2026-09-13 快速关账裁决，**修正了此前的 test.fail 形态**）：
三条 shadcn-landing2 实例一律 **`test.skip` + 注释**（`shadcn-pro-preview`、
`template-content-coverage` 的该实例、`template-language-bridge` 的该实例）；
同文件的 `forge` / `nextjs-landing` 实例**不隔离**。

> ~~`shadcn-pro-preview.spec.ts` 已按用户裁决改 `test.fail()` 显式隔离~~
> （2026-09-13 早先版本，**已被上方快速关账裁决取代**——间歇缺陷下该形态会随机报
> unexpected pass；保留此行仅为避免后人误读历史 commit `87c1ed1` 的注释。）

**为什么不用 `test.fail`**：它假设"这条路径必定失败"，靠"意外通过"逼人摘标记；
而**间歇缺陷（≈5%）会让它随机报 unexpected pass**——守卫自己变成随机红，
真信号被噪声淹没（军规 2 的反面：用错形态的门禁比没有更坏）。

**替代的拉力（人工绳）**：`probe-empty-rate.mjs` 收编进 `npm run test:e2e:strict`，
**EMPTY ≥ 1 即非零退出**。T-13 修复后：**先跑探针归零，再摘 skip**。
**禁止用"全套 e2e 绿"反推 T-14 已修**（104 条里 5% 空页大概率撞不上）。

> ⚠️ **入口侧的已知真相（2026-09-13 关账核验）**：`test:e2e:strict` 入口
> **此前从未真正跑起来过**（CLI 文件名参数不穿透 `testIgnore`；队列里的
> "8 passed"无法复现）。本批修好后**第一次真跑 = 8 passed (3.4s)**。
> 同族第 10 次登记见队列「执行发现」节。
> 另：T-13 批取 spec 结果需 `PROBE_OVERRIDE_REASON="<理由>"` 显式越过探针
> （**理由必填、原样入日志、T-13 后撤销、不得作为默认路径**）。

**T-14 修好后必做**：摘 `test.skip`；并**换掉没有判别力的断言**——
`heroHeight > 300` 在白屏时也"成立"（高度 0 时是更早的 `heroDisplay` 先红），
它区分不了"白屏"与"正常"，应换成有判别力的标志（如 hydration 完成的标志元素）。

**⚠️ 复审实测更正（2026-09-13 晚，附则 A1/A2 活体样本）**：上面那段因果描述
**是错的**——`section=13` 那些标签**确实在可渲染 DOM 里**，不在脚本载荷里。
实测（纯 HEAD 源码 + 全新构建，`next start`）：

| 状态 | 占比 | 稳定后 `body.innerText` | 服务端响应体（剔 `<script>`） |
|---|---|---|---|
| **OK** | 19/20 | 5465 字符、h1=1、section=13 | 100,869 字节（真内容） |
| **EMPTY** | **1/20** | **0 字符**、h1=0、section=0 | 同一个 100,869 字节（**内容在里面**） |

- **CSP 拦截（7 条）在两种态里都发生**——它是**必要条件，不是充分条件**；
  "拦了必白屏"的表述作废。
- **EMPTY 是间歇的**：同一构建、同一 URL、同浏览器，1/20 出现。
  "5/5 稳定失败"与"看到了内容"**都采样过不同的态**，各自都对、都不全。
- **A2 的"脚本载荷"判定作废**（本模板本轮构建）：EMPTY 态里内容**进了 DOM 又被移除**
  （EMPTY 时剔 script 后 DOM 只剩 897 字节，而响应体是 100,869 字节）；
  OK 态里 `section` 从来就在 DOM 里。**方向与原判相反**（"先有后被清"）。
- **测量姿势（写进 T-14 复验）**：`node e2e/scripts/probe-empty-rate.mjs 20`，
  **N≥20 冷加载**——"稳定性"是统计断言，**N=1 无论等多久都证不了**。
- **环境陷阱**：测 3210 前先 `wmic` 查进程命令行
  确认跑的是主仓，复审方曾测到残留的 worktree 进程。

### T-14 · 结案（2026-09-14，`948d4a8`）· **已修复**（水合快照兜底）

**机制（N=50 实测查清，两处旧判被推翻）**：

1. 服务端 HTML **含内容**（273KB）→ 内容**进了 DOM**；
2. 模板自带内联 flight payload 脚本被 **CSP 拦**（7 条违规）→ React 拿不到数据；
3. 水合后 React **清空容器** → body 只剩 8 个 `<script>` + 1 个 `<style>`。

**为什么两次误判**（都是"没量准"）：
- 首版守卫用 `main.innerHTML.trim()` ——真实白屏态里 innerHTML **非空**
  （那 8 个 script + 1 个 style），朴素判断直接放过；
- 旧实现**只在 `load` 时 capture** ——真实白屏**发生在 `load` 之前**，
  于是快照**永远采不到**有内容的状态。

**修法**：`capture()` 立即调用（不等 load）；判据改为 `contentEls(main) > 0`
（数内容元素，不数字符串）；`restore()` 触发收紧为「内容元素数塌缩到 0」才动。

**判据（条件必须一起写）**：`next start` 生产构建 + 10 次预热后 **N=50**：

| 状态 | 读数 |
|---|---|
| 修复前 | EMPTY **4/50** |
| 修复后 | EMPTY **0/50**、ERROR 0/50 |

探针**已自校准**（`e2e/scripts/calibrate-probe.mjs`）：坏样本下必须报 EMPTY，
故 0/50 有判别力（附则 A1）。**没校准过的"0/50"不构成证据。**

**常设回归网**：`e2e/specs/hydration-snapshot.spec.ts`（3 例）——
① 删子树坏样本（忠实复现真实剩余物）② 还原内容与原文一致 ③ **不得回滚合法编辑**。
四条 `test.skip` 已摘（`coverage-scan` / `shadcn-pro-preview` /
`template-content-coverage` / `template-language-bridge`）。

> ⚠️ **本条尚未完全关门**：摘 skip 后的**全套 e2e 未跑**——
> 并发会话（Session B）在制品占用工作区，构建跑不动。
> **补跑绿了才算关门**；在此之前**不得声称"T-14 全绿"**。

### T-14 · 判据时效性（2026-09-14，用户裁决 4 要求标注）

**已提交的两个版本，判据口径不同，不得混用**：

| 版本 | commit | 机制 | 判据（条件：`next start` 生产构建 + 10 次预热后 N=50） |
|---|---|---|---|
| **旧实现** | `948d4a8` | `restore` 一次即 `disconnect`（一次性） | 修复前 **4/50** → 修复后 **EMPTY 0/50** |
| **新实现**（稳定观察版） | `57adf7c` | 观察者活满 `WATCH_MS`、capture 按**文字量**判、`stableSince` 初始化 | **EMPTY 0/50**（重测） |

> **为什么会有第二版**：旧实现被**自己的门禁**抓出真缺陷——
> 门禁第 2 例红（起步有内容、清空后 9/20 没还原）。
> 三轮取证（`innerHTML` 金丝雀）定位到：桥在 194ms 抢在水合前还原，
> React 在 3179ms 水合时**再清一次**，而旧实现**只允许救一次**。
> 新实现改成"观察者活满窗口 + 绝不提前收工"。

**当前有效的判据是第二行（新实现）**。上表两行都保留，是因为
**撤销/替换结论时必须能看出"换的是什么口径"**（附则 A1 的同族要求）。

**三把锁**（用户裁决 3）：`e2e/specs/hydration-snapshot.spec.ts` 的
锁 A/B/C 各配一个坏样本，**均已拍红**（原文见 commit `57adf7c`）；
不注入坏样本时 6/6 全绿。**没有拍红过的门禁不算门禁**（军规 2）。

### T-17 · dev 口径模板内容出现**可见的 `[object Object]`**

**发现路径**：2026-09-13 复审 T-14 时，dev 口径（`next dev`，CSP 宽松、模板 JS 全跑）
下量可见叶子文本，量到两处。

| 位置 | 元素 | 坐标 |
|---|---|---|
| header 品牌位 | `<span>` | y=34 |
| 正文 | `<strong>` | y=2778 |

- `body.innerText` 头部形如 `"[object Object]\n产品方案\n产品中心…"`——品牌名被渲染成 `[object Object]`。
- **生产口径看不到**：CSP 拦掉模板 JS → 这段渲染路径根本不执行。
  → **T-14 一旦修好，本缺陷会在生产跟着暴露**，故必须现在登记、并入 T-13 批。
- 定性：序列化缺陷（某个对象被直接当文本渲染），**独立于 T-14**。

### T-15 · 全幅背景式 hero 图在点选链路**不可达**

**发现路径**：0.6 修 `tmp-asset.spec.ts` 超时（旧归因"等待条件写错或页面慢"，
**两条都不是**）时，用探针量出来的。

**现象**：`forge` 的首屏主视觉是**全幅背景图**，文字层整片压在上面。
`elementFromPoint` 在图上的**每一个采样点**都返回覆盖层（`DIV` / `H1`），
**img 本身永远拿不到点击** → 用户**点不到、也就换不了**首屏主视觉。

**工作台里的实测**（可复现，证据随代码保留）：

```bash
npx playwright test e2e/specs/clickable-asset-probe.spec.ts   # 打印 WORKSPACE-CLICKABLE
```

| 模板 | 可点比例 | 遮挡 |
|---|---|---|
| moon / kindred / tailwind-landing / atlas / astro-starter | 100% | — |
| lonestone | 75% | 边缘 25% 被 null 覆盖 |
| **forge** | **0%** | `DIV,H1` |
| landwind / foxi / yukina / fresh / screwfast | 选择器在工作台里无命中或命中 0×0 | — |

⚠️ **裸预览页的数字不算数**：`landwind` 在裸预览是 100%，进工作台却不可用。
原 `tmp-asset.spec.ts` 正是只看了裸预览才挑错模板。

> **相关探针归属**：`shadcn-diag2.spec.ts` / `shadcn-diag3.spec.ts` / `flash-diag.spec.ts`
> 出自 **`7d638af`（09-12「契约回归测试与 e2e 断言扩充」）**，**不是**本轮新增。
> 其中 diag2/diag3 是定位 T-14 的关键证据（顶层直开 vs iframe 内），
> `shadcn-diag2` 的"顶层直开也是 0"一举证伪了"运行时空"的错误因果。

**为什么桥接的兜底没救回来**：`preview/route.ts:1354` 确实有一层兜底
（`event.target.closest('h1,p,a,button,h2,h3')` 为 null 时走 `resolveAssetSlotForNode`），
但用户点击时 `elementFromPoint` 命中的**正是**那些文字节点，所以兜底**测不到**。

**这是一条真实产品缺口，不是坏 spec**：坏 spec（选了不可点的模板）把它挖了出来。
处置另行排期；`asset-select.spec.ts` 的文件头已留指向本条的注释，**不许随改写蒸发**。

**连带澄清**：`forge` 的 `localPath` **本来就是 `small-bis`**
（`lib/template-catalog.ts:57-65`，id 与目录名无关）——不是命名错误。

### T-1 · `faq` 的 `add_card` 无容量校验（用户裁决第 3 条：登记待排期）
`capacitySections = ["features", "services"]`（`lib/site-operations.ts`），
**不含 `faq`**；而 `cardSections` 含 `faq`。

后果：`faq` 的 `add_card` **不走模板容量校验**（既无 `presentation` 查表，也不在
`overCapacity` 投影范围内）。它的条数上限目前只由 `siteDraftSchema` 的
`MAX_COLLECTION_ITEMS` 兜底——而该兜底是**schema 层**，超了会让读取失败
（即本轮冲突 #8 的同款危害路径），**不是写入期拦截**。

修法待定（补 `faq` 的 presentation 声明？还是把 `capacitySections` 与 `cardSections`
的关系定义清楚？）。**由用户后续决定排期。**

### T-2 · `products` 契约两层不一致（只登记，不处理）

`slots` 层 22/22 声明 `products` 且 `required: true`；`presentation` 层只有 17/22 声明。
用户裁决：**只登记不处理**。

### T-3 · 枚举中文释义维护了**三套**（阶段 2 未做，补登记）

同一批枚举（`BUSINESS_TYPES` / `AUDIENCES` / `TONES`）的中文释义写在**三个地方**：

| 位置 | 内容 |
|---|---|
| `lib/site-intent.ts` 的 `buildIntentPrompt` 内 `businessExamples`/`audienceExamples`/`toneExamples` | 键 + 中文释义 |
| `lib/site-generator.ts:145-167` 的 `businessLabel`/`audienceLabel`/`toneLabel` | **同一批键的第二份中文释义** |
| `lib/site-intent.ts:19-21` 的枚举常量本体 | 只有键，没有释义 |

**处置意向**：把 label 映射**收口到 intent schema 派生**——在枚举常量旁挂一份
`Record<EnumValue, string>` 作为权威释义表，prompt 与 label 都从它读。

**本轮未做的原因**：阶段 2 的 prompt 收口聚焦在**字段名与枚举成员**
（能机械断言的那部分），"释义文本"是散文、无法靠"是否出现"来断言同源，
合并进来会扩大改动面且缺少验收手段，应单独一批做。

### T-4 · `template-catalog.ts` 的 `guardrails` 数值规则（阶段 2 未做，补登记）

`guardrails` 里有手写数值规则（"标题不超过两行""最多突出三类产品"
"每个功能点不超过两句""标题不超过八个中文字或六个英文词" 等），
经 `ai-provider.ts` 进入 chat 提示词。

**核实状态：未逐条核实**（阶段 2 只收了字段名与枚举成员，没动这些散文式规则）。

**处置意向**：逐条核实它与槽位契约校验器是否一致——
一致或无害的**归入 prompt 同源**（改为可派生的表述）；与契约冲突的**删除**
（留着就是第二个真相源，正是本轮反复出事的形态）。

**本轮未做的原因**：同 T-3，属散文规则、缺机械验收手段，且需要逐条对照
manifest 的真实容量，是独立的一批核实工作。

### T-5 · `presentationSlot` 的注释手抄了段名枚举（**已完成**）

`lib/template-manifests/types.ts` 的 `presentationSlot` 注释写的是
`about|features|services|products|contact`，**漏了 `hero`**（未手写 `presentation`
的 5 个模板走 `defaultPresentation()`，含 hero 共七值）。

处置：按附则 2 改为指向 `getTemplatePresentation()` 的引用，不再抄第二份。
见 commit `90dee19`。

### T-6 · `applySiteOperations` **没有入参校验**，坏操作会静默写坏草稿

**不是从代码读出来的，是实测出来的**（2026-09-12，阶段 4 调研）：

把 PG 里 8 条**缺 `locale`** 的历史 `update_card` 喂给今天的代码：

```
siteOperationSchema.safeParse(corrupt).success = false    ← 读不进来
applySiteOperations **没有抛错**，changed = true           ← 却照写
写后的 item: { "title": { "zh": "...", "en": "...", "undefined": "新标题" } }
```

根因：`applySiteOperations` 全文件**零处** `siteOperationSchema.safeParse`，
`update_card` 分支直接 `item.title[operation.locale] = ...`，
而 `locale` 为 `undefined` 时 **JS 会把它转成字符串 `"undefined"` 当键**。

**为什么现在没炸**：`draft` 读取会过 `normalizeDraft` → `siteDraftSchema.safeParse`，
而 **Zod 默认剥掉未知键**（实测 `{zh,en,undefined}` → `{zh,en}`，success **true**），
所以污染**被无声抹掉**——不是修好了，是看不见了。

**为什么仍然要修**：这个洞**不是那 8 条数据造成的**，
是"写入期没有拦截"造成的。任何能构造出缺字段操作的路径都能触发。
与冲突 #8 同构（"schema 层兜底不算写入期拦截"）。

### 更新（2026-09-12，阶段 4 实施后）：**这个洞是改名自己激活的**

窄修（commit `46eb29f`）落地时踩出一个必须点名的事实：

> **改名 + 读取归一化，把 8 条历史从"走不进来"变成了"走得进来"。**

- **改名之前**：那 8 条是旧名 `update_card`，而代码判的是 `operation.op === "update_item"`
  → 判别式不匹配 → 整条操作被**静默忽略**（`changed = false`），看着"没问题"。
- **改名 + 归一化之后**：旧名被映射成新名，**正好走进**那个分支 → 真的写坏草稿。

**红样本必须用新名构造**：第一版用了旧名，测试**假绿**——
这本身就是一次"假门禁"，记录在此以免重复踩。

**已做的窄修**（`update_item` 的 `locale` 守卫，最保守的一种）：
不抛错（undo/重放路径不该让整站失败）、不猜 locale（猜 `zh` 会**改错语言**）、
跳过并每批报告一次。测试见 `tests/site-operations-locale-guard.test.ts`。

**仍未做的（宽修）**：在 `applySiteOperations` 入口逐条做形状校验，不合法**抛可读错误**。
窄修只堵了**已知会坏的那一处**；只要入口没有校验，同类形态仍可能从别的分支进来。
**风险**：会改变现有行为（"能跑但错"的输入变抛错），
**先跑一遍评估对 691 个测试的影响面再决定**。
方案见 `docs/plans/2026-09-12-phase4-rename-and-compat-design.md` §四。
**由用户决定排期。**

---

## 四、附则

### 附则 1 · 注入提示词/脚本的字符串**禁用反引号**

**背景**：2026-09-12 一轮内同一个坑踩了**五次**——在"会被注入进模板页面的字符串"
（模板字面量）里写反引号，导致外层字符串提前终止。

最典型一次：给 `preview/route.ts` 的表单注入代码写注释时，用 Markdown 反引号
包裹标识符（``必须用 `templateUiCopy[locale]` ``），反引号直接把字符串切断，
后半段注释变成 JS 代码，`tsc` 报一串 `TS1005`。更早几次更隐蔽——被**偶数个**
反引号切成"看起来合法"的样子，**编译通过但运行时是坏的**。

**规则**：在注入用的模板字面量内部，注释与文本里写标识符时**不要用反引号**，
改用「」或裸写。

**防线**（不靠记性）：`tests/no-backtick-in-injection.test.ts` 按区域扫描
`preview/route.ts` 的 bridgeScript（第 93–1424 行），区内出现反引号即失败，
并精确报出行号。该测试自带锚点自检与检查器自检（本项目已吃过三次"假门禁"的亏）。

修改那段代码后若行号漂移，测试会失败并提示更新锚点——**这是有意的**，
防止检查悄悄空转。

### 附则 2 · 契约只在**一处**定义

同一个数字/枚举/字段名，只允许有一个权威来源；其余位置必须**读取它**而不是重写它。
2026-09-12 修掉的四处长度副本、`MAX_LOGO_ITEMS` vs `.max(24)`、
`index.max(12)` vs `MAX_COLLECTION_ITEMS` 都是反例。

判断方法：改掉权威来源后，**其他地方应当自动跟着变**。如果不会，那就是两处定义。

### 附则 3 · 门禁必须**会失败**

新增任何检查（测试/探针/门禁）时，必须同时证明它**能拦下真实缺陷**——
否则它是"假门禁"。本项目已吃过三次亏：

| 假门禁 | 症状 |
|---|---|
| `coverage-scan.spec.ts` | 零断言且被 `testIgnore` 排除，模板门禁实际不存在 |
| `probe-lead-form.mjs` | 逻辑正确但不设退出码，遇到异常直接崩溃退出（看着像环境问题） |
| `add_card` 容量门 | 单测喂的 key 与生产传的不是同一个形态，**测试绿但门从没生效** |

**做法**：负向验证——先把缺陷人为还原，确认门禁报红且信息可读，再修复。
本轮三次修复都走了这条路（先红 → 后绿），报告里附有原文。

### 附则 4 · 裁决内的活没做完，**必须点名说"没做、为什么"**

**背景**：2026-09-12 阶段 2，用户裁决里含"guardrails 核实并入阶段 2"一条。
我做的是**部分**——收了字段名与枚举成员，**没有**逐条核实 guardrails 的散文规则。
但汇报名单里**没有点出这件事**，只在别处提了一句"归阶段 2"就滑过去了，
是用户在验收时翻出来要求补账的。

**危害**：这比"做错了"更难发现。做错了至少在 diff 里看得见；
**没做而没提**，下一次翻到它时已经隔了好几轮，上下文全丢。

**规则**：
1. 汇报时对裁决逐条对照，每条明确给出**做完了 / 没做**；
2. 没做的必须写清**为什么没做**（原因可以是"判断该独立成批""缺验收手段"
   "被更高优先级打断"——但**不能是沉默**）；
3. 没做的**当场登记进待办区**（本文第三节），附处置意向，而不是口头带过。

**判断标准**：如果用户需要靠"自己再翻一遍裁决"才能发现某条没做，那就是违反本附则。

### 附则 5 · 落盘的旧 op 名**不具取证价值**，取证看 `generation_records`

**背景**：2026-09-12 阶段 4 引入读取归一化后，出现了一个需要写死的口径问题——
"历史里那些 `update_card` 到底还算不算事实？以后查历史该看哪个？"

**规则**：

1. **`sitecraft_sites.history` / 文件后端的 `history` 里的 op 名，是"当时的编码"，不是"当时的事实"。**
   它们会被读取归一化改写（见下），且一次写入会把整段历史一并归一。
   所以**不要拿它做任何取证**——它既可能保留旧名，也可能已被归一，取决于该站点是否被写过。
2. **要取证就查 `generation_records`**：它记录的是**每次生成尝试**的存证
   （`operations` + `provenance`），**写入后只读回显、不参与 undo/重放**，
   所以旧名在里面是**历史事实的一部分**，不会也不该被归一化。
3. 因此 `generation_records` 那 129 处旧名**永久留在范围内之外**——不是"待处理"，
   是"**不该处理**"。

**连带收敛是特性，不是缺陷**（用户裁决 ①，2026-09-12）：
`commitOperations` 读到的是归一化后的 record，落盘时把整份 `history` 一起写回，
于是**一次写入会把整段历史一并归一**。接受它，理由：
- 它让兼容期**随写入自然收敛**，不需要单独跑迁移；
- 归一化是**幂等**的（`update_item` 不会被二次映射），重复执行无副作用；
- 代价是"读取时改写落盘"——用上面第 1 条把它定性清楚即可。

**三道护栏**（缺一条都不成立）：
- a) 别名表 **append-only 快照测试**（`tests/legacy-op-names.test.ts`）——键只增不减、既有值不变；
- b) 本附则（取证看 `generation_records`，不要看 history 的 op 名）；
- c) 方案 §2.2「写入不回写历史」那句**已就地改正**。

### T-19 · `core.autocrlf=true` 且**无 `.gitattributes`**——CRLF 已进中央历史

**发现路径**：2026-09-13 B4 第六刀收口复核时，发现工作区文件带 CRLF（1393 个），
而 `git add` 提交的是 LF blob；继续查发现**已入库的 blob 里也带着 CRLF**：

```
app/workspace/page.tsx                             CRLF=1393
lib/template-preview-bridge.ts                     CRLF=1377
app/api/templates/[templateId]/preview/route.ts    CRLF=164
```

**根因**：全局 `core.autocrlf=true`，仓库**没有 `.gitattributes` 兜底**，
所以 CRLF 被写进对象库。任何在 Linux/CI 上 checkout 的机器都会拿到 CRLF。

**已实测：不影响反引号门禁**——JS 的 `$` 分隔符容忍行尾 `\r`，
门禁的 `assert.match(lines[n], /^<\/script>`;/)` 在 CRLF 行上**仍然匹配**。
（若将来有人给该正则加 `m` 标志或改用更严格的行尾语义，**这条会变**。）

**处置：登记不排期**（用户 2026-09-13 裁决 3）。并入 B7/T-13 部署议题。

**不做的理由（用户裁决原文）**：归一化会产生**全量 diff**，
**毒化当前字节基线与 blame**——B4 刚建立的字节曲线、以及每一刀的逐字比对证据，
都会因为一次全仓库行尾重写而失去可比性。

**将来若做，必须**：① 单独一批；② 与其他任何改动**零重叠**；
③ 做之前先冻结并归档当前字节基线。

### B4b · workspace 跨面板状态所有权收拢（**新批次，未开工**）

**登记时间**：2026-09-13，B4 收口时由用户裁决 2 立项。

**问题**：`app/workspace/page.tsx` 73,813 字节里，UI 只占约 14.6KB，
但它与 **13 个散在父级的 setter** 缠在一起：

| 状态 | 写者 | 跨面板？ |
|---|---|---|
| `qualityFocus` | `publishSite:1076`（父级发布回调） | **是** |
| `editHint` | 父级 451/484/505/1013 + 预览块 1325 | **是** |
| `partialNotice` | 父级 URL 解析 268 | **是** |
| `showGuide` | 父级 URL 解析 267 | **是** |
| `pendingFactConfirm` / `factsConfirmed` | `publishSite:1059/1120` + 页头工具栏内 | **是** |
| `assetDialog` | 父级 483 + 预览块 1325 | **是** |
| `regenerateDialog` | 父级 581 + 页头工具栏内 | **是** |
| `device` / `locale` / `editMode` | 全部在页头工具栏内 | **否（纯）** |

**后果**：页头工具栏（4.9KB）与 `<main>` 预览面板（9.7KB）**搬不动**——
搬了就要挪状态所有者或加同步胶水，**两条都是 B4 的红线**。

**处置意向**：用 `useReducer` 或 context 把上述状态收拢成**单一所有者**，
**先设计后实施、独立验收**。这是重构不是搬家，B4 的红线在本批不适用。

**排期**：**已降级至结项后新迭代**（用户 2026-09-14 裁决 2：移出关键路径）。

> ⚠️ **本批完成后必须回收 `X-1` 豁免**——B6 已用「独立组件 + 2 行挂载」
> 先落地（见 X-1），那个豁免的前提就是"workspace 还拆不动"。
> B4b 做完后前提消失，**豁免必须回收**。

**连带顺延**：**D-2 / D-3 随本批移出关键路径**（用户 2026-09-14 裁决 2）——
两者都要往 `workspace/page.tsx` 加新 UI，同样被军规 5 挡住。
结项报告须如实写「**因军规 5 与 B4b 降级顺延，非能力缺口**」。
D 的产品决策题（截图链路适配 / 配方补全）留作**开放问题**，待用户定夺。

**与 T-6 / B3 的区别**：T-6 管的是**操作入参校验**（数据层）；本项管的是

**前端状态归属**（视图层）。两码事。

### T-27 · 上传主图后「看不到回显」（**诊断已定 · 未修 · 并入 B4b**）

**登记**：2026-09-14，会话 B。编号沿用 `docs/plans/2026-09-14-ux-feedback-batch.md`
的批次编号（**不是**本表 T-19/T-20 那条序列）。

**用户报告**：商品主图上传后没有即时回显、去向不可见。

**诊断结论（先证明"每一环都通"，再定位到"看不见"）**：

| 环节 | 证据 | 判定 |
|---|---|---|
| 上传 API 返回 URL | `app/api/product-images/route.ts:38-43` | ✅ 通 |
| URL 落草稿 | `applyImageToProduct` → `saveOperations([{op:"set_product_image"}])` → `lib/site-operations.ts:770-780` 写 `product.image` | ✅ 通 |
| 回灌前端 | `saveOperations` → `adoptSnapshot`（`app/workspace/page.tsx:251`）`setDraft(normalizeDraft(...))` | ✅ 通 |
| 渲染缩略图 | `components/product-import-dialog.tsx:100` `<span style={{backgroundImage:url(...)}}>` | ⚠️ **三处叠加** |

**因此：不是"没存"，是"看不见"。** 三处叠加（按可疑度排序）：

1. **状态信号不完整 —— 触发静默丢弃（最可疑）**：
   `product-image-upload` 的 `<input type="file">` 是**全局禁用**的
   （`product-import-dialog.tsx:109` `disabled={productImageBusy !== null}`），
   但**文案只看自己那一行**（`:104` `productImageBusy === product.sku ? "上传中…" : …`）。
   → A 行上传期间，**B 行的按钮被禁用却仍显示「上传」**（用户看不出为什么点不动）。
   此时用户点 B 行的 `<label>`：浏览器**静默丢弃**文件选择（禁用的 input 不派发 `change`），
   `onUploadImage` 永不触发 → 现象正是「传了没反应」。
   ⚠️ 依赖浏览器在禁用 input 上的行为，**未经实测**，故列为"最可疑"而非"已确认"。
2. **缩略图默认 `background-repeat: repeat`**：`.product-image-thumb`
   （`app/globals.css:485`）设了 `background-size: cover` 但**没设 `no-repeat`**。
   CSV 填的是**外部图片 URL**（常非正方形），当该外部站点不可达时
   （**同 T-21 的境外资源问题**）→ 在 32×32 方格里绘成重复花屏，
   极易被当成"上传坏了"。
3. 32×32 对"主图"而言太小；成功/失败**没有文字**（只有按钮文案）。

**处置**：**修复并入 B4b**（同 `workspace/page.tsx` 文件作业）——
用户 2026-09-14 裁决：根因若在该文件，禁单修（军规 5）。

**可安全单修的部分**（在边界内的 `components/product-import-dialog.tsx`）：
① 修文案一致性（禁用行显示一致的忙碌态）；② `.product-image-thumb` 补 `background-repeat: no-repeat`。

**复现步骤（供 B4b 验收）**：
1. 工作台 → 商品导入弹窗 → 导入 ≥2 个商品的表格；
2. 给第 1 行上传主图（成功，即可看到缩略图）；
3. 上传期间**立即**去点第 2 行的「上传」按钮 —— 观察它是否**显示「上传」却无响应**；
4. 换用 **CSV 里填外部 URL** 的商品（非本地上传），观察 32×32 缩略图是否绘成重复花屏。

**与 T-21 的关系**：现象 2 与 T-21 同源（外部图片资源不可达）；两者应一并考虑。

### T-20 · 手起 `next start` 会静默使用**过期构建**（本次两次咬到）

**发现路径**：2026-09-14 B5 拆块期间，两次结论被推翻，根因相同。

**机制**：`e2e/scripts/serve.mjs` 有构建新鲜度检查（`needsBuild()`：比对
`.next/BUILD_ID` 的 mtime 与源码最新 mtime，过期则自动 `next build`）。
**直接 `npx next start` 绕过它**——服务照常起来、页面照常能开，**没有任何提示**。

**两次咬到的实例**：

1. **假红**：采集"真机叙事样张"只拿到 1 条文案变化，我据此报"生产构建下行为不同"。
   实际是过期构建。经 `serve.mjs` 重建后拿到 **8 条**。
2. **假绿**：坏样本（整棵 `data-template-carousel` 子树被吞）注入后，
   我用 `PW_REUSE_EXISTING_SERVER=1` 复用旧服务重测，**门禁全绿**——
   跑的是坏样本之前的构建。重建后立刻红。

**判定口诀**：**改了源码之后，凡是没有触发 `Creating an optimized production build`
的 e2e 跑动，其结论一律无效。**

**做法**：
- 不要手起 `next start`；用 `node e2e/scripts/serve.mjs`；
- 复用已有服务（`PW_REUSE_EXISTING_SERVER=1`）**只允许**在"源码自上次构建后未变"时使用；
- 汇报里出现"绿/红"时，先确认这轮跑动的构建时间戳 **晚于**被测源码的修改时间。

**与 T-7 / 附则 A1 同族**：都是"先证明被测对象是当前代码，再拿结果当结论"。

### S-1 · 结构回归网首版是**假门禁**（只断言容器，抓不住子树被吞）

**发现路径**：2026-09-14，为 B5 拆块补的 `streaming-presence.spec.ts`
「拆分后各 step 视图仍在正确时机出现」。

**首版断言**：`.generate-confirm` 可见 + "用此模板生成站点内容"按钮可见。

**实测结果**：构造坏样本删掉 `data-template-carousel` 整棵子树
（158 行 / **9,833 字节**），**`tsc` 全绿、首版断言也全绿**——
因为那个按钮在轮播**之外**。**那条"回归网"是假门禁。**

**修法**：把断言从"容器存在"改成"**断言被保护的那棵子树的结构锚点**"——
`[data-template-carousel]` 可见 + `[data-template-card]` 计数 3 +
`[data-template-hero-preview]` 可见。修后同一坏样本**立刻红**
（`Expected: 3 / Received: 0`），还原后绿。

**教训（写进方法）**：**断言容器存在 ≠ 断言内容存在。**
拆块类改动最易丢的是**块内部的子树**，而容器与"主要按钮"往往在子树之外，
**它们恰好是最不容易被删掉的东西**——拿它们当门禁等于没测。

**同族**：与军规 2（门禁必须会失败）、附则 A2（数节点前先证明在可渲染 DOM 里）
一脉：**先证明这条断言抓得住要抓的东西，再拿它当证据。**

### M-1 · 汇报里的字节数**一律用 blob/LF 口径**（2026-09-14 立，同类错误第四次）

> **`git cat-file -p <sha>:<path> | wc -c` 是唯一可入结论的口径。
> 工作区 `wc -c`（CRLF）**一律不得出现在汇报里**。**

**为什么**：本仓库 `core.autocrlf=true` 且无 `.gitattributes`（见 T-19），
工作区文件**一律带 CRLF**，每个 `\n` 多一个 `\r`。
文件越大、行越多，两个口径差得越远。

**四次同类错误的记录**：

| # | 场合 | 报出的数 | 实际（blob） | 差 |
|---|---|---|---|---|
| 1 | B4 中期 | workspace 91,757 → 75,206 | 80,954 → 73,813 | ~15% |
| 2 | B4 终报 | 起点 80,954 | 90,209（起点取错提交） | — |
| 3 | B4 终报表 | 串行错行 | 见 B4 终报 ⑦ 节 | — |
| 4 | **B5 终报** | **49,223 / B5-3 +1,827** | **48,377 / +490** | 846 字节 |

**根因**：`wc -c` 打在工作区文件上最顺手，而工作区**永远是 CRLF**。

**做法**：
1. 汇报里出现字节数之前，先跑 `git cat-file -p HEAD:<path> | wc -c`；
2. 若必须用工作区数字，**归一化后**再报（`newline=''` 读入、`\r\n`→`\n`）；
3. 逐 commit 的字节曲线**一律用 `git cat-file`**，且**起点要 `git rev-parse` 确认 blob 同一性**。

**与既有纪律的关系**：
- 关联 **T-19**（CRLF 进历史的根因）；
- 它在「口径更正本身也要过复核」的伞下——但**第四次了**，故**单独成条、升格为硬规矩**。

### X-1 · 军规 5 显式豁免：B6「重生成此板块」入口（2026-09-14 用户裁决）

**军规 5**：巨型文件（`preview/route.ts` / `workspace/page.tsx` / `generate/page.tsx`）
拒收新代码，先拆子模块。

**本次豁免**：B6 把「重生成此板块」做成独立组件
`components/regenerate-section-button.tsx`，
`app/workspace/page.tsx` 侧**只增 2 行**：

- 1 行 `import`
- 1 行挂载（原 8 行内联按钮被它替换）

**豁免成立的三条理由**（用户裁决原文）：

1. **增量 2 行**——不构成"往巨型文件加代码"；
2. **能力已存在**——局部重生成链路（`regenerateSectionOperations` →
   `POST /api/sites/[id]/generate` 的 `regenerate` step → SSE）早已打通，
   `submitRegenerate` 也在，本次**没写任何新逻辑**；
3. **新代码 100% 在子模块内**——映射规则也不复制（`sectionFromTarget` 由父级传入，
   遵附则 2）。

⚠️ **不许拿这条当先例给别的批次开口子。**
**回收条件**：**B4b 完成后回收此豁免**（届时 workspace 已可正常拆装）。

> 净效果其实**是负的**：8 行内联 → 1 行挂载（页面侧 −7 行），
> 省下的逻辑全在新组件里。豁免只是把"新增代码在页面里"这件事说清楚。
