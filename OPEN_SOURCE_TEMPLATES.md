# Open-source template sources

The template catalog is sourced from public repositories with MIT licenses. The builder keeps a normalized site schema so content can be edited by AI, while each catalog entry exposes its original repository and, where available, live demo.

| Catalog entry | Source repository | License | Stack | Demo |
| --- | --- | --- | --- | --- |
| SMALL BIS | [Dillonpw/small-bis](https://github.com/Dillonpw/small-bis) | MIT | Astro + Tailwind | [small-bis.vercel.app](https://small-bis.vercel.app/) |
| ATLAS / Astroplate | [zeon-studio/astroplate](https://github.com/zeon-studio/astroplate) | MIT | Astro + Tailwind + TypeScript | [astroplate.netlify.app](https://astroplate.netlify.app/) |
| SIGNAL / RicoFast | [ricocc/ricoui-saas-template](https://github.com/ricocc/ricoui-saas-template) | MIT | Astro + Tailwind | [ricofast.pages.dev](https://ricofast.pages.dev/) |
| KINDRED / Odyssey Theme | [treefarmstudio/odyssey-theme](https://github.com/treefarmstudio/odyssey-theme) | MIT | Astro | [odyssey-theme.sapling.supply](https://odyssey-theme.sapling.supply/) |
| GENAI | [ctrimm/astro-genai-startup-theme](https://github.com/ctrimm/astro-genai-startup-theme) | MIT | Astro + React + Tailwind | [GitHub Pages](https://ctrimm.github.io/astro-genai-startup-theme/) |
| LANDWIND | [themesberg/landwind](https://github.com/themesberg/landwind) | MIT | Tailwind + Flowbite | [demo.themesberg.com/landwind](https://demo.themesberg.com/landwind/) |
| ASTROWIND | [arthelokyo/astrowind](https://github.com/arthelokyo/astrowind) | MIT | Astro + Tailwind | [astrowind.vercel.app](https://astrowind.vercel.app/) |
| TAILCAST | [matt765/Tailcast](https://github.com/matt765/Tailcast) | MIT | Astro + Tailwind | [tailcast.vercel.app](https://tailcast.vercel.app/) |
| AWESOME | [ttntm/astro-landing-page](https://github.com/ttntm/astro-landing-page) | MIT | Astro + Tailwind | [GitHub Pages](https://ttntm.github.io/astro-landing-page/) |
| ASTROFY | [manuelernestog/astrofy](https://github.com/manuelernestog/astrofy) | MIT | Astro + Tailwind | [astrofy-template.netlify.app](https://astrofy-template.netlify.app/) |
| ASTROPAPER | [satnaing/astro-paper](https://github.com/satnaing/astro-paper) | MIT | Astro + TypeScript | [astro-paper.pages.dev](https://astro-paper.pages.dev/) |
| MOON | [mhyfritz/astro-landing-page](https://github.com/mhyfritz/astro-landing-page) | MIT | Astro + Tailwind | [astro-moon-landing.netlify.app](https://astro-moon-landing.netlify.app/) |
| ASTROGENT | [fauziralpiandi/astrogent](https://github.com/fauziralpiandi/astrogent) | MIT | Astro + Tailwind | [astrogent.vercel.app](https://astrogent.vercel.app/) |
| DEVPORTFOLIO | [RyanFitzgerald/devportfolio](https://github.com/RyanFitzgerald/devportfolio) | MIT | HTML + Sass + JavaScript | [GitHub Pages](https://ryanfitzgerald.github.io/devportfolio) |
| FOXI | [oxygenna-themes/foxi-astro-theme](https://github.com/oxygenna-themes/foxi-astro-theme) | MIT | Astro + Tailwind | [foxi.netlify.app](https://foxi.netlify.app/) |
| YUKINA | [WhitePaper233/yukina](https://github.com/WhitePaper233/yukina) | MIT | Astro + Tailwind | [yukina-blog.vercel.app](https://yukina-blog.vercel.app) |

The complete upstream sources are pinned as Git submodules under `vendor/open-source-templates/<id>`, including the upstream license files. Clone with `--recurse-submodules` to populate them. RicoFast declares MIT in its `package.json`. The application renders allowlisted official demos through a read-only preview adapter and maps structured content into those pages without executing upstream scripts.

Every catalog entry also owns an AI prompt profile with a source-aware role, page structure, editable targets, visual rules, hard guardrails, and starter prompts. The model may only return the validated structured change fields; it cannot submit raw markup or code.
