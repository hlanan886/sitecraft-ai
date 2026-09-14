/**
 * `lib/template-from-url.ts` 的**按需替身**（`tests/alias-loader.mjs` 按
 * `SITECRAFT_TEST_SUBSTITUTIONS` 把该别名重定向到这里）。
 *
 * ## 边界：同形状，不是"另一个实现"
 *
 * 只把**编排函数**换成脚本化返回值；类型与 `DEFAULT_DEPS` 原样保留下来，
 * 因为路由会转调它们（`DEFAULT_DEPS` 是"A 轨第一版假门禁"的教训——测试要靠它
 * 断言"真实现没被换掉"）。
 *
 * ⚠️ **本文件不得 import 任何真实模块**：一旦 import，真实模块会在导入期拉进
 * 存储层（固化数据目录），替身的副作用就溢出到测试进程之外了。所有返回值都来自
 * `fakeOr` 的数据表。
 *
 * ⚠️ 因为 `allowImportingTsExtensions` 开着，这里可以从 `@/lib/...` 解析。
 * 但 `@/lib/testing/substitution` 是**唯一**允许的 import——它是零副作用的纯函数模块。
 */
import { fakeOr } from "@/lib/testing/substitution";

export type StaticTemplateBundle = {
  templateId: string;
  name: string;
  category: string;
  description: string;
  html: string;
  assets: Record<string, string>;
  binaryAssets: Record<string, string>;
  initialDraft: null;
  summary: string;
  warnings: string[];
  library: Array<{ role: string; url: string }>;
  stats: {
    captureMs: number;
    downloadMs: number;
    totalMs: number;
    resourceCount: number;
    totalBytes: number;
    rewritten: number;
  };
};

export type CreateFromUrlInput = { url: string; suffix?: string; collectLibrary?: boolean; maxAssetBytes?: number };

export type CreateFromUrlResult =
  | { ok: true; bundle: StaticTemplateBundle; capture: unknown }
  | { ok: false; step: "capture" | "export" | "slots"; message: string; detail?: string };

export type CreateFromUrlDeps = {
  captureSite: (...args: never[]) => unknown;
  exportStaticTemplate: (...args: never[]) => unknown;
};

/**
 * ⚠️ **故意不导出可用实现**。
 *
 * 真实模块里这是"默认实现"，测试会拿它断言"真实现没被换成桩"。替身场景下
 * 导出真实现就等于把真实模块拉进来（见文件头）。所以这里给一个**会抛**的哨兵：
 * 谁在替身场景下碰它，谁就得当场知道"这条断言在替身模式下不成立"。
 */
function unavailable(): never {
  throw new Error("[substitutes/template-from-url] 替身模式下 DEFAULT_DEPS 不可用（它属于真实模块）");
}
export const DEFAULT_DEPS: CreateFromUrlDeps = { captureSite: unavailable, exportStaticTemplate: unavailable };

/** 从 URL 造模板 id 是**纯函数**，路由不调用它——替身保持同形状即可。 */
export function templateIdFromUrl(): never {
  throw new Error("[substitutes/template-from-url] 替身模式下不该调用 templateIdFromUrl");
}

export async function createTemplateFromUrl(): Promise<CreateFromUrlResult> {
  return fakeOr("@/lib/template-from-url", "createTemplateFromUrl") as CreateFromUrlResult;
}
