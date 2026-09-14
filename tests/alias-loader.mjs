/**
 * 别名解析 + **按需替身**钩子：让 `node --test` 能 import 那些用了 `@/lib/...`
 * 的路由模块，并在测试**明确要求**时把某个模块换成同形状的替身。
 *
 * ## 为什么需要它
 *
 * `@/*` 是 Next.js/TS 的路径别名（`tsconfig.json` 的 `paths`），**node 原生不认**。
 * 所以仓库里此前**零个路由测试**——不是因为不想测，是因为 `import` 那一行就炸：
 * `ERR_MODULE_NOT_FOUND: Cannot find package '@/lib'`。
 *
 * 实测过的三条路（2026-09-12）：
 *
 * | 路子 | 结果 |
 * |---|---|
 * | 直接 import 路由 | ❌ 别名解析失败 |
 * | **本文件：`register()` 钩子** | ✅ 可用，且**不改 `npm test` 脚本、不碰 lib/** |
 * | `mock.module()` 替身 | ❌ Node 24 需 `--experimental-test-module-mocks`，要改脚本 |
 *
 * ## 两件事
 *
 * 1. **别名解析**：`@/x/y` → `<仓库根>/x/y`，按 `tsconfig` 的扩展名顺序试。
 * 2. **按需替身**（2026-09-13 新增）：仅当**测试文件自己**设了
 *    `SITECRAFT_TEST_SUBSTITUTIONS` 时才生效；没设时**一个模块都不换**，
 *    行为与从前逐字节相同，且不产生任何额外 I/O。
 *
 * ## ⚠️ 三条实测出来的硬约束（不是推理，是踩出来的）
 *
 * **① 解析失败时 `return next()` 会直接抛，不会继续往下找。**
 * 实测：钩子不认某个 `@/` 目标而把 `next(specifier, context)` 交回去时，
 * Node **不会**回退到默认解析器，而是就地报 `Cannot find package '@/lib'`。
 * 所以本钩子必须穷举所有合理落点。
 *
 * **② `.tsx` / `index.tsx` 必须试。**
 * 真实模块图里有 `lib/template-manifests`（目录 → `index.ts`）与
 * `lib/product-image-store`（目录 → `index.tsx`）这类落点，漏一条整棵模块图
 * 就断在 `ERR_MODULE_NOT_FOUND` 上（2026-09-13 实测暴露，本版修掉）。
 *
 * **③ 替身只能在本钩子里落地，且开关只能走 env。**
 * `mock.module()` 要改 `npm test` 脚本（本批红线）；而 `register({ data })` 传的
 * 数据在**钩子线程里读不到**（线程有自己的全局对象）。`process.env` 则本进程共享、
 * 钩子线程能看见——实测确认。"作用域仅限激活它的那个测试文件"靠的是
 * `node --test` **每个文件独立进程**，env 不会串台。
 *
 * ## 用法
 *
 * ```ts
 * // ① 只用别名解析（默认，零替身）
 * register("./alias-loader.mjs", import.meta.url);
 *
 * // ② 别名解析 + 替身（必须在 import 被测路由**之前**）
 * process.env.SITECRAFT_TEST_SUBSTITUTIONS = JSON.stringify({
 *   "@/lib/template-from-url": { "出图失败": { ok: false, step: "capture" } },
 * });
 * register("./alias-loader.mjs", import.meta.url);
 *
 * // ③ 想验证"替身真的生效了吗"（探针，默认关闭）
 * process.env.SITECRAFT_TEST_SUBSTITUTION_PROBE = "/abs/path/probe.txt";
 * ```
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 锚点 = 本文件位置（`tests/`）的上一级 = 仓库根。
 *
 * ⚠️ **不能用 `process.cwd()`**：解析钩子跑在独立的 worker 线程里，
 * 那里的 cwd 不是测试进程 chdir 之后的目录（实测踩过）。
 * `import.meta.url` 才是不受 cwd 影响的稳定锚点。
 */
const ROOT = new URL("../", import.meta.url);

/** 替身文件的落点：与被替身的模块**同名**，只是住在 `tests/substitutes/`。 */
const SUBSTITUTE_DIR = new URL("./substitutes/", import.meta.url);

/**
 * 按 `tsconfig` 的解析顺序试全部落点。
 *
 * ⚠️ **`.tsx` / `index.tsx` 不是可有可无的补全**——见文件头约束 ②。
 */
function resolveAlias(specifier) {
  const base = new URL(specifier.slice(2), ROOT);
  for (const candidate of [
    new URL(`${base.href}.ts`),
    new URL(`${base.href}.tsx`),
    new URL(`${base.href}/index.ts`),
    new URL(`${base.href}/index.tsx`),
  ]) {
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return null;
}

/**
 * 替身表来自**测试进程的环境变量**（见文件头约束 ③）。
 *
 * ⚠️ 环境变量名与解析逻辑与 `lib/testing/substitution.ts` 的 `SUBSTITUTION_ENV`
 * **必须同源**——两处各写一遍就又是一次"契约在两处定义"（附则 2）。
 * 这里不 import 那个模块，是因为 loader 跑在**解析钩子线程**里，
 * 拉进 `.ts` 模块会额外依赖类型剥离；所以只把**常量值**对齐，并在测试里断言一致。
 */
const SUBSTITUTION_ENV = "SITECRAFT_TEST_SUBSTITUTIONS";

function substitutions() {
  const raw = process.env[SUBSTITUTION_ENV];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    console.error("[alias-loader] 替身表不是合法 JSON——替身全部未生效");
    return null;
  }
}

/**
 * 解析钩子是**全局**的，没法在测试里断言"它到底看见了我的替身表没有"
 * （钩子线程与测试进程是两个全局对象）。
 *
 * 所以留一个**只读诊断出口**：仅当 `SITECRAFT_TEST_SUBSTITUTION_PROBE` 指向一个
 * 文件路径时才写它，默认**零副作用**。军规 2 的负向验证靠它取证——
 * 否则"先注入坏样本拍红"这件事就没有可复跑的机制，只能靠人记得。
 */
const PROBE = process.env.SITECRAFT_TEST_SUBSTITUTION_PROBE;

export function resolve(specifier, context, next) {
  if (!specifier.startsWith("@/")) return next(specifier, context);

  const table = substitutions();
  if (table && Object.prototype.hasOwnProperty.call(table, specifier)) {
    const file = new URL(`${specifier.split("/").pop()}.ts`, SUBSTITUTE_DIR);
    if (existsSync(fileURLToPath(file))) {
      if (PROBE) appendFileSync(PROBE, `substituted\t${specifier}\t${file.href}\n`);
      return { url: file.href, shortCircuit: true };
    }
    // 替身文件不存在：**大声退回真实现**，不要静默——那会让人以为替身在生效
    console.error(`[alias-loader] 替身文件不存在：${file.href}——已退回真实模块`);
  }

  return resolveAliasOrFail(specifier, context, next);
}

/** 别名解析；认不出就交回 `next()` 让它如实报错（见文件头约束 ①）。 */
function resolveAliasOrFail(specifier, context, next) {
  const target = resolveAlias(specifier);
  if (PROBE) appendFileSync(PROBE, `resolved\t${specifier}\t${target ? target.href : "MISS"}\n`);
  if (target) return { url: target.href, shortCircuit: true };
  return next(specifier, context);
}

