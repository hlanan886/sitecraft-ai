# Sitecraft E2E And Visual QA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build deterministic Playwright exploratory coverage for the generate, confirmation, workspace, template, and global error flows; fix confirmed interaction defects; and visually validate coordinated design tokens.

**Architecture:** Playwright runs serially against a production Next.js server on port 3210 and a shared Postgres instance. Each test creates its own site, AI traffic is deterministic SSE by default, and real DeepSeek coverage is isolated behind `@real`. Interaction fixes remain in existing client components; token coordination remains a pure function in `lib/design-variants.ts`.

**Tech Stack:** Next.js 16.3.1, React 19.2, TypeScript, Node 24, Playwright Chromium, Docker Postgres.

## Global Constraints

- Keep `npm test` unchanged and preserve all existing unit tests.
- Run E2E in production mode on `http://127.0.0.1:3210` with one worker.
- Use mock SSE by default; only `npm run test:e2e:real` may spend AI tokens.
- Do not implement fact checking, structure checking, generation records, import logic, or onboarding logic owned by the other executor.
- Reuse existing Zod, SSE, revision, `SiteRenderer`, iframe fallback, and design token mechanisms.
- Do not publish, add lead storage, add multi-variant generation, add quotas, or export code.

---

### Task 1: Reproducible Playwright Runtime

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `.gitignore`
- Create: `playwright.config.ts`
- Create: `e2e/tsconfig.json`
- Create: `e2e/scripts/serve.mjs`
- Create: `e2e/scripts/run-real.mjs`
- Create: `e2e/global-setup.ts`
- Create: `e2e/README.md`

**Interfaces:**
- Produces: production server on port 3210, JSON/HTML/list reports, optional `E2E_REAL_AI=1` runner.

- [ ] Add Playwright scripts without changing `test`.
- [ ] Configure serial Chromium execution and retained failure artifacts.
- [ ] Add a server launcher that checks Postgres, rebuild freshness, and forwards termination.
- [ ] Add global reachability and Postgres checks.
- [ ] Document installation, deterministic runs, real runs, and failure artifacts.
- [ ] Run `npm run test:e2e -- --list`; expect specs to be discovered without loading errors.

### Task 2: Deterministic Test Helpers

**Files:**
- Create: `e2e/helpers/mock-ai.ts`
- Create: `e2e/helpers/api.ts`
- Create: `e2e/helpers/ui.ts`
- Create: `e2e/helpers/fixtures.ts`

**Interfaces:**
- Produces: `sseBody`, `readyIntent`, `mockAnalyze`, `mockChat`, `createSite`, `getDraft`, `putManualOps`, `analyzeAndConfirm`, `expectNoCrash`, `watchPageErrors`, `snap`, and `demoSite`.

- [ ] Encode SSE as `data: <json>\n\n` and branch on `intent.status`.
- [ ] Keep non-analyze generate traffic available to explicit execute mocks.
- [ ] Create one site per test and expose typed API helpers.
- [ ] Capture page errors and attach step screenshots to reports.
- [ ] Run helper-consuming smoke test; expect one deterministic confirmation page.

### Task 3: A-E Exploratory Coverage

**Files:**
- Create: `e2e/specs/generate-flow.spec.ts`
- Create: `e2e/specs/confirm-flow.spec.ts`
- Create: `e2e/specs/workspace.spec.ts`
- Create: `e2e/specs/templates.spec.ts`
- Create: `e2e/specs/global-checks.spec.ts`
- Create: `e2e/specs/smoke-real.spec.ts`
- Create: `e2e/specs/probe-extra.spec.ts`

**Interfaces:**
- Consumes: Task 1 runtime and Task 2 helpers.
- Produces: deterministic regressions for validation, rapid actions, state history, fallback previews, filters, offline errors, and disabled states.

- [ ] Add invalid, mixed-language, clarification, rejection, rapid-submit, reload, and import-context probes.
- [ ] Add all-visible/all-hidden and template-switch confirmation probes.
- [ ] Add repeated edit, destructive confirmation, undo/redo, locale isolation, fallback preview, and guide probes.
- [ ] Add exact template category counts and rapid filter probes.
- [ ] Add missing-key, offline, duplicate-submit, disabled-state, and navigation probes.
- [ ] Add an opt-in `@real` generation and chat smoke test.
- [ ] Run all mock specs; classify each failure as product defect, test defect, or environment defect.

### Task 4: Interaction Defect Fixes

**Files:**
- Modify only the component/API files implicated by failing Task 3 regressions.
- Test: the matching `e2e/specs/*.spec.ts` file for every confirmed defect.
- Create: `docs/codex-task-B-exploratory-report.md`

**Interfaces:**
- Consumes: reproducible failing Playwright case and researched source.
- Produces: minimal architecture-aligned fix and green regression.

- [ ] Record the exact reproduction and expected failure before production edits.
- [ ] Search official or established sources for the defect pattern.
- [ ] Select the smallest option compatible with existing project mechanisms.
- [ ] Implement one defect at a time and rerun its focused regression.
- [ ] Record severity, source URL, selection rationale, files, and regression name.

### Task 5: Coordinated Design Tokens And Visual QA

**Files:**
- Modify: `lib/design-variants.ts`
- Test: `tests/design-variants.test.ts`
- Modify: UI/CSS files only where screenshot evidence shows a defect.
- Add screenshots under Playwright `test-results/steps/` during verification.

**Interfaces:**
- Produces: `coordinateDesignTokens(tokens, context)` and fallback metadata consumed by `deriveDesignTokens`.

- [ ] Write failing pure-function tests for clashing primary/accent colors, tone-density conflict, and industry-font mismatch.
- [ ] Verify each test fails for the intended missing coordination behavior.
- [ ] Implement relative luminance/color-distance checks and category defaults without adding dependencies.
- [ ] Run the focused unit test and full unit suite.
- [ ] Capture coordinated, clashing-input fallback, and semantic-conflict fallback screenshots.
- [ ] Visually inspect import, guide, and confirmation notice UI at desktop and mobile widths.

### Task 6: Acceptance And Evidence

**Files:**
- Update: `docs/codex-task-B-exploratory-report.md`

**Interfaces:**
- Consumes: all test reports and screenshots.
- Produces: final severity report with explicit fixed/unfixed status.

- [ ] Run `npm run test:e2e` and read `test-results/results.json`.
- [ ] Run `npm run test:e2e:real` and retain screenshots.
- [ ] Run `npm test`; expect the current baseline or higher with zero failures.
- [ ] Run `npm run typecheck`; expect exit code 0.
- [ ] Run `npm run build`; expect exit code 0.
- [ ] Recheck every task-book requirement and report gaps without claiming completion.
