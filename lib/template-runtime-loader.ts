/**
 * 运行时模板磁盘装载器（2026-09-10，方向 3 阶段 A）。
 *
 * **本文件是唯一允许 import `node:fs` 的模板注册模块**，且只能被服务端
 * 模块引用（路由 / `instrumentation`），绝不能进入客户端模块图。
 *
 * 与 `template-runtime.ts` 的分工：那边是**纯注册表 + 纯函数**（能进客户端 bundle），
 * 这边负责「从磁盘发现模板」并把结果注册进去。
 *
 * ## 为什么用「注入钩子」而不是让 `allTemplates()` 直接调本模块
 *
 * `allTemplates()` 在 `site-model.ts` 里，而 `site-model.ts` 在**客户端 bundle** 中
 * （工作台、模板页都是 client component）。若它静态 import 本文件，打包器会把
 * `node:fs` 带进浏览器 chunk，Turbopack 直接报
 * `does not support external modules (request: node:fs)` 而**构建失败**（实测）。
 *
 * 也不能靠 `require("node:fs")` 在客户端兜底：打包器会替换 `require`，
 * 运行期得到 `undefined`，被 try/catch 吞掉后表现为「服务器上也看不到沉淀模板」——
 * 一个不会报错的静默失效。所以走依赖倒置：**本模块在服务端加载时把自己注入进
 * `site-model`**，客户端无人注入即自动只看到基线。
 *
 * ## 为什么是同步
 *
 * `getTemplate()` / `allTemplates()` 是同步 API，被 20+ 处调用。
 * 若装载改成异步，整条链路都要传播 `await`，而收益为零——本来就是一次小目录读。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { setRuntimeLoader } from "./site-model.ts";
import {
  RUNTIME_TEMPLATE_DIR,
  RUNTIME_TEMPLATE_MANIFEST_FILE,
  assertRuntimeTemplateShape,
  normalizeRuntimeTemplate,
  normalizeSlotTarget,
  orderKnownTargets,
  getRuntimeTemplates,
  registerRuntimeTemplate,
  type RuntimeTemplateLoadError,
  type RuntimeTemplatePresentation,
  type RuntimeTemplateRegistration,
  type RuntimeTemplateSlot,
} from "./template-runtime.ts";

const loaderHost = globalThis as typeof globalThis & { __sitecraftRuntimeScanned?: boolean };

/**
 * 仓库根 = **当前工作目录**。
 *
 * 刻意不做「向上找 package.json」的推导：`tests/shadcn-pro-static-snapshot.test.ts`
 * 会 `process.chdir()` 到 `test-results/` 下的临时 fixture 再断言资源从 fixture 读出，
 * 而 fixture 位于仓库内——向上查找会越过它命中仓库根，让测试读到真实 vendor 目录而失败。
 *
 * 用 cwd 还有一层好处：与 `template-static.ts` 改造前的行为逐字一致，
 * 基线模板的解析语义零变化。
 */
function repoRoot(): string {
  return path.resolve(/* turbopackIgnore: true */ process.cwd());
}

/**
 * 把仓库内相对路径解析成绝对路径，**越界返回 null**。
 *
 * 运行时模板的目录名来自用户输入。不校验的话，一份名为 `../../etc` 的目录
 * 就能把资源路由变成任意文件读取。基线的 vendor 路径同样走这里，规则一致。
 */
export function resolveWithinRepo(localPath: string): string | null {
  const root = repoRoot();
  const resolved = path.resolve(/* turbopackIgnore: true */ root, localPath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

/**
 * 从任意 HTML 字符串里扫 `data-sitecraft-slot`，归一到两段式 target 列表。
 *
 * 宿主无关（不读磁盘）：登记单里引用的模板目录与本进程可能不在同一文件系统
 * （如未来把模板库放到对象存储），届时只需换掉调用方，这里的判定逻辑不变。
 */
export function collectSlotTargetsFromHtmlString(html: string): string[] {
  const targets = new Set<string>();
  const pattern = /data-sitecraft-slot\s*=\s*["']([a-zA-Z0-9_.-]+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const target = normalizeSlotTarget(match[1]);
    if (target) targets.add(target);
  }
  return orderKnownTargets(targets);
}

/**
 * 读取某个模板根目录里的入口 HTML。
 *
 * 与槽位扫描分开，是因为「读文件」会失败而「解析字符串」不会——把失败面收在
 * 一个明确返回 null 的函数里，调用方就不必用 try/catch 包住纯解析逻辑。
 */
export function readTemplateEntryHtml(localPath: string): string | null {
  const dir = resolveWithinRepo(localPath);
  if (!dir) return null;
  const indexPath = path.join(dir, "index.html");
  if (!existsSync(/* turbopackIgnore: true */ indexPath)) return null;
  try {
    return readFileSync(/* turbopackIgnore: true */ indexPath, "utf8");
  } catch {
    return null;
  }
}

/**
 * 扫描磁盘上的运行时模板。
 *
 * **同步**且**永不抛异常**——一个坏掉的注册单不能让整站 500，只跳过它并把
 * 原因收集进 `errors`，交给调用方决定记录日志还是回给用户。
 */
export function loadRuntimeTemplatesFromDisk(force = false): {
  registered: string[];
  errors: RuntimeTemplateLoadError[];
} {
  // 早退也要**如实报告当前注册表**，不能返回空数组。
  // 此前返回 `[]` 造成一个真实缺陷：`ensureRuntimeTemplateManifests()` 遍历的是
  // 本函数的返回值，于是「进程已扫过」之后再调用它，循环体一次都不执行——
  // manifest 永远注册不上，而调用方从返回值看不出任何异常（实测：模板能预览，
  // 但桥接脚本拿到空槽位表，所有字段都不可编辑）。
  if (loaderHost.__sitecraftRuntimeScanned && !force) {
    return { registered: [...getRegisteredRuntimeIds()], errors: [] };
  }
  loaderHost.__sitecraftRuntimeScanned = true;
  const result = { registered: [] as string[], errors: [] as RuntimeTemplateLoadError[] };

  const root = path.resolve(/* turbopackIgnore: true */ repoRoot(), RUNTIME_TEMPLATE_DIR);
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = readdirSync(/* turbopackIgnore: true */ root, { withFileTypes: true });
  } catch {
    // 目录不存在 = 还没有沉淀过模板，属正常空态。
    return result;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const templateDir = path.join(root, entry.name);
    const registrationPath = path.join(templateDir, RUNTIME_TEMPLATE_MANIFEST_FILE);
    try {
      const parsed = JSON.parse(readFileSync(/* turbopackIgnore: true */ registrationPath, "utf8")) as Record<string, unknown>;
      const template = normalizeRuntimeTemplate(
        assertRuntimeTemplateShape(parsed.template, registrationPath),
        path.join(RUNTIME_TEMPLATE_DIR, entry.name),
      );
      // 目录名是权威 id：localPath 已由目录名推导，若登记单里的 id 与目录名不一致，
      // 会出现「按 A 查到、资源却从 B 读」的静默错位（与方向 1 的别名坑同源）。
      if (template.id !== entry.name) {
        throw new Error(`template.id "${template.id}" does not match directory name "${entry.name}"`);
      }
      // 没有 index.html 的模板进目录只会让用户点进一个 404 预览页，
      // 且在 preview 路由里会退化成「抓取空 demoUrl」而抛错。宁可在这里拒收。
      if (!existsSync(/* turbopackIgnore: true */ path.join(templateDir, "index.html"))) {
        throw new Error("index.html not found in template directory");
      }
      registerRuntimeTemplate({
        template,
        slots: parsed.slots as RuntimeTemplateSlot[] | undefined,
        presentation: parsed.presentation as RuntimeTemplatePresentation[] | undefined,
        requiredVisibleTargets: parsed.requiredVisibleTargets as string[] | undefined,
        // 质量门结论随登记单持久化（阶段 C）：它决定该模板是否参与 AI 推荐，
        // 而"是否靠开关绕过门禁"是**当时**的事实，事后无法从 HTML 反推。
        quality: parsed.quality as RuntimeTemplateRegistration["quality"],
      });
      result.registered.push(template.id);
    } catch (error) {
      result.errors.push({
        templateId: entry.name,
        path: registrationPath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

/** 当前已注册的运行时模板 id（供早退分支如实报告，不触发重新扫描）。 */
function getRegisteredRuntimeIds(): string[] {
  return getRuntimeTemplates().map((template) => template.id);
}

/** 幂等入口——供需要「现在就能看到全部模板」的服务端调用点使用。 */
export function ensureRuntimeTemplatesLoadedSync(): void {
  loadRuntimeTemplatesFromDisk();
}

/** 测试用：允许下次调用重新扫描（配合 `resetRuntimeTemplatesForTest`）。 */
export function resetRuntimeTemplateLoaderForTest(): void {
  loaderHost.__sitecraftRuntimeScanned = false;
}

// 把自己注入 `site-model`：本模块被服务端加载即代表「这台进程能读磁盘」，
// 此后 `allTemplates()` 每次调用都会确保装载已发生。客户端不会加载本模块，
// 因此那边的钩子保持 undefined，`allTemplates()` 自然只返回基线。
setRuntimeLoader(ensureRuntimeTemplatesLoadedSync);
