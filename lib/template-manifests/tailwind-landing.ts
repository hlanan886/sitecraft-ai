import type { TemplateManifest } from "./types.ts";
import { ALL_UI_SURFACES, BOTH_LOCALES, NON_CONTENT_SLOTS, contentSlots } from "./shared.ts";

export const tailwindLandingManifest: TemplateManifest = {
  templateId: "tailwind-landing",
  displayName: "TAILWIND LANDING / Business",
  manifestVersion: 1,
  runtime: "static-html",
  nativeLocales: ["en"],
  outputLocales: BOTH_LOCALES,
  localizedUi: ALL_UI_SURFACES,
  requiredVisibleTargets: ["heroTitle"],
  slots: contentSlots({
      "hero.title": ["Main Hero Message to sell yourself", "Tailwind Starter Template"],
    }),
  nonContentSlots: NON_CONTENT_SLOTS,
  recommendation: "eligible",
};
