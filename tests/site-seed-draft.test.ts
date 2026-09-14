import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultDraft } from "../lib/site-document.ts";

/**
 * `createSite` 把归一后的种子草稿持久化，且**不凭空造修订历史**（文件后端）。
 *
 * ## ⚠️ 本文件为什么**一个 site-store 的静态 import 都不能有**
 *
 * `site-store` 的 `storageRoot` 是**模块级常量**，在模块加载时按当时的
 * `process.env` / `process.cwd()` 固化（`lib/site-store.ts:89`）。
 * 要让它在加载时取到临时目录，就必须**在它被加载之前**设好 `SITECRAFT_DATA_ROOT`。
 *
 * ESM 的静态 import 会在**模块体求值之前**全部先跑完，所以"顶层设环境变量 +
 * 顶层静态 import site-store"是**错的顺序**——先加载 site-store（固化真实路径）、
 * 再设环境变量（已经晚了）。
 *
 * ⚠️ **本文件此前就是踩了这个坑**（2026-09-13 实测发现）：
 * `npm test` 每跑一次就往真实 `.sitecraft-data/sites/` 写一个站，
 * 长期无人发现（因为没有任何断言在数副作用总量）。
 * 同族的 `site-store-op-rename.test.ts:16-29` 记录了同一个坑，这里照它修。
 *
 * 所以：site-store 一律**动态 import**，且只在环境变量设好之后调用。
 * 同目录还有一条守卫 `test-side-effects.test.ts` 在数总量——**别再抄错作业**。
 */
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sitecraft-seed-draft-"));
const originalDataRoot = process.env.SITECRAFT_DATA_ROOT;
process.env.SITECRAFT_DATA_ROOT = tempRoot;

/** 环境变量到位之后才加载 site-store。 */
const loadStore = () => import("../lib/site-store.ts");

test.after(async () => {
  if (originalDataRoot === undefined) delete process.env.SITECRAFT_DATA_ROOT;
  else process.env.SITECRAFT_DATA_ROOT = originalDataRoot;
  await rm(tempRoot, { recursive: true, force: true });
});

test("沙箱生效：站点文件真的落在本文件的 mkdtemp 内（把时序约定变成断言）", async () => {
  /**
   * 用户 2026-09-13 要求的附加断言：**别靠注释，靠断言**。
   *
   * 上面那段"必须先设环境变量再加载"的时序约定，只写在注释里——
   * 而第四个抄作业的人不会读注释。所以这里**直接把约定测出来**。
   *
   * ⚠️ **第一版写错了，是假门禁**（如实记录）：第一版断言
   * `resolveStorageRoot(process.env, process.cwd()).startsWith(tempRoot)`——
   * 但那是**纯函数**，它按**调用时**的 env 求值，**根本不反映模块级常量的冻结值**。
   * 实测：故意把 env 设到 `site-store` 加载**之后**，那条断言**照样绿**。
   *
   * 所以改成断**事实**：真的建一个站，然后看**文件落在哪**——
   * 这才是被冻结的 `storageRoot` 的直接后果，环境变量设晚了就一定红。
   */
  const { createSite } = await loadStore();
  const probe = await createSite({
    name: "sandbox-probe",
    templateId: "forge",
    locales: ["zh"],
    initialDraft: structuredClone(defaultDraft),
  });

  const inSandbox = path.join(tempRoot, "sites", `${probe.id}.json`);
  const inRepo = path.join(process.cwd(), ".sitecraft-data", "sites", `${probe.id}.json`);

  const { access } = await import("node:fs/promises");
  await assert.doesNotReject(
    () => access(inSandbox),
    `站点文件应当落在沙箱 ${inSandbox}——落不到说明 SITECRAFT_DATA_ROOT 没在 site-store 加载前设好`,
  );
  await assert.rejects(
    () => access(inRepo),
    `站点文件**不该**落在真实数据目录 ${inRepo}——它说明这次运行污染了开发者的数据`,
  );
});

test("createSite persists the normalized seed draft without inventing revision history", async () => {
  const { createSite, getSite } = await loadStore();

  const initialDraft = structuredClone(defaultDraft);
  initialDraft.siteName = "Northstar Components";
  initialDraft.companyName = "Northstar Components";
  initialDraft.templateId = "forge";
  initialDraft.locale = "en";
  initialDraft.revision = 7;
  initialDraft.content.hero.title.en = "Server-backed industrial systems";
  initialDraft.content.products.title.en = "Server-backed product line";

  const created = await createSite({
    name: "Northstar Components",
    templateId: "forge",
    locales: ["en"],
    initialDraft,
  });
  // 落了盘但**只在沙箱里**——这条断言同时证明"真的写了"（否则上面那句时序断言会假绿）
  assert.ok(created.id, "createSite 应当返回站点 id");

  const loaded = await getSite(created.id);

  assert.equal(loaded.draft.siteName, "Northstar Components");
  assert.equal(loaded.draft.companyName, "Northstar Components");
  assert.equal(loaded.draft.templateId, "forge");
  assert.equal(loaded.draft.locale, "en");
  assert.equal(loaded.draft.revision, 7);
  assert.equal(loaded.draft.content.hero.title.en, "Server-backed industrial systems");
  assert.equal(loaded.draft.content.products.title.en, "Server-backed product line");
  assert.deepEqual(loaded.history, []);
  assert.equal(loaded.canUndo, false);
  assert.equal(loaded.canRedo, false);
});
