import { evaluateDraftQuality } from "../lib/content-quality.ts";
import { getTemplateManifest } from "../lib/template-manifest.ts";
import { defaultDraft } from "../lib/site-model.ts";

const baseUrl = process.env.SITECRAFT_BASE_URL || "http://localhost:3000";
const company = "东莞华固精密制造有限公司";

const product = (sku, name, summary, category, imageColor) => ({
  sku,
  name: { zh: name, en: name },
  summary: { zh: summary, en: summary },
  category,
  status: "published",
  imageColor,
});

const draft = structuredClone(defaultDraft);
Object.assign(draft, {
  siteName: company,
  companyName: company,
  templateId: "screwfast",
  locale: "zh",
  revision: 1,
  lastChange: "中文演示草稿已准备",
  industry: "精密紧固件制造",
  goal: "面向工业采购的产品展示与定制询盘",
  navigation: {
    about: { zh: "关于华固", en: "关于华固" },
    features: { zh: "核心优势", en: "核心优势" },
    services: { zh: "制造服务", en: "制造服务" },
    products: { zh: "产品目录", en: "产品目录" },
    contact: { zh: "联系我们", en: "联系我们" },
  },
  content: {
    hero: {
      title: { zh: "精密连接，稳固每一环", en: "精密连接，稳固每一环" },
      subtitle: { zh: "为工业设备、汽车零部件与电子电器提供可靠紧固件。", en: "为工业设备、汽车零部件与电子电器提供可靠紧固件。" },
      cta: { zh: "获取定制报价", en: "获取定制报价" },
    },
    about: {
      title: { zh: "专注精密紧固件制造", en: "专注精密紧固件制造" },
      body: { zh: "华固位于东莞，专注螺丝、螺栓、螺母及非标件制造，服务国内外工业采购。", en: "华固位于东莞，专注螺丝、螺栓、螺母及非标件制造，服务国内外工业采购。" },
    },
    features: {
      title: { zh: "华固的制造优势", en: "华固的制造优势" },
      intro: { zh: "从材料选型到出货检验，每个环节都有清晰记录。", en: "从材料选型到出货检验，每个环节都有清晰记录。" },
      items: [
        { id: "material-process", title: { zh: "材料与工艺匹配", en: "材料与工艺匹配" }, body: { zh: "按不锈钢、合金钢与碳钢特性选择冷镦、车削或攻牙工艺，适配批量生产。", en: "按不锈钢、合金钢与碳钢特性选择冷镦、车削或攻牙工艺，适配批量生产。" } },
        { id: "standards", title: { zh: "规格标准清晰", en: "规格标准清晰" }, body: { zh: "支持公制与英制螺纹，按 GB、DIN、ISO 标准提供图纸与样品确认。", en: "支持公制与英制螺纹，按 GB、DIN、ISO 标准提供图纸与样品确认。" } },
        { id: "traceability", title: { zh: "批次检验可追溯", en: "批次检验可追溯" }, body: { zh: "来料、过程与出货检验围绕尺寸、螺纹和表面处理展开，随货提供检验记录。", en: "来料、过程与出货检验围绕尺寸、螺纹和表面处理展开，随货提供检验记录。" } },
      ],
    },
    services: {
      title: { zh: "从图纸到稳定交付", en: "从图纸到稳定交付" },
      intro: { zh: "以工程沟通、打样确认和批次交付推进项目。", en: "以工程沟通、打样确认和批次交付推进项目。" },
      items: [
        { id: "custom", title: { zh: "非标件定制", en: "非标件定制" }, body: { zh: "依据图纸或样品确认头型、牙距、长度、材料和表面处理，形成可执行规格。", en: "依据图纸或样品确认头型、牙距、长度、材料和表面处理，形成可执行规格。" } },
        { id: "sampling", title: { zh: "样品与小批验证", en: "样品与小批验证" }, body: { zh: "先完成样品打样与尺寸确认，再按确认版本安排批量生产，减少装配风险。", en: "先完成样品打样与尺寸确认，再按确认版本安排批量生产，减少装配风险。" } },
        { id: "delivery", title: { zh: "包装与交付协同", en: "包装与交付协同" }, body: { zh: "按 SKU、批次和包装要求整理出货，支持内销与出口项目的交付沟通。", en: "按 SKU、批次和包装要求整理出货，支持内销与出口项目的交付沟通。" } },
      ],
    },
    products: {
      title: { zh: "精密紧固件产品", en: "精密紧固件产品" },
      intro: { zh: "覆盖设备装配、汽车零部件与电子电器应用的常用规格。", en: "覆盖设备装配、汽车零部件与电子电器应用的常用规格。" },
    },
    contact: {
      title: { zh: "让我们讨论您的规格", en: "让我们讨论您的规格" },
      body: { zh: "发送图纸、样品或采购需求，华固团队会尽快回复。", en: "发送图纸、样品或采购需求，华固团队会尽快回复。" },
      email: "sales@huaguprecision.cn",
      phone: "0769-8275-1688",
      address: { zh: "广东省东莞市长安镇振安工业区华固路18号", en: "广东省东莞市长安镇振安工业区华固路18号" },
    },
  },
  sectionOrder: ["about", "features", "services", "products", "contact"],
  hiddenSections: [],
  designTokens: {
    primary: "#1f5a43",
    secondary: "#f4f7f2",
    accent: "#e57b3f",
    fontStyle: "technical",
    radius: "soft",
    density: "balanced",
  },
  products: [
    product("HG-SUS304-M3X8", "304不锈钢十字盘头螺丝", "材料：SUS304；规格：M3×8；标准：DIN 7981；应用：电子电器外壳与控制柜装配。", "不锈钢螺丝", "#dce9e1"),
    product("HG-12.9-M8X30", "12.9级合金钢内六角螺栓", "材料：42CrMo合金钢；规格：M8×30；标准：ISO 4762；应用：自动化设备与工装夹具连接。", "高强度螺栓", "#e8e2d6"),
    product("HG-SUS316-M6", "316不锈钢六角螺母", "材料：SUS316；规格：M6；标准：DIN 934；应用：潮湿环境设备与户外结构件。", "不锈钢螺母", "#dbe5ef"),
    product("HG-CUSTOM-001", "非标车削隔离柱", "材料：303不锈钢；规格：按图纸定制；工艺：数控车削与倒角；应用：电子组件支撑与定位。", "非标精密件", "#e9ded7"),
  ],
});

const manifest = getTemplateManifest(draft.templateId);
if (!manifest) throw new Error("缺少 screwfast 模板 manifest");
const quality = evaluateDraftQuality(draft, manifest);
if (!quality.publishable) {
  console.error(JSON.stringify({ quality }, null, 2));
  throw new Error("质量门未通过，停止发布");
}

const headers = {
  "Content-Type": "application/json",
  "x-sitecraft-workspace-id": "demo",
  "x-sitecraft-actor-id": "demo-builder",
  "x-sitecraft-role": "editor",
};
const createResponse = await fetch(`${baseUrl}/api/sites`, {
  method: "POST",
  headers,
  body: JSON.stringify({ name: company, templateId: "screwfast", locales: ["zh"], initialDraft: draft }),
});
const created = await createResponse.json();
if (!createResponse.ok) throw new Error(`创建站点失败 ${createResponse.status}: ${JSON.stringify(created)}`);

const siteId = created.id;
const publishResponse = await fetch(`${baseUrl}/api/sites/${siteId}/publish`, {
  method: "POST",
  headers,
  body: JSON.stringify({ baseRevision: created.draft.revision, publishedBy: "demo-builder" }),
});
const published = await publishResponse.json();
if (!publishResponse.ok) throw new Error(`发布站点失败 ${publishResponse.status}: ${JSON.stringify(published)}`);

console.log(JSON.stringify({ siteId, revision: created.draft.revision, quality, published: published.status }, null, 2));
