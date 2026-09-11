import assert from "node:assert/strict";
import test from "node:test";

import { formatGenerationProgress, getGenerationProgress } from "../lib/generation-experience.ts";

test("formats generation progress as a bounded visible percentage", () => {
  assert.equal(formatGenerationProgress(-2), "0%");
  assert.equal(formatGenerationProgress(42.6), "43%");
  assert.equal(formatGenerationProgress(100), "100%");
  assert.equal(formatGenerationProgress(120), "100%");
});

test("generation progress increases with completed sections and reaches 100 only at terminal", () => {
  const input = {
    phase: "content" as const,
    sections: ["hero", "about", "contact"],
    completedSections: [],
    failedSections: [],
    elapsedMs: 0,
  };
  const initial = getGenerationProgress(input);
  const oneSection = getGenerationProgress({ ...input, completedSections: ["hero"] });
  const allSections = getGenerationProgress({ ...input, completedSections: ["hero", "about", "contact"] });

  assert.ok(initial < oneSection);
  assert.ok(oneSection < allSections);
  assert.ok(allSections < 100);
  assert.equal(getGenerationProgress({ ...input, completedSections: ["hero", "about", "contact"], terminal: true }), 100);
});
