import type { TemplateManifest } from "./types.ts";
import { forgeManifest } from "./forge.ts";
import { screwfastManifest } from "./screwfast.ts";
import { nextjsLandingManifest } from "./nextjs-landing.ts";
import { shadcnLanding2Manifest } from "./shadcn-landing2.ts";
import { atlasManifest } from "./atlas.ts";
import { signalManifest } from "./signal.ts";
import { kindredManifest } from "./kindred.ts";
import { poweraiManifest } from "./powerai.ts";
import { landwindManifest } from "./landwind.ts";
import { lonestoneManifest } from "./lonestone.ts";
import { astroStarterManifest } from "./astro-starter.ts";
import { awesomeManifest } from "./awesome.ts";
import { astrofyManifest } from "./astrofy.ts";
import { astropaperManifest } from "./astropaper.ts";
import { moonManifest } from "./moon.ts";
import { astrogentManifest } from "./astrogent.ts";
import { devportfolioManifest } from "./devportfolio.ts";
import { foxiManifest } from "./foxi.ts";
import { yukinaManifest } from "./yukina.ts";
import { freshManifest } from "./fresh.ts";
import { shadcnLandingManifest } from "./shadcn-landing.ts";
import { tailwindLandingManifest } from "./tailwind-landing.ts";

export const templateManifests: Readonly<Record<string, TemplateManifest>> = {
  forge: forgeManifest,
  screwfast: screwfastManifest,
  "nextjs-landing": nextjsLandingManifest,
  "shadcn-landing2": shadcnLanding2Manifest,
  atlas: atlasManifest,
  signal: signalManifest,
  kindred: kindredManifest,
  powerai: poweraiManifest,
  landwind: landwindManifest,
  lonestone: lonestoneManifest,
  "astro-starter": astroStarterManifest,
  awesome: awesomeManifest,
  astrofy: astrofyManifest,
  astropaper: astropaperManifest,
  moon: moonManifest,
  astrogent: astrogentManifest,
  devportfolio: devportfolioManifest,
  foxi: foxiManifest,
  yukina: yukinaManifest,
  fresh: freshManifest,
  "shadcn-landing": shadcnLandingManifest,
  "tailwind-landing": tailwindLandingManifest,
};

/**
 * 运行时 manifest 注册表（2026-09-10，方向 3 阶段 A）。
 *
 * 与 `runtimeTemplates`（`lib/template-runtime.ts`）配对：模板进注册表后，
 * 其槽位声明也必须在 **15 处读取点**都可见，否则会出现
 * 「预览认得、覆盖统计不认得」的半接入状态。
 *
 * 本文件保持**纯数据 + 纯函数**（不碰 fs），因为它在客户端 bundle 里
 * （`components/open-source-template-frame.tsx` 会 import 本模块）。
 * 装载磁盘的胶水放在 `lib/template-runtime-bootstrap.ts`，只由服务端路由调用。
 */
const runtimeManifests = new Map<string, TemplateManifest>();

/** 注册一个运行时 manifest。同 id 覆盖（用于重新沉淀同一模板）。 */
export function registerTemplateManifest(manifest: TemplateManifest): void {
  runtimeManifests.set(manifest.templateId, manifest);
}

/**
 * 取 manifest：**静态基线优先**。
 *
 * 基线优先是刻意的——`registerRuntimeTemplate` 已禁止运行时模板与基线重名，
 * 这里的顺序只是第二道保险：万一有人绕过注册 API 直接写 map，
 * 也不会让一个 22 个契约测试覆盖不到的 manifest 顶掉已被验证的基线。
 */
export function lookupTemplateManifest(templateId: string): TemplateManifest | undefined {
  return templateManifests[templateId as keyof typeof templateManifests] ?? runtimeManifests.get(templateId);
}

export function getRuntimeTemplateManifests(): TemplateManifest[] {
  return [...runtimeManifests.values()];
}

/** 测试用：清空运行时 manifest（不动基线）。 */
export function resetRuntimeTemplateManifestsForTest(): void {
  runtimeManifests.clear();
}
