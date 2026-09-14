/**
 * 模板配方（Template Recipe）——把 22 个旧模板**数据化**。
 *
 * ## 它解决什么问题
 *
 * 那 22 个模板是别人写的 Astro/Next 站点（HTML + CSS + 命令式适配器）。
 * 拼装器**吃不了它们**——它只认 DSL（组件序列 + token）。
 * 于是这些模板在"拼装为主"的新架构里变成了**看得见用不上**的死资产。
 *
 * Recipe 就是那座桥：每个模板一份纯 JSON，只记拼装器需要的那两样东西。
 *
 * ## 为什么不是"逆向 HTML"
 *
 * 从 markup 反推结构要处理 22 套不同的组件库、类名、嵌套——**且必然不完整**。
 * 而"这个模板看起来是什么样"这件事，**看一眼渲染结果就知道**——
 * 模型从截图读出的组件序列，就是拼装器要的输入格式，两边**本来就说同一种语言**。
 *
 * ## 事实源是**渲染结果**，不是源码也不是注释
 *
 * 2026-09-11 实测：先想过从适配器的注释里抠结构，但 22 份注释格式不统一、
 * 提取率极低（试了一把只有 1 个模板能抠出来）。而截图是**唯一不会撒谎的事实源**——
 * 它就是用户会看到的东西。
 *
 * ## Recipe 里**不该有**「文案风格」
 *
 * 拼装器只吃结构和 token，不吃"文案偏活泼还是稳重"。混进来会有两个害处：
 * 字段烂在那儿没人用、将来改文案风格会改错地方（那是提示词层的事）。
 *
 * **只有三类字段**：`blocks`（组件 + 顺序 + 版式）+ `tokens`（配色/字体/圆角/密度）
 * + `matchKeywords`（匹配用，见下）。
 */
import type { DesignTokens } from "./site-document.ts";
import type { ComposerBlock } from "./template-composer-dsl.ts";
import { categoryFromUserText } from "./template-recipe-keywords.ts";

/** 一份模板配方。**纯 JSON，可以直接落盘、可以被模型消费**。 */
export type TemplateRecipe = {
  /** 与模板 id 一致——落盘时用它当文件名 */
  id: string;
  name: string;
  category: string;
  /**
   * 匹配关键词。
   *
   * 用途：用户说"做个光伏出口企业的官网"，系统据此**不打模型**就挑出一个模板形状。
   * 来源是模板的 `promptProfile`（人写的、准确的）——**不是模型生成的**。
   */
  matchKeywords: string[];
  /** 组件序列 + 版式。拼装器直接吃。 */
  blocks: ComposerBlock[];
  /** 设计气质。拼装器直接吃。 */
  tokens: DesignTokens;
  /**
   * 提取时的把握度（来自 `site-vision` 的 `confidence`）。
   *
   * `low` 表示"模型认为这不是一张企业官网截图"——那这份配方的形状知识**不可靠**，
   * 用它匹配时要降权。**标注出来比藏着好**：一个不可靠的配方被当成可靠的使用，
   * 比没有这个配方更糟。
   */
  confidence: "high" | "medium" | "low";
  /** 提取时的观察（组件被合并、版式回退等）——**如实记录，不隐藏** */
  warnings: string[];
  /**
   * 提取元数据。
   *
   *  是**来源**：线上 demo / 本地构建产物 / 我们自己的预览端点。
   * 记录它是因为三者可能产出不同的配方——预览端点是系统里的真实渲染，
   * 线上 demo 可能改版、本地 file:// 对 SPA 渲染不出来。**出问题时这是第一手线索。**
   */
  extracted: { at: string; from: string; model: string; source?: string };
};

/**
 * 归一化板块顺序。
 *
 * `navbar` 固定在第一位、`footer` 固定在最后——**这两条是 HTML 语义决定的，
 * 不该由模型判断**。
 *
 * 实测（2026-09-11）：`moon` 模板被读成 `hero→navbar→features→…`，
 * 导航栏跑到了首屏后面。屏幕阅读器与键盘 Tab 顺序都会因此乱掉，
 * 而且拼装出来是**错误的页面结构**——导航在首屏下方。
 *
 * （有些设计里导航是透明的、视觉上盖在 hero 上，但 DOM 顺序仍是导航在前。
 * 模型看的是截图，只能看到视觉层次，看不出 DOM 顺序——所以这条必须由代码兜。）
 */
export function normalizeBlockOrder(blocks: readonly ComposerBlock[]): ComposerBlock[] {
  const navbars = blocks.filter((block) => block.type === "navbar");
  const footers = blocks.filter((block) => block.type === "footer");
  const middle = blocks.filter((block) => block.type !== "navbar" && block.type !== "footer");
  return [...navbars, ...middle, ...footers];
}

/** 一份配方里最少要有这些，才值得拿去匹配。 */
export function isUsableRecipe(recipe: TemplateRecipe): boolean {
  // 没有 hero 的配方拼不出能过门禁的站（`hero.title` 是硬要求）
  if (!recipe.blocks.some((block) => block.type === "hero")) return false;
  if (recipe.blocks.length < 3) return false;
  return true;
}

/**
 * 按用户的描述挑一个配方。
 *
 * ## 目的：**让 22 个模板真的能被选中**
 *
 * ⚠️ **不是"省一次模型调用"**——`resolveTemplate` 本来就是确定性纯函数，不调模型
 * （曾经写在这里的理由是错的，2026-09-11 核实后改掉）。
 * 真实的收益是：从前每个分类永远只出 `DEFAULT_TEMPLATE_FOR_CATEGORY` 那一个
 * （forge/atlas/signal/kindred），**另外 18 个模板选不上**；
 * 配方让同类里更贴合的那一个浮出来。
 *
 * ## 坑一：模板自带的分类词**匹配不上用户的话**
 *
 * 实测（2026-09-11）：`matchKeywords` 里是"制造业""科技企业"这种分类词，
 * 而**用户不会说"我是个制造业"**——他会说"工业零部件厂"。
 * 拿分类词直接匹配，五个真实表述**一个都命中不了**。
 *
 * 所以第一步是 `categoryFromUserText`：把用户的话归到一个分类。
 *
 * ## 坑二：不分「具体词」与「通用词」，等于没匹配
 *
 * 更早一版按关键词命中数打分，结果四个完全不同的问题
 * （光伏出口 / 工业零部件 / SaaS / 咖啡店）**全撞同一个模板**：
 * 所有配方都带"企业""官网"这类通用词，命中数拉不开差距。
 *
 * ## 坑三（本版修的）：`matchKeywords` **压根没参与打分**
 *
 * 上一版"先分类、再在同类里挑"确实解决了坑二，但**代价是把关键词扔了**——
 * 同类里只按"置信度 + id"排序。于是同一个行业里的两个配方，
 * 谁被选中**跟用户说了什么完全无关**，只跟 id 的字母序有关。
 * 那 22 份配方提取出来的关键词成了**死数据**。
 *
 * 现在补回打分，用 **IDF 加权**：在候选池里越少见的词越值钱。
 * 「企业」「官网」这种每个配方都有的词权重趋近 0，而「光伏」「SaaS」这类
 * 只在少数配方里出现的词权重高——**这正是它和坑二那版的区别**：
 * 那版在全表 22 份上数命中数，通用词直接淹没具体词；现在池子先按行业缩到几份，
 * IDF 才有意义。**这个"先分类再打分"的前提不能丢。**
 *
 * ## 归不出类就返回 null
 *
 * **不硬选一个不太像的**。调用方拿到 null 就走原路（本来就有那条路），
 * 这比"猜一个"安全：猜错的模板形状会一路影响到成品站。
 */
export function matchRecipe(recipes: readonly TemplateRecipe[], query: string): TemplateRecipe | null {
  const text = query.toLowerCase();
  if (!text.trim()) return null;

  // ① 先用行业词表把用户的话归到一个分类（`categoryFromUserText` 自己会先问正典）。
  const category = categoryFromUserText(text);
  if (!category) return null;

  // ② 在候选里打分。没有候选就**不硬猜**——返回 null，让调用方走原路。
  const pool = recipes.filter((recipe) => recipe.category === category).filter(isUsableRecipe);
  if (pool.length === 0) return null;

  /**
   * 文档频率：这个关键词在**候选池**里出现在几个配方上。
   * 每个配方都有的词（df = pool.length）权重为 0；只有一个配方有的词权重最大。
   */
  const documentFrequency = new Map<string, number>();
  for (const recipe of pool) {
    // 同一配方内的重复词只算一次（否则一个配方写三遍"制造"就能刷分）
    for (const keyword of new Set(recipe.matchKeywords.map((word) => word.toLowerCase()))) {
      documentFrequency.set(keyword, (documentFrequency.get(keyword) ?? 0) + 1);
    }
  }

  const scored = pool
    .map((recipe) => {
      let keywordScore = 0;
      for (const keyword of new Set(recipe.matchKeywords.map((word) => word.toLowerCase()))) {
        if (!keyword || !text.includes(keyword)) continue;
        const df = documentFrequency.get(keyword) ?? 1;
        // `Math.log(pool / df)`：df = pool 时为 0（通用词不给分），df = 1 时最大
        keywordScore += Math.log(pool.length / df);
      }
      return {
        recipe,
        keywordScore,
        // 同类里优先可靠的形状——**作为次级排序键**，不参与关键词分
        confidenceScore: recipe.confidence === "high" ? 2 : recipe.confidence === "medium" ? 1 : 0,
      };
    })
    // 关键词分 → 置信度 → id。
    // 最后一档是**可复现**：匹配偶尔"换一个也差不多"的模板，比稳定地给一个要糟得多。
    .sort(
      (a, b) =>
        b.keywordScore - a.keywordScore ||
        b.confidenceScore - a.confidenceScore ||
        a.recipe.id.localeCompare(b.recipe.id),
    );

  // 不调模型——那正是 Recipe 的价值。
  return scored[0]?.recipe ?? null;
}

/** 给日志/界面用的一句话。 */
export function describeRecipe(recipe: TemplateRecipe): string {
  const sections = recipe.blocks.map((block) => block.type).join(" → ");
  return `${recipe.name}（${recipe.category}）· ${recipe.blocks.length} 个板块：${sections}`;
}
