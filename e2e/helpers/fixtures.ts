import { test as base } from "@playwright/test";
import { createSite } from "./api";

type Fixtures = { demoSite: { id: string } };

export const test = base.extend<Fixtures>({
  demoSite: async ({ request }, use) => {
    await use(await createSite(request));
  },
});

export { expect } from "@playwright/test";
