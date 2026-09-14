import assert from "node:assert/strict";
import test from "node:test";
import {
  categoryFromTitle,
  createTemplateFromUrl,
  siteNameFromTitle,
  templateIdFromUrl,
  type CreateFromUrlDeps,
} from "../lib/template-from-url.ts";
import type { SiteCaptureResult } from "../lib/site-capture.types.ts";

/**
 * A 轨（网址 → 静态搬运）的**编排层**测试。
 *
 * ## 为什么要专门测这一层
 *
 * `tests/template-static-export.test.ts`(28 条) 已覆盖纯逻辑（清洗/重写/计划），
 * 但**编排层此前零覆盖**——而它承载的恰恰是**面向客户的判断**：
 * 抓取失败怎么说人话、搬来的站"能改到什么程度"的如实告知、素材沉淀提示。
 * 这些判断做错了，客户看不到任何报错，只会觉得"这玩意儿不行"。
 *
 * ## 怎么做到不装浏览器
 *
 * `createTemplateFromUrl(input, deps)` 的 `deps` **默认就是真实实现**
 * （`DEFAULT_DEPS`），测试传 fake 即可跑完整条编排，包括每一条失败分支。
 * 见 `lib/template-from-url.ts` 末尾「为什么加 deps」。
 */

/** 造一份"抓取成功"的结果，字段按 `SiteCaptureResult` 逐个填。 */
function okCapture(overrides: Partial<SiteCaptureResult> = {}): SiteCaptureResult {
  return {
    url: "https://example.com/",
    title: "某某机械制造有限公司",
    html: "<html><body><h1>欢迎</h1><p>正文</p></body></html>",
    assets: [],
    shot: null,
    failure: null,
    elapsedMs: 12,
    ...overrides,
  };
}

/**
 * 造一份 exportStaticTemplate 的成功返回。
 *
 * ⚠️ `plan` 的形状必须与 `StaticExportPlan` 一致（`template-static-export.ts:403`）——
 * 编排层会把它交给 `describeStaticExport` 拼人话，
 * 少一个字段就在那里炸（第一版就栽在这：只填了 resources/skipped，缺 toDownload/cleanup）。
 */
function okExport(html = "<html><body><h1>欢迎</h1></body></html>") {
  return {
    html,
    plan: {
      html,
      toDownload: [],
      cleanup: { html, removed: [], counts: {} },
      skipped: [],
      warnings: [],
    },
    resources: [],
    totalBytes: 0,
    rewritten: 0,
    warnings: [] as string[],
  } as unknown as Awaited<ReturnType<CreateFromUrlDeps["exportStaticTemplate"]>>;
}

/** 把 deps 收成一个小工厂，让每个用例只关心自己要覆盖的分支。 */
function makeDeps(overrides: Partial<CreateFromUrlDeps> = {}): CreateFromUrlDeps {
  return {
    captureSite: (async () => okCapture()) as unknown as CreateFromUrlDeps["captureSite"],
    exportStaticTemplate: (async () => okExport()) as unknown as CreateFromUrlDeps["exportStaticTemplate"],
    ...overrides,
  };
}

// ---------------------------------------------------------------- 纯函数（上游已有测试的补充）

test("templateIdFromUrl：从主机名派生合法 id，带后缀且不超 40 字符", () => {
  assert.equal(templateIdFromUrl("https://www.Example.COM/a/b"), "example-com");
  assert.equal(templateIdFromUrl("https://example.com", "1712"), "example-com-1712");
  // 非法输入不抛，落回兜底
  assert.match(templateIdFromUrl("不是网址"), /^[a-z0-9]/);
  // 超长主机名被截断到 40 以内
  assert.ok(templateIdFromUrl(`https://${"a".repeat(60)}.com`).length <= 40);
});

test("siteNameFromTitle / categoryFromTitle：标题推断", () => {
  assert.equal(siteNameFromTitle("恒准机械 - 专业紧固件", "https://x.com"), "恒准机械");
  assert.equal(siteNameFromTitle("", "https://www.abc.com"), "abc.com");
  assert.equal(categoryFromTitle("某某风机制造厂"), "制造业");
  assert.equal(categoryFromTitle("深圳外贸出口公司"), "外贸目录");
  assert.equal(categoryFromTitle("随便一个名字"), "其他");
});

// ---------------------------------------------------------------- ① 抓取失败

test("抓取失败：如实把原因带出来，step=capture，不抛异常", async () => {
  const result = await createTemplateFromUrl(
    { url: "https://example.com" },
    makeDeps({ captureSite: (async () => okCapture({ failure: "这个网址打不开，可能是地址写错了。" })) as never }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.step, "capture");
  assert.equal(result.message, "这个网址打不开，可能是地址写错了。");
});

// ---------------------------------------------------------------- ② 整理失败

test("整理失败：抛出的异常被转成人话，step=export", async () => {
  const result = await createTemplateFromUrl(
    { url: "https://example.com" },
    makeDeps({ exportStaticTemplate: (async () => { throw new Error("磁盘满了"); }) as never }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.step, "export");
  // 原始错误要出现在文案里（排查用），且必须给用户一条退路
  assert.match(result.message, /磁盘满了/);
  assert.match(result.message, /截图/);
});

// ---------------------------------------------------------------- ③ 槽位告知（本文件最重要的断言）

test("可编辑程度告知：识别不出编辑位时，必须明说「只能看、不能改」", async () => {
  const result = await createTemplateFromUrl(
    { url: "https://example.com" },
    makeDeps({
      captureSite: (async () => okCapture({ html: "<html><body><p>没有任何可识别结构</p></body></html>" })) as never,
      exportStaticTemplate: (async () => okExport("<html><body><p>没有任何可识别结构</p></body></html>")) as never,
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const said = result.bundle.warnings.join("\n");
  assert.match(said, /只能看、不能改/, "必须如实告知不可编辑，不能含糊");
  assert.match(said, /截图生成/, "必须给一条可执行的替代路径");
});

test("可编辑程度告知：识别出编辑位时，说明数量并仍然提示「其余改不了」", async () => {
  const html = '<html><body><h1>主标题</h1><a href="mailto:a@b.com">写信</a></body></html>';
  const result = await createTemplateFromUrl(
    { url: "https://example.com" },
    makeDeps({
      captureSite: (async () => okCapture({ html })) as never,
      exportStaticTemplate: (async () => okExport(html)) as never,
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const said = result.bundle.warnings.join("\n");
  assert.match(said, /可编辑程度有限/);
  assert.match(said, /其余内容改不了/);
  // 识别出的槽位要真的进了 bundle（h1 → hero.title）
  assert.match(result.bundle.html, /hero\.title/);
});

// ---------------------------------------------------------------- ④ 素材沉淀提示

test("素材库非空时给出提示；为空时不刷屏", async () => {
  const withLib = await createTemplateFromUrl(
    { url: "https://example.com" },
    makeDeps({
      captureSite: (async () => okCapture({
        library: [{ url: "https://example.com/p.jpg", role: "product", width: 800, height: 600, box: null }],
      })) as never,
    }),
  );
  assert.equal(withLib.ok, true);
  if (withLib.ok) assert.match(withLib.bundle.warnings.join("\n"), /素材库/);

  const noLib = await createTemplateFromUrl({ url: "https://example.com" }, makeDeps());
  assert.equal(noLib.ok, true);
  if (noLib.ok) assert.doesNotMatch(noLib.bundle.warnings.join("\n"), /存进素材库/);
});

// ---------------------------------------------------------------- ⑤ 产出形状（登记接口依赖它）

test("产出形状：initialDraft 必须为 null，且 bundle 字段齐全", async () => {
  const result = await createTemplateFromUrl({ url: "https://example.com" }, makeDeps());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // 搬来的站与原站内容一致，不需要另给初始草稿——下游靠这个 null 区分 A/B
  assert.equal(result.bundle.initialDraft, null);
  assert.equal(typeof result.bundle.templateId, "string");
  assert.equal(result.bundle.category, "制造业");
  assert.ok(Array.isArray(result.bundle.warnings));
  assert.equal(result.bundle.stats.captureMs, 12);
});

// ---------------------------------------------------------------- ⑥ 默认 deps 必须是真的

test("默认 deps：导出的是真实实现本身（身份断言，桩假冒不了）", async () => {
  /**
   * ⚠️ 这条是**防「静默行为改动」**的护栏，写法经过一次返工。
   *
   * ## 第一版是假门禁（如实记录）
   *
   * 第一版把默认 `captureSite` 换成一个返回 `{ failure: "stub" }` 的桩，
   * 然后断言"不传 deps 时会失败且 step=capture"。**结果它照样绿**——
   * 因为桩返回的错误恰好满足那两条断言。**这正是本项目吃过三次的「假门禁」形态。**
   *
   * ## 改成身份断言
   *
   * 直接断言**默认用的是真实函数本身**。桩再怎么伪装，函数引用也对不上，
   * 所以这条**不可能被空实现满足**。
   */
  const mod = await import("../lib/template-from-url.ts");
  const realCapture = (await import("../lib/site-capture-browser.ts")).captureSite;
  const realExport = (await import("../lib/template-static-export-browser.ts")).exportStaticTemplate;

  // ⚠️ 第一版的教训：这里原本写 `if (defaults) { ... }`，而 DEFAULT_DEPS 当时**没导出**，
  // 于是 defaults 恒为 undefined、整段被跳过——**断言永远绿，是空门禁**。
  // 所以现在：DEFAULT_DEPS 是导出符号，**直接断言、不做存在性判断**。
  assert.equal(
    mod.DEFAULT_DEPS.captureSite,
    realCapture,
    "默认 captureSite 必须是真实实现本身，不能是桩",
  );
  assert.equal(
    mod.DEFAULT_DEPS.exportStaticTemplate,
    realExport,
    "默认 exportStaticTemplate 必须是真实实现本身",
  );
});

test("空洞自检：把 deps 换成空实现时，编排必须真的什么都不做（证明 deps 被消费）", async () => {
  /**
   * 与上一条互补：上一条证"默认是真的"，这条证"传进去的确实被用了"。
   * 若 deps 参数被忽略（仍走 import 进来那份），本用例会拿到真实抓取的结果而红。
   */
  let captureCalled = 0;
  let exportCalled = 0;
  const result = await createTemplateFromUrl(
    { url: "https://example.com" },
    makeDeps({
      captureSite: (async () => { captureCalled += 1; return okCapture(); }) as never,
      exportStaticTemplate: (async () => { exportCalled += 1; return okExport(); }) as never,
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(captureCalled, 1, "注入的 captureSite 必须被调用一次");
  assert.equal(exportCalled, 1, "注入的 exportStaticTemplate 必须被调用一次");
});
