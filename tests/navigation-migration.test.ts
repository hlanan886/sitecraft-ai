import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultDraft,
  DRAFT_SCHEMA_VERSION,
  migrateNavigation,
  navItemSchema,
  normalizeDraft,
  siteDraftSchema,
} from "../lib/site-document.ts";

/**
 * 导航数组化（⑥）的迁移契约。
 *
 * ## 这组测试为什么必须先写
 *
 * `normalizeDraft` 在 `safeParse` 失败时会**把整站内容重置成 Forge 演示文案**，
 * 只保留 7 个标量字段，且不报错（P-0 那次静默数据丢失就是它干的）。
 *
 * 把 `navigation` 从对象改成数组时，磁盘上**每一个旧草稿**的 `safeParse` 都会失败。
 * 没有迁移 = 改 schema 的那一刻所有现有站点内容消失。
 *
 * 所以这里的断言不是"迁移函数好用"，而是**"旧草稿读出来还是它自己"**——
 * 逐字段对，不是抽查几个。
 */

/** 一份**旧形状**的完整草稿（navigation 是 5 键对象），内容刻意都用非演示文案。 */
function legacyDraft() {
  const base = structuredClone(defaultDraft) as unknown as Record<string, unknown>;
  return {
    ...base,
    siteName: "华曜新能源",
    companyName: "华曜新能源科技有限公司",
    industry: "光伏制造",
    goal: "拿到欧美分布式电站的询盘",
    navigation: {
      about: { zh: "关于华曜", en: "About" },
      features: { zh: "制造能力", en: "Capabilities" },
      services: { zh: "电站服务", en: "Services" },
      products: { zh: "组件与逆变器", en: "Products" },
      contact: { zh: "联系我们", en: "Contact" },
    },
    content: {
      ...(base.content as Record<string, unknown>),
      about: { title: { zh: "十三年只做一件事", en: "" }, body: { zh: "从硅片到组件全链条自产。", en: "" } },
      features: {
        title: { zh: "为什么选华曜", en: "" },
        intro: { zh: "产能、认证、交付。", en: "" },
        items: [
          { id: "cap", title: { zh: "年产能 2GW", en: "" }, body: { zh: "两条全自动产线。", en: "" } },
          { id: "cert", title: { zh: "TUV 认证", en: "" }, body: { zh: "全系通过。", en: "" } },
        ],
      },
      services: {
        title: { zh: "电站全周期服务", en: "" },
        intro: { zh: "", en: "" },
        items: [{ id: "epc", title: { zh: "EPC 总包", en: "" }, body: { zh: "设计到并网。", en: "" } }],
      },
      contact: {
        title: { zh: "联系我们", en: "" },
        body: { zh: "留下需求，24 小时内回复。", en: "" },
        email: "sales@huayao.example.cn",
        phone: "0769-8233 6688",
        address: { zh: "广东东莞松山湖", en: "" },
      },
    },
    products: [
      {
        sku: "HY-550M",
        name: { zh: "550W 单晶组件", en: "" },
        summary: { zh: "双面双玻。", en: "" },
        category: "组件",
        status: "published",
        imageColor: "#dbe7f0",
      },
    ],
  };
}

test("旧草稿（navigation 是对象）整份读回来，**一个字段都不丢**", () => {
  const migrated = normalizeDraft(legacyDraft());

  // 标量
  assert.equal(migrated.siteName, "华曜新能源");
  assert.equal(migrated.companyName, "华曜新能源科技有限公司");
  assert.equal(migrated.industry, "光伏制造");
  assert.equal(migrated.goal, "拿到欧美分布式电站的询盘");

  /**
   * ⚠️ 下面这几条是**这次测试的重点**。
   *
   * 它们全都是 `normalizeDraft` 兜底分支会重置成 Forge 演示文案的字段
   * （"为下一代标准而造。""Forge Industrial"…）。
   * 只要有一条变成演示文案，就说明迁移没生效、内容已经被吃了——
   * 而这在真实使用里**不会有任何报错**，用户只会在某天打开工作台发现站变了样。
   */
  assert.equal(migrated.content.about.title.zh, "十三年只做一件事", "about 被重置成演示文案了");
  assert.equal(migrated.content.about.body.zh, "从硅片到组件全链条自产。");
  assert.equal(migrated.content.features.title.zh, "为什么选华曜");
  assert.deepEqual(migrated.content.features.items.map((i) => i.id), ["cap", "cert"]);
  assert.equal(migrated.content.services.title.zh, "电站全周期服务");
  assert.equal(migrated.content.contact.email, "sales@huayao.example.cn");
  assert.deepEqual(migrated.products.map((p) => p.sku), ["HY-550M"]);

  // 导航
  assert.deepEqual(
    migrated.navigation.map((item) => [item.id, item.label.zh, item.target]),
    [
      ["about", "关于华曜", "#about"],
      ["features", "制造能力", "#features"],
      ["services", "电站服务", "#services"],
      ["products", "组件与逆变器", "#products"],
      ["contact", "联系我们", "#contact"],
    ],
  );
});

test("迁移后的结果**能过正式 schema**（否则写入时会被 assertDraftWritable 拦下）", () => {
  // 这一条是"迁移真的完成"的判据：迁移后若还过不了 schema，
  // 用户读得到、写不回去——每改一次内容就失败一次。
  const migrated = normalizeDraft(legacyDraft());
  const parsed = siteDraftSchema.safeParse(migrated);
  assert.equal(parsed.success, true, parsed.success ? "" : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("；"));
  assert.equal(migrated.schemaVersion, DRAFT_SCHEMA_VERSION);
});

test("**对象键的顺序就是导航顺序**（不能改用固定键列表）", () => {
  // 手工列键会在将来加第六项时静默漏掉它——顺序也是用户看得见的东西。
  const items = migrateNavigation({
    products: { zh: "产品", en: "" },
    about: { zh: "关于", en: "" },
    contact: { zh: "联系", en: "" },
  });
  assert.deepEqual(items?.map((item) => item.id), ["products", "about", "contact"]);
});

test("认不出的导航形状返回 null——不猜，也不返回空数组", () => {
  // 返回 `[]` 会把"没迁移成功"伪装成"这个站本来就没有导航"。
  assert.equal(migrateNavigation(undefined), null);
  assert.equal(migrateNavigation(null), null);
  assert.equal(migrateNavigation("about"), null);
  assert.equal(migrateNavigation([]), null);
  assert.equal(migrateNavigation({}), null);
  // 键名全不合法（会进槽位路径，不能是中文/大写）
  assert.equal(migrateNavigation({ 关于: { zh: "关于", en: "" } }), null);
  assert.equal(migrateNavigation({ About: { zh: "关于", en: "" } }), null);
});

test("个别键名不合法时**只丢那一项**，不整批放弃", () => {
  // 丢一项导航远好过丢掉整个导航
  const items = migrateNavigation({
    about: { zh: "关于", en: "" },
    "BAD KEY": { zh: "坏的", en: "" },
    contact: { zh: "联系", en: "" },
  });
  assert.deepEqual(items?.map((item) => item.id), ["about", "contact"]);
});

test("纯字符串标签也能迁移（历史上手写过这种形状）", () => {
  const items = migrateNavigation({ about: "关于我们" });
  assert.deepEqual(items, [{ id: "about", label: { zh: "关于我们", en: "" }, target: "#about" }]);
});

test("已经是数组的**不会被再迁移一次**（幂等）", () => {
  const already = [{ id: "about", label: { zh: "关于", en: "" }, target: "#about" }];
  const once = normalizeDraft({ ...legacyDraft(), navigation: already });
  const twice = normalizeDraft(once);
  assert.deepEqual(once.navigation, twice.navigation);
  assert.deepEqual(once.navigation, already);
});

test("`target` 只接受站内锚点——`javascript:` 是存储型 XSS", () => {
  // 用户/模型填进来的字符串会直接进 href。转义（esc）**不拦协议**，
  // 所以这条必须在 schema 层挡，不能指望渲染层。
  for (const bad of ["javascript:alert(1)", "https://evil.example", "data:text/html,<script>", " #about"]) {
    assert.equal(navItemSchema.safeParse({ id: "x", label: { zh: "", en: "" }, target: bad }).success, false, `应拒绝 ${bad}`);
  }
  for (const good of ["#about", "#", "#section-2", "#a_b"]) {
    assert.equal(navItemSchema.safeParse({ id: "x", label: { zh: "", en: "" }, target: good }).success, true, `应接受 ${good}`);
  }
});

test("id 字符集与槽位路径兼容（放宽前先看 inline-edit-mapping 的 TEXT_SLOT）", () => {
  assert.equal(navItemSchema.safeParse({ id: "about-2", label: { zh: "", en: "" }, target: "#a" }).success, true);
  for (const bad of ["About", "关于", "a b", "-lead", ""]) {
    assert.equal(navItemSchema.safeParse({ id: bad, label: { zh: "", en: "" }, target: "#a" }).success, false, `应拒绝 id=${bad}`);
  }
});

test("迁移是**承重的**：旧形状直接喂 schema 必须失败", () => {
  /**
   * 这条测的是"测试本身"。
   *
   * 上面那些断言都经过 `normalizeDraft`，而它的兜底分支**总会"成功"返回一份草稿**
   * （内容被换成演示文案）。所以万一将来有人删掉 `migrateDraftShape`，
   * 失败形式是"内容被悄悄换掉"，而不是任何一条断言变红。
   *
   * 这里直接把**未迁移的旧形状**喂给 schema 并断言它失败。
   * 只要这条还绿着，就说明"对象形状确实过不了"——迁移确实是必需的，
   * 而不是一段自我感觉良好的空转代码。
   */
  assert.equal(
    siteDraftSchema.safeParse(legacyDraft()).success,
    false,
    "旧形状（navigation 是对象）本该过不了 schema；若这条变红，说明 schema 又变回接受对象了",
  );
});

