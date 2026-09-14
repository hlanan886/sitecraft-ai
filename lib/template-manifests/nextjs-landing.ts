import type { TemplateManifest } from "./types.ts";
import { ALL_UI_SURFACES, BOTH_LOCALES, NON_CONTENT_SLOTS, contentSlots } from "./shared.ts";

export const nextjsLandingManifest: TemplateManifest = {
  templateId: "nextjs-landing",
  displayName: "NEXT LANDING / Corporate",
  manifestVersion: 1,
  runtime: "next-static",
  nativeLocales: ["en"],
  outputLocales: BOTH_LOCALES,
  localizedUi: ALL_UI_SURFACES,
  requiredVisibleTargets: ["heroTitle"],
  slots: contentSlots({
    "hero.title": ["Next.js Boilerplate", "React SaaS Boilerplate"],
    "about.body": ["Built with Next.js and Tailwind CSS"],
    "features.items": ["Everything you need"],
    "services.items": ["Our services"],
    products: ["Simple pricing"],
    "contact.title": ["Contact Us"],
    "contact.body": ["Start your project today"],
  }),
  nonContentSlots: NON_CONTENT_SLOTS,
  recommendation: "eligible",
};
