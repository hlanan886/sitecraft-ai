/**
 * 测试副作用守卫：**测试跑完不许往仓库数据目录里留东西**。
 *
 * ## 实测动因（2026-09-13）
 *
 * 用户要求"测'零成本'要测**总量**"。一查发现：`npm test` 每跑一次，
 * `.sitecraft-data/sites/` 就多一个文件（461 → 462 → 463 → 465…）——
 * **测试在污染开发者的真实数据目录，而此前没有任何断言在数副作用**。
 *
 * ## 根因
 *
 * `lib/site-store.ts:89` 是**模块级常量**：
 * ```ts
 * const storageRoot = resolveStorageRoot(process.env, process.cwd());
 * ```
 * 它在**模块首次加载时**按当时的 cwd/env 固化。某个测试进程的 cwd 是仓库根时加载了它，
 * storageRoot 就永久指向 `.sitecraft-data/sites`——该进程里任何建站调用都写到真实目录。
 * （`resolveStorageRoot` 的注释 `:75-78` 警告过这个坑，只是警告的是另一种表现。）
 *
 * ## 怎么用（**必须两条一起看，签名不一致就是有副作用**）
 *
 * ```
 * node --test --experimental-strip-types tests/test-side-effects.test.ts   # 跑前：记下签名
 * npm test                                                                 # 中间：跑全套
 * node --test --experimental-strip-types tests/test-side-effects.test.ts   # 跑后：签名必须一致
 * ```
 * 两条用例打印的 `SIDE-EFFECT-SIGNATURE|...` 一行必须**逐字相同**。
 * 由 `npm run test:side-effects` 自动做这三步并比对。
 *
 * ## 为什么不做成"自动 spawn 子进程"
 *
 * 试过，**失败三次**（如实记录，免得后人重走）：
 * ① `spawn` 不带 `shell` → `tests/*.test.ts` 是字面量，node 当成不存在的文件，97ms 退出零输出；
 * ② 带 `shell` + 输出重定向 → 仍拿不到 reporter 输出；
 * ③ 想用 `--test-skip-pattern` 防递归 → 外层也会吃掉该参数，内层直接跳过。
 * **结论：进程管理是这里的复杂度来源，而它不是被测对象。** 换成纯字段比对后，
 * 没有进程、没有 glob、没有递归风险，**同一份签名两边都拿得到**。
 *
 * ⚠️ **防假门禁**（本项目吃过四次）：只断言"零增长"会永远绿。
 * 所以下面先证明**快照函数真的灵敏**——在沙箱里主动写一个文件，计数必须变。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** 仓库根 = 本文件（tests/）的上一级；用 import.meta.url 锚定，不受 chdir 影响。 */
const REPO_ROOT = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/**
 * 记录型副作用目录——**用户数据**，跑完必须零增长。
 *
 * 只收"测试可能碰到"的；备份/日志/浏览器 profile 这些与测试无关的不进来。
 */
const WATCHED_DIRS = [
  ".sitecraft-data/sites",
  ".sitecraft-data/pending-jobs",
  ".sitecraft-data/releases",
  ".sitecraft-data/leads",
  ".sitecraft-data/uploads",
  ".sitecraft-data/captures",
  ".sitecraft-data/generated-templates",
] as const;

async function countEntries(relativeFromRepoRoot: string): Promise<number> {
  try {
    return (await readdir(path.join(REPO_ROOT, relativeFromRepoRoot))).length;
  } catch {
    return 0;
  }
}

/** 全量签名：`dir=count` 按目录名排序，便于逐字比对。 */
async function sideEffectSignature(): Promise<string> {
  const entries = await Promise.all(WATCHED_DIRS.map(async (dir) => [dir, await countEntries(dir)] as const));
  return entries
    .map(([dir, count]) => `${dir}=${count}`)
    .sort()
    .join("|");
}

test("守卫自身灵敏（否则下面的零增长是空门禁）", async () => {
  /**
   * 用**我们控制的临时目录**证明 `countEntries` 真的会随写入变化——
   * 若它写错了（路径不对、恒读空目录），签名就永远不变、比对毫无意义。
   */
  const probeDir = ".sitecraft-data/.side-effect-probe";
  const probePath = path.join(REPO_ROOT, probeDir);
  try {
    await mkdir(probePath, { recursive: true });
    assert.equal(await countEntries(probeDir), 0, "刚建的空目录应当是 0");
    await writeFile(path.join(probePath, "x.json"), "{}", "utf8");
    assert.equal(await countEntries(probeDir), 1, "写了一个文件后必须是 1——否则 countEntries 是坏的");
  } finally {
    await rm(probePath, { recursive: true, force: true });
  }
  assert.equal(await countEntries(probeDir), 0, "清理后应回到 0");
});

test("打印副作用签名（跑全套前后各跑一次本文件，靠它逐字比对）", async () => {
  console.log(`SIDE-EFFECT-SIGNATURE|${await sideEffectSignature()}`);
  assert.ok(true);
});
