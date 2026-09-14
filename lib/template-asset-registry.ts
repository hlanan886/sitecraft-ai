/**
 * 模板资产注册表（2026-09-09，A4）。
 *
 * **两个用途合一**（避免维护两张表）：
 *  1. **A4 门禁**：该模板的首屏主视觉是不是「模板 demo 素材」——发布前需提示用户替换；
 *  2. **P3.2 图片替换**：该模板的首屏主视觉能否被用户上传的实拍图替换（`selector`）。
 *
 * **fail-closed 设计**：`selector` 缺省 = 不支持替换。理由：`scripts/probe-hero-asset.mjs`
 * 实测 22 模板中仅 14 个有可定位的首屏 `<img>`，且其中 2 个（shadcn-landing 96×96、
 * astrofy 208×117）最大图其实是 logo/小图——用「hero 区面积最大的 img」这种启发式会**替换错图**。
 * 所以必须逐模板显式声明，宁可不支持也不猜。
 *
 * 新增模板时：跑 `node --experimental-strip-types scripts/probe-hero-asset.mjs` 看首屏图片情况，
 * 在本表登记一行即可，无需改任何其它代码。
 */

export type TemplateHeroAsset = {
  templateId: string;
  /**
   * 可替换主视觉的 CSS selector（在渲染后的 DOM 里定位到唯一主图）。
   * 缺省表示该模板首屏无 `<img>`（CSS 背景图 / 大 SVG / 纯文字），v1 不支持替换。
   */
  selector?: string;
  /** 该主视觉是否为模板自带 demo 素材（true 时发布前门禁提示替换） */
  demo: boolean;
  /** 不支持替换时的原因（诊断与 UI 提示用） */
  unsupportedReason?: "no_img_element" | "css_background" | "svg_only" | "logo_only";
  /** 人工说明 */
  note: string;
};

/**
 * 22 模板首屏主视觉登记表。
 * 数据来源：`scripts/probe-hero-asset.mjs` 实测（首屏视口 900px 内、>80×80 的 img），逐模板核对。
 */
const HERO_ASSETS: readonly TemplateHeroAsset[] = [
  // ---- 有可替换主图（12 个），且确为模板 demo 素材 ----
  { templateId: "moon", selector: 'img[src*="astronaut"]', demo: true, note: "首屏宇航员图，与业务无关（历史缺陷样本）" },
  { templateId: "screwfast", selector: 'img[src*="photo-1568602471122"]', demo: true, note: "首屏 Unsplash 人像图" },
  { templateId: "lonestone", selector: 'img[src*="hero-image"]', demo: true, note: "首屏 hero-image 演示图" },
  { templateId: "atlas", selector: 'img[src*="banner"]', demo: true, note: "首屏 banner 演示图" },
  { templateId: "forge", selector: 'img[src*="heroimg"]', demo: true, note: "首屏 heroimg 演示图" },
  { templateId: "landwind", selector: 'img[src*="hero"]', demo: true, note: "首屏 hero.png 演示图" },
  { templateId: "foxi", selector: 'img[src*="avatar"]', demo: true, note: "首屏头像演示图" },
  { templateId: "yukina", selector: 'main img[src*="loli.net"]', demo: true, note: "首屏图床外链图" },
  { templateId: "kindred", selector: 'img[src*="hero"]', demo: true, note: "首屏沙漠图（主题演示素材）" },
  { templateId: "tailwind-landing", selector: 'img[src*="hero.png"]', demo: true, note: "首屏 hero.png 演示插图" },
  { templateId: "fresh", selector: 'main img', demo: true, note: "首屏演示插图" },
  { templateId: "astro-starter", selector: 'main img', demo: true, note: "首屏 dashboard 截图" },
  // ---- 有 img 但实为 logo / 小图，不能当主视觉替换（2 个）----
  { templateId: "shadcn-landing", demo: false, unsupportedReason: "logo_only", note: "首屏最大 img 仅 96×96（logo）" },
  { templateId: "astrofy", demo: false, unsupportedReason: "logo_only", note: "首屏最大 img 仅 208×117（项目缩略图）" },
  // ---- 首屏无 img（5 个）----
  { templateId: "powerai", demo: false, unsupportedReason: "no_img_element", note: "首屏无 img" },
  { templateId: "awesome", demo: false, unsupportedReason: "no_img_element", note: "首屏无 img（其 img 全在下方区块，且为 example.com 占位）" },
  { templateId: "astropaper", demo: false, unsupportedReason: "no_img_element", note: "首屏无 img" },
  { templateId: "nextjs-landing", demo: false, unsupportedReason: "no_img_element", note: "首屏无 img" },
  { templateId: "shadcn-landing2", demo: false, unsupportedReason: "no_img_element", note: "首屏无 img" },
  // ---- CSS 背景图（2 个）----
  { templateId: "astrogent", demo: false, unsupportedReason: "css_background", note: "首屏主视觉是 CSS background-image" },
  { templateId: "devportfolio", demo: false, unsupportedReason: "css_background", note: "首屏主视觉是 CSS background-image" },
  // ---- 大 SVG（1 个）----
  { templateId: "signal", demo: false, unsupportedReason: "svg_only", note: "首屏为内联 SVG 图形" },
];

const heroAssetMap = new Map(HERO_ASSETS.map((entry) => [entry.templateId, entry]));

export function getHeroAsset(templateId: string): TemplateHeroAsset | undefined {
  return heroAssetMap.get(templateId);
}

/** 该模板是否支持用户替换首屏主视觉（fail-closed：未登记 = 不支持）。 */
export function isHeroAssetReplaceable(templateId: string): boolean {
  return Boolean(heroAssetMap.get(templateId)?.selector);
}

/** 取首屏主视觉的 CSS selector（未登记返回 undefined，供 bridge 序列化注入）。 */
export function getHeroAssetSelector(templateId: string): string | undefined {
  return heroAssetMap.get(templateId)?.selector;
}

/**
 * 品牌 Logo 的可替换 selector。
 * v1 统一用「导航/页头内第一个 img」——22 模板的品牌位形态差异大（文字/内联 SVG/图片），
 * 只在用户真的上传了 logo 时才尝试替换；找不到 img 就回报 missing，不做猜测。
 */
export function getBrandAssetSelector(_templateId: string): string | undefined {
  return "header img, nav img, [class*='logo'] img";
}

/** 发布前门禁用：该模板首屏主视觉是否为 demo 素材。 */
export function isHeroAssetDemo(templateId: string): boolean {
  return heroAssetMap.get(templateId)?.demo === true;
}

export function getHeroAssets(): readonly TemplateHeroAsset[] {
  return HERO_ASSETS;
}

/**
 * 判断某张图片是否属于该模板的 demo 主视觉（按 selector 匹配 DOM 节点）。
 * 供 bridge / 门禁在渲染后 DOM 上调用；传入的是节点而非字符串。
 */
export function matchesHeroAssetSelector(templateId: string, src: string): boolean {
  const entry = heroAssetMap.get(templateId);
  if (!entry?.selector || !src) return false;
  // selector 形如 `img[src*="astronaut"]` / `main img[src*="loli.net"]` —— 提取属性包含值做匹配
  const match = /\[src\*="([^"]+)"\]/.exec(entry.selector);
  if (!match) return false;
  return src.includes(match[1]);
}
