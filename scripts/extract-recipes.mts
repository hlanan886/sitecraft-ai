/**
 * 提取模板配方（Recipe × 22）。
 *
 * 用法：
 *   node --experimental-strip-types scripts/extract-recipes.mts                # 线上 demo
 *   node --experimental-strip-types scripts/extract-recipes.mts --local        # 本地构建产物
 *   node --experimental-strip-types scripts/extract-recipes.mts --preview      # 我们自己的预览端点
 *   node --experimental-strip-types scripts/extract-recipes.mts forge atlas    # 只做指定的几个
 *
 * ## 三种来源，各有适用范围（实测后定的）
 *
 * | 来源 | 什么时候用 | 实测结果 |
 * |---|---|---|
 * | 线上 demo | 最接近"用户看到什么" | 22 个里 **9 个抓不到**（超时/域名没了/拒连） |
 * | 本地 dist（`file://`） | 离线、稳定 | 9 个全成，**但 SPA 类模板渲染不出来** |
 * | **我们自己的预览端点** | **最贴近系统里的真实渲染** | ✅ 推荐 |
 *
 * ### 为什么预览端点最好
 *
 * 它是**这些模板在我们系统里真实的渲染结果**——资源路径重写、设计 token 注入
 * 都在那条路上做过。用别的来源提取出的配方，与用户实际看到的可能不是一回事。
 *
 * ### 为什么 `file://` 对 SPA 无效（实测）
 *
 * `shadcn-landing` 是 Vite/React 构建产物，HTML 只有 1653 字符的空壳，
 * 脚本写的是绝对路径 `/assets/xxx.js`——`file://` 下解析到**文件系统根**，
 * JS 加载不到，**等 10 秒 `#root` 依然是空的**（不是时序问题）。
 * 截图 1440×900 整一个空视口，模型只能读出 1 个板块。
 * 走预览端点后同一模板变成 `1069×7472`，**真正渲染出来了**。
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { templates } from "../lib/site-model.ts";
import { captureSite } from "../lib/site-capture-browser.ts";
import { requestVisionDsl } from "../lib/ai-provider.ts";
import { buildVisionSystemPrompt, buildVisionUserPrompt, coerceVisionDsl, toDataUrl } from "../lib/site-vision.ts";
import type { TemplateRecipe } from "../lib/template-recipe.ts";

const OUT_DIR = path.resolve(".sitecraft-data/recipes");
const useLocal = process.argv.includes("--local");
const usePreview = process.argv.includes("--preview");
const baseUrl = (process.env.SITECRAFT_BASE ?? "http://localhost:3000").replace(/\/$/, "");
const only = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const targets = only.length > 0 ? templates.filter((t) => only.includes(t.id)) : templates;

type SourceLabel = "线上" | "本地" | "预览";

function resolveTarget(template: (typeof templates)[number]): { url: string; label: SourceLabel } | null {
  if (usePreview) {
    return { url: `${baseUrl}/api/templates/${encodeURIComponent(template.id)}/preview`, label: "预览" };
  }
  if (useLocal) {
    return {
      url: pathToFileURL(path.resolve(process.cwd(), template.source.localPath, "dist", "index.html")).href,
      label: "本地",
    };
  }
  return template.source.demoUrl ? { url: template.source.demoUrl, label: "线上" } : null;
}

type Outcome = { id: string; ok: true; blocks: number; confidence: string } | { id: string; ok: false; reason: string };
const outcomes: Outcome[] = [];

await mkdir(OUT_DIR, { recursive: true });

for (const template of targets) {
  const target = resolveTarget(template);
  if (!target) {
    outcomes.push({ id: template.id, ok: false, reason: "没有可抓的地址" });
    continue;
  }
  const { url: demoUrl, label } = target;
  process.stdout.write(`${template.id.padEnd(18)} [${label}] `);
  try {
    const capture = await captureSite(demoUrl, { shotDir: ".sitecraft-data/captures", downloadAssets: false });
    if (capture.failure || !capture.shot) {
      outcomes.push({ id: template.id, ok: false, reason: capture.failure ?? "没截出图" });
      console.log(`✗ ${capture.failure ?? "没截出图"}`.slice(0, 90));
      continue;
    }

    const called = await requestVisionDsl({
      imageDataUrl: toDataUrl(capture.shot.body.toString("base64"), "image/jpeg"),
      systemPrompt: buildVisionSystemPrompt(),
      // 页面标题是**免费且可靠**的上下文——比模型从图上猜公司名准得多
      userPrompt: buildVisionUserPrompt({ titleHint: capture.title }),
    });
    if (!called.ok) {
      outcomes.push({ id: template.id, ok: false, reason: called.error });
      console.log(`✗ ${called.error}`.slice(0, 90));
      continue;
    }

    const coerced = coerceVisionDsl(called.raw, { locale: "zh" });
    if (!coerced.ok) {
      outcomes.push({ id: template.id, ok: false, reason: coerced.issues.join("；") });
      console.log(`✗ 归一失败：${coerced.issues[0]}`.slice(0, 90));
      continue;
    }

    /**
     * ⚠️ `matchKeywords` 用模板自己的 `promptProfile`，**不用模型生成的**。
     *
     * 那是一份人写的、经过核实的行业描述（"工业制造"、"外贸目录"…），
     * 拿它当匹配词比让模型再编一组词可靠。模型只负责**它才看得懂的那部分**：
     * 结构长什么样。
     */
    const recipe: TemplateRecipe = {
      id: template.id,
      name: template.name,
      category: template.category,
      matchKeywords: [
        template.category,
        ...template.tags,
        // 模板的 role 是一句人写的定位（"面向制造业的产品展示型官网"），拆成词
        ...template.promptProfile.role.split(/[，,、\s]+/).filter((word) => word.length >= 2),
      ].filter((word, index, list) => list.indexOf(word) === index),
      blocks: coerced.dsl.blocks,
      tokens: coerced.dsl.tokens,
      confidence: coerced.dsl.confidence,
      warnings: coerced.warnings,
      extracted: { at: new Date().toISOString(), from: demoUrl, model: called.model, source: label },
    };

    await writeFile(path.join(OUT_DIR, `${template.id}.json`), JSON.stringify(recipe, null, 2), "utf8");
    outcomes.push({ id: template.id, ok: true, blocks: recipe.blocks.length, confidence: recipe.confidence });
    console.log(`✓ ${recipe.blocks.length} 块 · ${recipe.confidence} · ${recipe.blocks.map((b) => b.type).join("→")}`);
  } catch (error) {
    outcomes.push({ id: template.id, ok: false, reason: error instanceof Error ? error.message : String(error) });
    console.log(`✗ ${error instanceof Error ? error.message.slice(0, 80) : "未知错误"}`);
  }
}

const ok = outcomes.filter((o) => o.ok);
console.log(`\n=== 汇总 ===`);
console.log(`成功 ${ok.length} / ${outcomes.length}`);
const byConfidence = { high: 0, medium: 0, low: 0 };
for (const item of ok) byConfidence[item.confidence as keyof typeof byConfidence] += 1;
console.log(`把握度：high ${byConfidence.high} · medium ${byConfidence.medium} · low ${byConfidence.low}`);
const failed = outcomes.filter((o) => !o.ok);
if (failed.length > 0) {
  console.log(`\n失败的 ${failed.length} 个：`);
  for (const item of failed) console.log(`  ${item.id}: ${item.reason.slice(0, 100)}`);
}
console.log(`\n产出目录：${OUT_DIR}`);
