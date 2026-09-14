import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  categoryFor,
  createTemplateFromScreenshot,
  DEFAULT_DEPS,
  type CreateFromScreenshotDeps,
} from "../lib/template-from-screenshot.ts";
import type { SiteCaptureResult } from "../lib/site-capture.types.ts";
import { estimateSectionRange } from "../lib/site-vision.ts";
import { cardSections } from "../lib/site-operations.ts";
import type { TakeProductShotsResult } from "../lib/site-screenshot.ts";

/**
 * B 轨（截图 → 复刻模板）的**编排层**测试。
 *
 * ## 为什么专门测这一层
 *
 * `tests/site-vision.test.ts`(42) 覆盖纯逻辑（归一/去重/导航），
 * `tests/template-composer.test.ts`(19) 覆盖拼装，但**编排层此前零覆盖**——
 * 而它承载的恰恰是**面向客户的判断**与**几处付过学费的分支**：
 * 尺寸闸怎么说人话、"几个产品型号全读成同一个"怎么拆、
 * 产品图裁不到时**原因是否被带出去**（这里曾在空 catch 里丢过线索）。
 *
 * ## 怎么做到不开浏览器、不调模型
 *
 * `createTemplateFromScreenshot(input, deps)` 的 `deps` **默认就是真实实现**
 * （`DEFAULT_DEPS`），测试传 fake 即可跑完整条编排。注入面只收四个副作用点，
 * 见 `lib/template-from-screenshot.ts` 的类型注释。
 *
 * ⚠️ **不注入 `sharp`**——它是确定性的本地库，造一张真图就能把尺寸闸两向跑实。
 * 下面 `shot()` 造的就是**真实可解码的 PNG**，不是假 buffer。
 */

// ---------------------------------------------------------------- 造图（真 sharp，不是假 buffer）

/** 造一张真实可解码的 PNG。尺寸闸读的是它，所以**必须是真图**。 */
async function shot(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#2b6cb0" } }).png().toBuffer();
}

/** 合规尺寸：宽度高于硬底线 `MIN_ACCEPTABLE_WIDTH`(800)，像素远低于上限 8MP。 */
const OK_SHOT = { width: 1440, height: 900 };
/** 超阈值：宽度 400 < 800 → 尺寸闸必须拒。 */
const NARROW_SHOT = { width: 400, height: 900 };

// ---------------------------------------------------------------- 造模型输出（走真实 coerceVisionDsl）

/** 一份能通过 `coerceVisionDsl` 的最小合法 DSL。字段照 `tests/site-vision.test.ts` 的样本。 */
function rawDsl(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    templateId: "Fengji Industrial 风机",
    name: "风机工业",
    companyName: "鼎力风机设备有限公司",
    siteName: "鼎力风机设备",
    industry: "工业制造",
    goal: "展示产品并获取询盘",
    tokens: {
      primary: "#c8102e",
      secondary: "#1a1a1a",
      accent: "#e63946",
      fontStyle: "sans",
      radius: "sharp",
      density: "compact",
    },
    blocks: [
      { type: "navbar" },
      { type: "hero", variant: "cover" },
      { type: "products" },
      { type: "features" },
      { type: "services" },
      { type: "faq", variant: "accordion" },
      { type: "footer" },
    ],
    content: {
      hero: { title: "鼎力风机", subtitle: "让您满意，是我们不懈的追求。", cta: "查看更多" },
      about: { title: "关于我们", body: "专注工业风机。" },
      features: { title: "核心优势", intro: "", items: [{ title: "质量", body: "可追溯" }] },
      services: { title: "服务", intro: "", items: [] },
      products: { title: "产品展示", intro: "" },
      // FAQ 是**可选**的：不给就保持 undefined（`site-vision.ts:552-555` 明确不写空壳）。
      // 给了就必须有非空 title，否则整条被跳过——所以这里给一条真实问答。
      faq: { title: "常见问题", intro: "", items: [{ title: "风机怎么选型？", body: "把风量风压发给我们。" }] },
      contact: { title: "联系我们", body: "", phone: "400-123-4567", email: "sales@example.com" },
      navigation: { about: "关于我们", products: "产品展示", contact: "联系我们" },
    },
    products: [{ sku: "TDS-48RD", name: "单吸离心风机", summary: "适配除尘系统", category: "离心风机" }],
    ...overrides,
  };
}

/** `requestVisionDsl` 的成功返回——原始 JSON 由 `coerceVisionDsl` 真的过一遍。 */
function okVision(raw: Record<string, unknown> = rawDsl()) {
  return { ok: true as const, raw, model: "测试模型", latencyMs: 7, attemptCount: 1 };
}

// ---------------------------------------------------------------- 造抓取结果

/**
 * `SiteCaptureResult` 的 `assets` 是**页面探针**的形状。
 *
 * ⚠️ `kind === "image"` 之外，`decorative` / `natural` / `box` 三个都要给全：
 * 编排层用 `filter((a) => a.kind === "image" && !a.decorative && a.natural && a.box)`
 * 挑配图候选——少给一个，候选就是空数组，裁图那条分支**静默不执行**。
 *
 * ⚠️⚠️ **`box.y` 必须落进产品区**（第一版栽在这）：
 * `planProductShots` 的判据是两条同时成立——① 落在 `productsRange` 内、
 * ② 与同区其他图尺寸成组，**缺一就不裁**（`site-vision.ts:863-868` 有完整说明）。
 * 而 `productsRange` 由 `estimateSectionRange(块顺序, "products", 截图高)` 按板块数等分算出。
 * 所以这里的 y 是**算出来的**，不是拍的——见 `productShotY()`。
 */
function captureAssets() {
  return [
    {
      url: "https://example.com/p1.jpg",
      kind: "image" as const,
      box: { x: 0, y: productShotY(0), width: 400, height: 300 },
      natural: { width: 800, height: 600 },
      decorative: false,
    },
    {
      url: "https://example.com/p2.jpg",
      kind: "image" as const,
      box: { x: 400, y: productShotY(1), width: 400, height: 300 },
      natural: { width: 800, height: 600 },
      decorative: false,
    },
  ];
}

/**
 * 算出第 `index` 张产品图该放在页面的哪个纵向位置。
 *
 * 与 `estimateSectionRange` **同一口径**：页面高按 DSL 的板块数等分，
 * products 是第 3 个板块（navbar/hero/products/footer，`rawDsl()` 的块顺序）。
 * 取区间的 2/3 处，稳落区内。
 *
 * ⚠️ 这是**从真实规则派生**，不是抄一个魔数——改了 `rawDsl` 的块顺序，这里必须跟着变，
 * 否则产品图会被判成"不在产品区"，裁图分支静默不执行，用例变成假绿。
 */
function productShotY(index: number): number {
  const blocks = (rawDsl().blocks as Array<{ type: string }>).map((b) => b.type);
  const range = estimateSectionRange(blocks, "products", OK_SHOT.height);
  assert.ok(range, "rawDsl 的块顺序里必须有 products——否则这条夹具的前提就不成立");
  const span = range.bottom - range.top;
  return Math.round(range.top + span * (0.4 + index * 0.2));
}

async function okCapture(overrides: Partial<SiteCaptureResult> = {}): Promise<SiteCaptureResult> {
  return {
    url: "https://example.com/",
    title: "鼎力风机设备有限公司",
    html: "<html><body><h1>鼎力风机</h1></body></html>",
    assets: captureAssets(),
    shot: {
      file: ".sitecraft-data/captures/shot.jpeg",
      width: OK_SHOT.width,
      height: OK_SHOT.height,
      bytes: 1234,
      resized: false,
      format: "jpeg",
      body: await shot(OK_SHOT.width, OK_SHOT.height),
    },
    failure: null,
    elapsedMs: 33,
    ...overrides,
  };
}

// ---------------------------------------------------------------- deps 工厂

function makeDeps(overrides: Partial<CreateFromScreenshotDeps> = {}): CreateFromScreenshotDeps {
  return {
    readStoredImage: (async () => shot(OK_SHOT.width, OK_SHOT.height)) as never,
    requestVisionDsl: (async () => okVision()) as never,
    takeProductShots: (async () => ({ shots: [], failures: [] })) as never,
    captureSite: (async () => okCapture()) as never,
    ...overrides,
  };
}

/** 所有用例都从「用户传了一张合规的图」出发，只改自己要覆盖的那一段。 */
const UPLOAD = { source: { kind: "upload" as const, urlPath: "products/abc.png" } };
const FROM_URL = { source: { kind: "url" as const, url: "https://example.com/" } };

// ================================================================ ① 尺寸闸（本轮用户点名两向都要）

test("尺寸闸·负向：图太窄时**不进模型**，退回说人话的提示", async () => {
  let visionCalled = 0;
  const result = await createTemplateFromScreenshot(
    UPLOAD,
    makeDeps({
      readStoredImage: (async () => shot(NARROW_SHOT.width, NARROW_SHOT.height)) as never,
      requestVisionDsl: (async () => {
        visionCalled += 1;
        return okVision();
      }) as never,
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.step, "read");
  // 宽度数字要出现在文案里（客户能据此知道差多少），且给一条明确出路
  assert.match(result.message, new RegExp(String(NARROW_SHOT.width)));
  assert.match(result.message, /整页截图/);
  // ⚠️ 这条是**闸的意义所在**：被拒的图绝不能已经花掉一次模型调用
  assert.equal(visionCalled, 0, "尺寸不合格的图不许调模型——闸在调模型之前");
});

test("尺寸闸·正向：合规尺寸放行，且真的走到了模型那一步", async () => {
  let visionCalled = 0;
  const result = await createTemplateFromScreenshot(
    UPLOAD,
    makeDeps({
      readStoredImage: (async () => shot(OK_SHOT.width, OK_SHOT.height)) as never,
      requestVisionDsl: (async () => {
        visionCalled += 1;
        return okVision();
      }) as never,
    }),
  );

  assert.equal(result.ok, true, result.ok ? "" : `${result.step}: ${result.message}`);
  assert.equal(visionCalled, 1, "合规尺寸必须放行到模型");
  if (!result.ok) return;
  assert.equal(result.bundle.initialDraft !== null, true, "B 轨必须给初始草稿（A 轨才是 null）");
});

test("尺寸闸·边界：0 像素的坏文件被拒，不抛异常", async () => {
  // 用真实但退化到 1×1 的图触发"读不出可用尺寸"以外的路径：宽度 1 < 800
  const result = await createTemplateFromScreenshot(
    UPLOAD,
    makeDeps({ readStoredImage: (async () => shot(1, 1)) as never }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.step, "read");
});

// ================================================================ ② 取图失败

test("取图失败：step=read，且给出可执行的下一步（重新上传）", async () => {
  const result = await createTemplateFromScreenshot(
    UPLOAD,
    makeDeps({ readStoredImage: (async () => null) as never }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.step, "read");
  assert.match(result.message, /重新上传/);
});

test("网址来源·抓取失败：原样带出 capture 的理由，step=capture", async () => {
  const result = await createTemplateFromScreenshot(
    FROM_URL,
    makeDeps({ captureSite: (async () => okCapture({ failure: "这个网址打不开，可能是地址写错了。" })) as never }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.step, "capture");
  assert.equal(result.message, "这个网址打不开，可能是地址写错了。");
});

test("网址来源·没有截图：提示改传截图，step=capture", async () => {
  const result = await createTemplateFromScreenshot(
    FROM_URL,
    makeDeps({ captureSite: (async () => okCapture({ shot: null })) as never }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.step, "capture");
  assert.match(result.message, /截图/);
});

// ================================================================ ③ 模型阶段失败

test("模型失败：step=vision，错误码进 detail，提示里带提示词版本便于对账", async () => {
  const result = await createTemplateFromScreenshot(
    UPLOAD,
    makeDeps({
      requestVisionDsl: (async () => ({
        ok: false as const,
        code: "output_truncated" as const,
        error: "输出被截断",
        model: null,
        latencyMs: 12,
        attemptCount: 2,
      })) as never,
    }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.step, "vision");
  assert.equal(result.detail, "output_truncated");
  assert.match(result.message, /输出被截断/);
  // vision_dsl@<version> —— 出问题时靠它定位是哪版提示词
  assert.match(result.message, /vision_dsl@/);
});

test("模型产出读不出整版：step=vision，且建议换一张完整截图", async () => {
  const result = await createTemplateFromScreenshot(
    UPLOAD,
    // 缺 siteName 且 companyName 是缺口标记 → coerceVisionDsl 直接拒
    makeDeps({
      requestVisionDsl: (async () =>
        okVision(rawDsl({ siteName: "", companyName: "待补充" }))) as never,
    }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.step, "vision");
  assert.match(result.message, /整页截图/);
  assert.ok(result.detail && result.detail.length > 0, "归一失败的原因必须带出去");
});

// ================================================================ ④ 型号撞车拆分（付过学费的分支）

test("型号撞车：名称各不相同而型号被读成同一个时，按名称拆出唯一型号", async () => {
  const result = await createTemplateFromScreenshot(
    UPLOAD,
    makeDeps({
      requestVisionDsl: (async () =>
        okVision(
          rawDsl({
            products: [
              { sku: "TDS-48RD", name: "单吸风机", summary: "a", category: "风机" },
              { sku: "TDS-48RD", name: "双吸风机", summary: "b", category: "风机" },
              { sku: "TDS-48RD", name: "防爆风机", summary: "c", category: "风机" },
            ],
          }),
        )) as never,
    }),
  );

  assert.equal(result.ok, true, result.ok ? "" : `${result.step}: ${result.message}`);
  if (!result.ok) return;

  const skus = result.bundle.initialDraft.products.map((p) => p.sku);
  // 第一个保留原型号，其余派生——否则 4 个槽位同名，就地编辑必然改错卡片
  assert.equal(skus[0], "TDS-48RD");
  assert.equal(new Set(skus).size, skus.length, `型号必须互不相同，实际：${skus.join(" / ")}`);
  // 派生规则是 `${sku}-${slug}`，slug 由产品名生成（a-z0-9 + 中文，其余抹掉）
  assert.equal(skus[1], "TDS-48RD-双吸风机");
  assert.equal(skus[2], "TDS-48RD-防爆风机");
  assert.match(result.bundle.warnings.join("\n"), /按名称拆分型号/);
});

test("型号撞车·非中文名：被抹成空时落回 p2/index 兜底，**仍不得重复**", async () => {
  /**
   * 派生 slug 的字符类是 `[a-z0-9一-鿿]`——**英文产品名带斜杠/空格会被整段抹掉**。
   * 抹成空之后必须走 `p${index + 1}` 兜底（`template-from-screenshot.ts:232`）。
   * ⚠️ 这个兜底一旦失效，第二个产品会拿到与第一个**完全相同**的 SKU，
   * 而"槽位唯一"正是这段代码存在的唯一理由——所以必须单独钉住。
   */
  const result = await createTemplateFromScreenshot(
    UPLOAD,
    makeDeps({
      requestVisionDsl: (async () =>
        okVision(
          rawDsl({
            products: [
              { sku: "TDS-48RD", name: "Centrifugal / Fan", summary: "a", category: "风机" },
              { sku: "TDS-48RD", name: "Axial !!! Fan", summary: "b", category: "风机" },
            ],
          }),
        )) as never,
    }),
  );

  assert.equal(result.ok, true, result.ok ? "" : `${result.step}: ${result.message}`);
  if (!result.ok) return;
  const skus = result.bundle.initialDraft.products.map((p) => p.sku);
  assert.equal(skus[0], "TDS-48RD");
  assert.ok(skus[1].startsWith("TDS-48RD-"), `第二个型号必须带派生后缀，实际 ${skus[1]}`);
  assert.equal(new Set(skus).size, skus.length, `型号不得重复，实际：${skus.join(" / ")}`);
});

test("型号撞车·反例：名称本身重复时**不拆**（那是真的同一个型号，交给去重）", async () => {
  const result = await createTemplateFromScreenshot(
    UPLOAD,
    makeDeps({
      requestVisionDsl: (async () =>
        okVision(
          rawDsl({
            products: [
              { sku: "TDS-48RD", name: "单吸风机", summary: "a", category: "风机" },
              { sku: "TDS-48RD", name: "单吸风机", summary: "b", category: "风机" },
            ],
          }),
        )) as never,
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const said = result.bundle.warnings.join("\n");
  assert.doesNotMatch(said, /按名称拆分型号/, "名称完全相同不是撞车，是重复——不该走拆分分支");
});

// ================================================================ ⑤ 配图（三次失败之后加的置信度闸）

test("配图·confidence=low：**不裁图**，并如实说明原因", async () => {
  let shotsCalled = 0;
  const result = await createTemplateFromScreenshot(
    { ...FROM_URL, withProductImages: true },
    makeDeps({
      // 模型对"这是不是企业官网"没把握 → 走 low 分支
      requestVisionDsl: (async () => okVision(rawDsl({ confidence: "low" }))) as never,
      takeProductShots: (async () => {
        shotsCalled += 1;
        return { shots: [], failures: [] };
      }) as never,
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(shotsCalled, 0, "confidence=low 时不许开浏览器裁图");
  assert.match(result.bundle.warnings.join("\n"), /没有自动配图/);
});

test("配图·confidence 正常：真的裁图，并把相对路径挂到对应产品上", async () => {
  const result = await createTemplateFromScreenshot(
    { ...FROM_URL, withProductImages: true },
    makeDeps({
      requestVisionDsl: (async () =>
        okVision(rawDsl({
          products: [
            { sku: "TDS-48RD", name: "单吸风机", summary: "a", category: "风机" },
            { sku: "TDS-48RD-P2", name: "双吸风机", summary: "b", category: "风机" },
          ],
        }))) as never,
      takeProductShots: (async () =>
        ({
          shots: [
            {
              rank: 0,
              sourceUrl: "https://example.com/p1.jpg",
              base64: "AAAA",
              width: 400,
              height: 300,
              box: { x: 0, y: 1200, width: 400, height: 300 },
            },
            {
              rank: 1,
              sourceUrl: "https://example.com/p2.jpg",
              base64: "BBBB",
              width: 400,
              height: 300,
              box: { x: 400, y: 1200, width: 400, height: 300 },
            },
          ],
          failures: [],
        }) as TakeProductShotsResult) as never,
    }),
  );

  assert.equal(result.ok, true, result.ok ? "" : `${result.step}: ${result.message}`);
  if (!result.ok) return;

  // 路径相对模板目录，`/api/templates/<id>/assets/...` 按同一相对路径读回来
  assert.deepEqual(Object.keys(result.bundle.binaryAssets).sort(), [
    "assets/product-1.jpg",
    "assets/product-2.jpg",
  ]);
  assert.equal(result.bundle.initialDraft.products[0].image, "assets/product-1.jpg");
  assert.equal(result.bundle.initialDraft.products[1].image, "assets/product-2.jpg");
  assert.match(result.bundle.warnings.join("\n"), /已从原站裁出 2 张产品图/);
});

test("配图·裁图失败的原因**必须带出去**（此前被空 catch 吞掉，表现为「一张都没裁出来」且无线索）", async () => {
  const result = await createTemplateFromScreenshot(
    { ...FROM_URL, withProductImages: true },
    makeDeps({
      takeProductShots: (async () =>
        ({
          shots: [],
          failures: [{ rank: 0, url: "https://example.com/p1.jpg", reason: "图片没加载完就超时了" }],
        }) as TakeProductShotsResult) as never,
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const said = result.bundle.warnings.join("\n");
  assert.match(said, /图片没加载完就超时了/, "失败原因必须原样出现在警告里");
  assert.match(said, /色块占位/, "没配上的产品要说清楚会退化成什么");
});

test("配图·上传来源：不开裁图，如实说明「链接来源才能自动配图」", async () => {
  let captureCalled = 0;
  const result = await createTemplateFromScreenshot(
    { ...UPLOAD, withProductImages: true },
    makeDeps({
      captureSite: (async () => {
        captureCalled += 1;
        return okCapture();
      }) as never,
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(captureCalled, 0, "上传来源没有页面坐标，不该去抓站");
  assert.match(result.bundle.warnings.join("\n"), /上传截图则需要手动换图/);
});

// ================================================================ ⑥ 拼装与组装

test("拼装失败：step=compose，把 schema 的问题逐条带进 detail", async () => {
  const result = await createTemplateFromScreenshot(
    UPLOAD,
    makeDeps({
      // content.hero.title 是必填——把整块换成空对象让 composeTemplate 拒
      requestVisionDsl: (async () => okVision(rawDsl({ content: { hero: { title: "" } } }))) as never,
    }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  // 可能是 vision（归一阶段就拒）也可能是 compose，两者都算"没产出残页"
  assert.ok(["vision", "compose"].includes(result.step), `实际 step=${result.step}`);
});

test("产出形状：模板 id 归一、css 进 assets、summary 说清楚几个板块几个产品", async () => {
  const result = await createTemplateFromScreenshot(UPLOAD, makeDeps());
  assert.equal(result.ok, true, result.ok ? "" : `${result.step}: ${result.message}`);
  if (!result.ok) return;

  // 模型给的 templateId 带中文和空格 → 必须被归一成合法目录名
  assert.match(result.bundle.templateId, /^[a-z0-9][a-z0-9-]*$/, `实际 id=${result.bundle.templateId}`);
  assert.equal(typeof result.bundle.assets["styles.css"], "string");
  assert.equal(result.bundle.category, "制造业");
  assert.match(result.bundle.summary, /个板块/);
  assert.match(result.bundle.summary, /个产品/);
  // 初始草稿的 templateId 必须与产物一致（建站时原样传给 POST /api/sites）
  assert.equal(result.bundle.initialDraft.templateId, result.bundle.templateId);
});

test("suffix：撞名时加后缀，且 id 仍合法", async () => {
  const result = await createTemplateFromScreenshot({ ...UPLOAD, suffix: "1712" }, makeDeps());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.bundle.templateId, /-1712$/);
  assert.match(result.bundle.name, /1712$/);
});

// ================================================================ ⑦ 默认 deps 必须是真的（防静默换桩）

test("默认 deps：导出的是真实实现本身（身份断言，桩假冒不了）", async () => {
  /**
   * 与 A 轨同构的门禁。A 轨第一版是**假门禁**（换成桩仍绿），
   * 第二版是空门禁（`if (defaults)` 而 `DEFAULT_DEPS` 没导出 → 整段跳过）。
   * 这里直接断言函数引用，**不做存在性判断**。
   */
  const mod = await import("../lib/template-from-screenshot.ts");
  const realStore = (await import("../lib/product-image-store.ts")).readStoredImage;
  const realVision = (await import("../lib/ai-provider.ts")).requestVisionDsl;
  const realShots = (await import("../lib/site-screenshot.ts")).takeProductShots;
  const realCapture = (await import("../lib/site-capture-browser.ts")).captureSite;

  assert.equal(mod.DEFAULT_DEPS.readStoredImage, realStore);
  assert.equal(mod.DEFAULT_DEPS.requestVisionDsl, realVision);
  assert.equal(mod.DEFAULT_DEPS.takeProductShots, realShots);
  assert.equal(mod.DEFAULT_DEPS.captureSite, realCapture);
});

test("军规1·禁手抄：夹具里的卡片板块名**派生自权威源**，不是抄的", () => {
  /**
   * 这条守的是 `AGENTS.md` 军规 1。
   *
   * ⚠️ 这里**不写死 "features" / "services" / "faq"**：那三个串是拼装器与
   * 就地编辑共同的契约值，权威源只有 `cardSections` 一处
   * （`template-adapters/kindred.ts:91` 那个同名变量是**另一个概念**——DOM 节点数组，
   * 同名不同义，别混）。抄一遍就等着它漂移。
   *
   * ## 这条门禁抓到了真东西（如实记录）
   *
   * 第一版夹具只给了 features / services，**漏了 faq**——而 faq 在
   * `cardSections` 里。补上之后夹具才真正覆盖全部卡片板块，
   * 顺带把「faq 必须在 blocks 里声明才渲染」这条接线也钉住了。
   */
  const content = rawDsl().content as Record<string, unknown>;
  for (const section of cardSections) {
    assert.ok(section in content, `夹具必须覆盖卡片板块 ${section}——权威源 cardSections 里有`);
  }
  // 光有内容不够：拼装器按 `blocks` 决定渲染哪些板块，声明了才真的出现在 HTML 里
  const declared = (rawDsl().blocks as Array<{ type: string }>).map((b) => b.type);
  for (const section of cardSections) {
    assert.ok(declared.includes(section), `块顺序里也必须声明 ${section}，否则内容不渲染`);
  }
});

test("空洞自检：传进去的 deps 确实被消费（不是摆设）", async () => {  let storeCalled = 0;
  let visionCalled = 0;
  const result = await createTemplateFromScreenshot(
    UPLOAD,
    makeDeps({
      readStoredImage: (async () => {
        storeCalled += 1;
        return shot(OK_SHOT.width, OK_SHOT.height);
      }) as never,
      requestVisionDsl: (async () => {
        visionCalled += 1;
        return okVision();
      }) as never,
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(storeCalled, 1);
  assert.equal(visionCalled, 1);
});

test("纯函数补充：categoryFor 由行业名推分类，推不出归「其他」", () => {
  assert.equal(categoryFor("工业制造"), "制造业");
  assert.equal(categoryFor("跨境出口贸易"), "外贸目录");
  assert.equal(categoryFor("软件与信息服务"), "科技企业");
  assert.equal(categoryFor("品牌咨询设计"), "专业服务");
  assert.equal(categoryFor("随便一个行业名"), "其他");
});

test("纯函数补充：DEFAULT_DEPS 四个键齐全（少一个就是运行时炸）", () => {
  assert.deepEqual(Object.keys(DEFAULT_DEPS).sort(), [
    "captureSite",
    "readStoredImage",
    "requestVisionDsl",
    "takeProductShots",
  ]);
});
