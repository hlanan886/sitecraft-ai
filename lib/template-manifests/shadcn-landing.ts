import type { TemplateManifest } from "./types.ts";
import { ALL_UI_SURFACES, BOTH_LOCALES, NON_CONTENT_SLOTS, contentSlots } from "./shared.ts";

export const shadcnLandingManifest: TemplateManifest = {
  templateId: "shadcn-landing",
  displayName: "SHADCN / Modern Landing",
  manifestVersion: 1,
  runtime: "next-static",
  nativeLocales: ["en"],
  outputLocales: BOTH_LOCALES,
  localizedUi: ALL_UI_SURFACES,
  requiredVisibleTargets: ["heroTitle"],
  slots: contentSlots({
      "hero.title": ["Shadcn landing page"],
      "about.body": ["Lorem ipsum dolor sit amet, consectetur adipiscing elit"],
    }),
  nonContentSlots: NON_CONTENT_SLOTS,
  recommendation: "eligible",
};
