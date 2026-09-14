<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 契约军规（2026-09-12 立，逐条来自本轮付过学费的债）

1. **禁止手抄**：字段名/枚举值/容量/长度数字必须从权威源派生（`site-document.ts` 的 schema、`SLOT_MAX_LENGTH`、`sectionKeys`、`cardSections`、`LEGACY_OPERATION_NAMES`）。找不到派生路径就停下问，不许抄。→ 门禁 B2 手抄检测
2. **新检查必须证明会失败**：先注入坏样本拍红、再修复拍绿，原文贴进 commit。→ glossary 附则 3
3. 注入用字符串（prompt / 页面脚本模板字面量）内**禁用反引号**。→ `no-backtick-in-injection.test.ts`
4. **批量替换**（sed/正则）先列撞名与范围，改后比对行为；**`tsc` 全绿不算证据**（本轮 sed 撞名，tsc 未报）。→ 肉眼过 diff
5. **巨型文件拒收新代码**（`preview/route.ts`、`workspace/page.tsx`、`generate/page.tsx`）：先拆子模块。→ 改前看行数
6. 新增操作名/协议串：与**别名表 + append-only 快照测试同 commit** 登记。→ `legacy-op-names.test.ts`
7. 来不及修的：登记 glossary 待办区 `T-x` 并写处置意向，**禁止口头挂账**。→ 汇报时逐条对照裁决
8. **改名前先问"这是来源名还是目标名"**：映射表的键是历史值，盲替换会让兼容层静默变空操作且测试全绿。
9. **`presentation.slot` ≠ `slot`**：前者是裸段名（`presentationSlot`），后者是 DOM 点分路径；混用会静默失效（本轮 P0）。→ 同名不同义第 1 组
10. **e2e 失败先查环境态**（测试进程与被测服务是否同库/同端口），再查业务。→ `playwright.config.ts` 同库断言
11. **未 `await` 的 rejection 会伪装成 UI 失败**：涉及直连库的 e2e 步骤必须 `await` 并显式失败。

> 产品与三条建站链路的口径，见 [`docs/PRODUCT-BASELINE.md`](docs/PRODUCT-BASELINE.md)——**它与旧设计文档冲突时以它为准**。

## 附则 A1 · 假实验（2026-09-13 立，与军规 2「假门禁」同族）

**无效实验不能用来撤销结论。**

> **确立或撤销任何结论之前，先回答：这个实验在什么条件下会给出不同结果？**
> 答不上来，就说明它什么都没证明——无论它给出的是"通过"还是"失败"。

### 实例（本轮真事）

写路由测试时发现：两条模板路由转调登记接口时**漏转发 `x-sitecraft-workspace-id`**，
导致生产默认的 strict 态下登记必然 401。结论正确。

随后我做了个"对照实验"：在 **relaxed** 下把同一条链路跑通，拿到 **201**，
于是判定"前缀判定作废，是我的测试夹具的头没带对"，**撤掉了正确结论**
并写进了文档。

**那个实验什么都不能证明**：`resolveAccessContext` 在 relaxed 下**根本不检查**
这三个头（缺了会回落到 `DEFAULT_WORKSPACE_ID`）。也就是说，
"relaxed 下 201"与"头有没有被转发"**完全无关**——它在两种情况下都会给出 201。

**代价**：一条真的 P0 被自己撤销，并扩散进 glossary 与一个 commit；
后经三条独立取证（路由入口打印 / 转调到达处打印 / 源码字节 grep）才纠回来。

### 判定清单（撤销结论前逐条过）

1. **这个实验能证伪结论吗？** 不能证伪的实验不能用来撤销它。
2. **实验条件与结论的条件一致吗？** 结论说的是 strict，实验跑的是 relaxed——
   那就是两个条件。
3. **"通过"是结论的证据，还是与结论无关的旁证？** 旁证只说明"还有别的路走得通"。
4. **我是在解释数据，还是在解释我希望看到的结果？** 反常的"成功"要先当成
   疑似假绿处理。

### 与军规 2 的关系

军规 2 管"检查不会失败就是假门禁"；本附则管"实验不会失败/不会随假设变化，
就是假实验"。两者同族：**都要求先证明"该红的时候真的会红"**。
本轮两次自我纠正（先撤错、再纠撤错）说明证据链在起作用——**保持取证习惯，
但先把"这个实验有没有分辨力"问在前面**。

## 附则 A2 · 数节点前先证明它在**可渲染 DOM** 里（2026-09-13 立）

**"静态 HTML 里有 N 个 `<section>`" 这类测量，不过下面这一关就是无效证据。**

> 数任何节点之前先回答：**这个节点在可渲染 DOM 里，还是在某个 `<script>` 的
> 字符串载荷里？**

### 实例（本轮真事）

排查 T-14（生产 CSP 白屏）时，我用 `grep -c "<section"` 量静态文件，得到
"h1=1、section=13、结构完好"，据此写下结论：

> ~~"服务端交付的 HTML 结构完好，是运行时被清空的。"~~

**这是错的。** `shadcn-landing2` 是 Next.js 导出站，那些 `<section>` 全在
`self.__next_f.push([1, "..."])` 的**字符串载荷**里——**HTML 里本来就没有可渲染的内容**。
决定性反证来自 `shadcn-diag2`：**顶层直开**预览页同样是 `{"h1":0,"sections":0}`。
若是"运行时被清空"，顶层直开不该也是 0。

### 为什么会骗过人

`<script>` 里的字符串**长得和 HTML 一模一样**，`grep`/正则完全分不出来。
而两种测量的结论**方向相反**：

| 载荷内 | 可渲染 DOM 内 |
|---|---|
| "内容从一开始就不存在" | "内容先存在、后被删除" |
| 修法是"让它能执行" | 修法是"找出谁删的" |

### 做法

1. 用**解析器**（`page.evaluate` → `document.querySelectorAll`）而不是正则；
2. 校验环境要能反映**真实渲染**（e2e 的浏览器、或至少剔除 `<script>` 内容后再数）；
3. 交叉验证：**顶层直开**与 **iframe 内**应给出一致结论，不一致就是有环节在改 DOM。

**与军规 2 / 附则 A1 同族**：都是"先证明测量有效，再拿它当证据"。


## 附则 A3 · 改源码后未触发重建的 e2e 结论**一律无效**（2026-09-13 立）

**这是本项目第三次被"假绿/假红"咬到，前两次是军规 2（假门禁）与附则 A1（假实验）。**

> **改源码之后，凡没有触发 `Creating an optimized production build` 的 e2e 跑动，
> 其结论一律无效——无论它给出的是"通过"还是"失败"。**

### 实例（2026-09-13，B5 拆块期间，**一轮里咬了两次**）

`e2e/scripts/serve.mjs` 有构建新鲜度检查（`needsBuild()`：比对 `.next/BUILD_ID`
的 mtime 与源码最新 mtime，过期则自动 `next build`）。
**直接 `npx next start` 绕过它**——服务照常起来、页面照常能开，**没有任何提示**。

| 实例 | 表现 | 真相 |
|---|---|---|
| **假红** | 采集"真机叙事样张"只拿到 1 条文案变化，据此报告"生产构建下行为不同" | 跑的是**过期构建**。经 `serve.mjs` 重建后拿到 **8 条** |
| **假绿** | 坏样本（整棵 `data-template-carousel` 子树被删）注入后，用 `PW_REUSE_EXISTING_SERVER=1` 复用旧服务重测，**门禁全绿** | 跑的仍是**坏样本之前的构建**。重建后立刻红 |

### 做法

1. **不要手起 `next start`**；用 `node e2e/scripts/serve.mjs`；
2. `PW_REUSE_EXISTING_SERVER=1` **只允许**在"源码自上次构建后未变"时使用；
3. 汇报里出现"绿/红"时，先确认这轮跑动的构建时间戳 **晚于**被测源码的修改时间；
4. **复审方同此判据**——复审别人的结论时，先问"这轮跑动触发重建了吗"。

**与附则 A1/A2 同族**：都是"先证明被测对象/测量本身有效，再拿结果当结论"。

## 附则 A4 · 断言容器存在 ≠ 断言内容存在（2026-09-13 立）

> **结构回归网必须配"删子树"坏样本**——删掉被保护的那棵子树，
> 断言必须红。只断言容器或"主要按钮"的，基本都是假门禁。

### 实例（2026-09-13，B5 拆块期间）

为 B5 拆块补的结构回归网「拆分后各 step 视图仍在正确时机出现」，
首版只断言两件事：`.generate-confirm` 容器可见 + "用此模板生成站点内容"按钮可见。

**负向验证**：构造坏样本删掉 `data-template-carousel` 整棵子树
（158 行 / **9,833 字节**），**`tsc` 全绿、首版断言也全绿**。

**为什么骗过人**：被吞掉的是**块内部的子树**，而容器与"主要按钮"往往在
子树**之外**——它们恰好是最不容易被删掉的东西。**拿它们当门禁等于没测。**

### 做法

1. 断言落点选**结构锚点**（`data-*` 属性 + 计数），不是文案——文案会改，结构不会；
2. **必须**用"删掉那棵子树"的坏样本拍红，再还原拍绿；
3. 一次事故证明：**`tsc` 全绿不算证据**（军规 4 的同一件事，在 JSX 上的形态）——
   删掉 `{template && (...)}` 这类条件渲染，类型全对、渲染版图空掉。

**同族**：军规 2（门禁必须会失败）、附则 A2（数节点前先证明在可渲染 DOM 里）。
