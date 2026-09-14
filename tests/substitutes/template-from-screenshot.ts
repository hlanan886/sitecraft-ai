/**
 * `lib/template-from-screenshot.ts` 的**按需替身**——边界与
 * `tests/substitutes/template-from-url.ts` 完全相同，见那份的文件头。
 *
 * ⚠️ 本文件**不得 import 任何真实模块**（含 `@/lib/testing/substitution` 之外的）。
 */
import { fakeOr } from "@/lib/testing/substitution";

export type TemplateBundle = {
  templateId: string;
  name: string;
  category: string;
  description: string;
  html: string;
  assets: Record<string, string>;
  binaryAssets: Record<string, string>;
  initialDraft: unknown;
  tokens: unknown;
  summary: string;
  warnings: string[];
  stats: { model: string; latencyMs: number; visionMs: number; composeMs: number; shotMs: number };
};

export type CreateFromScreenshotInput = {
  source: { kind: "upload"; urlPath: string } | { kind: "url"; url: string };
  note?: string;
  siteModel?: "corporate" | "portfolio" | "blog";
  withProductImages?: boolean;
  suffix?: string;
  signal?: AbortSignal;
};

export type CreateFromScreenshotResult =
  | { ok: true; bundle: TemplateBundle; understanding: unknown }
  | { ok: false; step: "read" | "capture" | "vision" | "compose"; message: string; detail?: string };

export type CreateFromScreenshotDeps = {
  readStoredImage: (...args: never[]) => unknown;
  requestVisionDsl: (...args: never[]) => unknown;
  takeProductShots: (...args: never[]) => unknown;
  captureSite: (...args: never[]) => unknown;
};

/** 同 A 轨替身：真现在替身模式下不该被碰，碰了就抛（说明测试写错了）。 */
function unavailable(): never {
  throw new Error("[substitutes/template-from-screenshot] 替身模式下 DEFAULT_DEPS 不可用（它属于真实模块）");
}
export const DEFAULT_DEPS: CreateFromScreenshotDeps = {
  readStoredImage: unavailable,
  requestVisionDsl: unavailable,
  takeProductShots: unavailable,
  captureSite: unavailable,
};

export async function createTemplateFromScreenshot(): Promise<CreateFromScreenshotResult> {
  return fakeOr("@/lib/template-from-screenshot", "createTemplateFromScreenshot") as CreateFromScreenshotResult;
}
