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
