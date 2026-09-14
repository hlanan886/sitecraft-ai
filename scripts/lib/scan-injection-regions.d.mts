/**
 * `scripts/lib/scan-injection-regions.mjs` 的类型声明。
 *
 * 该模块保持 `.mjs`（可被 `node` 直接跑，便于当场取证），
 * 供 `tests/no-backtick-in-adapter-injection.test.ts` 引用。
 */
export declare function templateRegions(lines: readonly string[]): Array<[number, number]>;
export declare function scanRegions(
  lines: readonly string[],
): Array<{ line: number; text: string }>;
export declare function scanBackslashEscapes(
  lines: readonly string[],
): Array<{ line: number; text: string }>;
