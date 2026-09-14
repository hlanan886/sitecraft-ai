import type { TemplateAdapter } from "./types.ts";
import { forgeAdapter } from "./forge.ts";
import { atlasAdapter } from "./atlas.ts";
import { poweraiAdapter } from "./powerai.ts";
import { signalAdapter } from "./signal.ts";
import { moonAdapter } from "./moon.ts";
import { screwfastAdapter } from "./screwfast.ts";
import { landwindAdapter } from "./landwind.ts";
import { foxiAdapter } from "./foxi.ts";
import { astroStarterAdapter } from "./astro-starter.ts";
import { lonestoneAdapter } from "./lonestone.ts";
import { freshAdapter } from "./fresh.ts";
import { awesomeAdapter } from "./awesome.ts";
import { astrogentAdapter } from "./astrogent.ts";
import { shadcnLanding2Adapter } from "./shadcn-landing2.ts";
import { astrofyAdapter } from "./astrofy.ts";
import { devportfolioAdapter } from "./devportfolio.ts";
import { astropaperAdapter } from "./astropaper.ts";
import { yukinaAdapter } from "./yukina.ts";
import { tailwindLandingAdapter } from "./tailwind-landing.ts";
import { shadcnLandingAdapter } from "./shadcn-landing.ts";
import { nextjsLandingAdapter } from "./nextjs-landing.ts";
import { kindredAdapter } from "./kindred.ts";

/**
 * 每模板适配注册表。route 按 templateId 取 adapter；未注册模板 = 无专属适配，
 * 一律走通用槽位引擎。新增模板适配只加一个文件并在本表注册，不再改共享 route。
 */
export const templateAdapters: Readonly<Record<string, TemplateAdapter>> = {
  forge: forgeAdapter,
  atlas: atlasAdapter,
  powerai: poweraiAdapter,
  signal: signalAdapter,
  moon: moonAdapter,
  screwfast: screwfastAdapter,
  landwind: landwindAdapter,
  foxi: foxiAdapter,
  "astro-starter": astroStarterAdapter,
  lonestone: lonestoneAdapter,
  fresh: freshAdapter,
  awesome: awesomeAdapter,
  astrogent: astrogentAdapter,
  "shadcn-landing2": shadcnLanding2Adapter,
  astrofy: astrofyAdapter,
  devportfolio: devportfolioAdapter,
  astropaper: astropaperAdapter,
  yukina: yukinaAdapter,
  "tailwind-landing": tailwindLandingAdapter,
  "shadcn-landing": shadcnLandingAdapter,
  "nextjs-landing": nextjsLandingAdapter,
  kindred: kindredAdapter,
};

export function getTemplateAdapter(templateId: string): TemplateAdapter | undefined {
  return templateAdapters[templateId];
}

