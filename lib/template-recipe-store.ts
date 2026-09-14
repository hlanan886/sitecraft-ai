/**
 * 配方的读取层（**只允许服务端 import**）。
 *
 * ## 为什么与 `template-recipe.ts` 分开
 *
 * 照抄 `site-capture.ts` / `site-capture-browser.ts` 那条分工：
 * **纯逻辑读不了磁盘，读磁盘的不该进客户端 bundle**。
 * `matchRecipe` / `normalizeBlockOrder` 是纯函数，前端和测试都要用；
 * 本模块碰 `node:fs`，**只能服务端用**。混在一起会让 Turbopack
 * 在客户端构建时报 `does not support external modules`（同项目已踩过两次）。
 *
 * ## 配方存在哪、为什么
 *
 * `.sitecraft-data/recipes/<id>.json`——与站点草稿、模板产物同一套本地存储。
 * 不放进 `lib/` 是因为它们是**产物不是源码**：由 `scripts/extract-recipes.mts`
 * 生成，重新提取会覆盖。放源码目录里会让人以为是手写的。
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isUsableRecipe, matchRecipe, type TemplateRecipe } from "./template-recipe.ts";

const RECIPES_DIR = path.join(process.cwd(), ".sitecraft-data", "recipes");

let cache: TemplateRecipe[] | null = null;

/**
 * 读全部配方。
 *
 * **带进程内缓存**——配方是静态产物（重新提取才变），而匹配是每次建站都要跑的，
 * 每次都读 22 个文件没有必要。
 *
 * ⚠️ 缓存要能失效：`reloadRecipes()` 供提取脚本跑完后清缓存用
 * （否则同一个进程里刚提完的配方读不到）。
 */
export async function loadRecipes(): Promise<TemplateRecipe[]> {
  if (cache) return cache;
  const files = await readdir(RECIPES_DIR).catch(() => [] as string[]);
  const recipes: TemplateRecipe[] = [];
  for (const fileName of files) {
    if (!fileName.endsWith(".json")) continue;
    const raw = await readFile(path.join(RECIPES_DIR, fileName), "utf8").catch(() => "");
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as TemplateRecipe;
      // 只收**结构完整**的——半个配方混进来会让匹配给出错误的形状
      if (typeof parsed?.id === "string" && Array.isArray(parsed.blocks) && parsed.tokens) {
        recipes.push(parsed);
      }
    } catch {
      // 坏掉的配方跳过（不让它拖垮整批）——但下面的 `loadRecipeReport` 会如实报出来
    }
  }
  cache = recipes;
  return recipes;
}

export function reloadRecipes(): void {
  cache = null;
}

/**
 * 体检：22 份配方有多少**真能拿去用**。
 *
 * 与 `mirroredAssetsHealth` 同一个思路——**"表里有登记、实际用不了"这种状态
 * 必须能被主动发现**，而不是等到用户建站时才暴露。
 */
export async function recipesHealth(): Promise<{
  total: number;
  usable: number;
  unusable: Array<{ id: string; reason: string }>;
  byConfidence: Record<string, number>;
  /** 按结构分组的样本——一眼看出 22 个模板的形状有多集中 */
  shapes: Array<{ shape: string; count: number }>;
}> {
  const recipes = await loadRecipes();
  const unusable: Array<{ id: string; reason: string }> = [];
  const byConfidence: Record<string, number> = {};
  const shapeCounts = new Map<string, number>();

  for (const recipe of recipes) {
    byConfidence[recipe.confidence] = (byConfidence[recipe.confidence] ?? 0) + 1;
    const shape = recipe.blocks.map((block) => block.type).join("→");
    shapeCounts.set(shape, (shapeCounts.get(shape) ?? 0) + 1);
    if (!isUsableRecipe(recipe)) {
      const reason = !recipe.blocks.some((block) => block.type === "hero")
        ? "没有首屏（拼出来过不了入库门禁）"
        : `只有 ${recipe.blocks.length} 个板块（太少，拼不出完整站）`;
      unusable.push({ id: recipe.id, reason });
    }
  }

  return {
    total: recipes.length,
    usable: recipes.length - unusable.length,
    unusable,
    byConfidence,
    shapes: [...shapeCounts]
      .map(([shape, count]) => ({ shape, count }))
      .sort((a, b) => b.count - a.count || a.shape.localeCompare(b.shape)),
  };
}

/** 按用户那句话挑一个配方（读盘版）。 */
export async function matchRecipeFor(query: string): Promise<TemplateRecipe | null> {
  return matchRecipe(await loadRecipes(), query);
}

/** 按 id 取一份（给"我想用这个模板的形状"这类显式选择用）。 */
export async function getRecipe(id: string): Promise<TemplateRecipe | null> {
  return (await loadRecipes()).find((recipe) => recipe.id === id) ?? null;
}
