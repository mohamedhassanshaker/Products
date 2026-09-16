/**
 * `jest-axe@11` ships no type declarations of its own (confirmed by reading its
 * published package.json and file listing — no `types`/`typings` field, no
 * `.d.ts` anywhere in the package). The community `@types/jest-axe` package is
 * pinned to a pre-v4 API and untrusted here rather than assumed compatible with
 * v11. These types are written directly from `jest-axe`'s actual `index.js`
 * (`axe`/`configureAxe`/`toHaveNoViolations`) and from `axe-core`'s own shipped
 * `axe.d.ts` (the real `axe.AxeResults`/`axe.RunOptions` shapes jest-axe passes
 * through unchanged) — not guessed.
 *
 * `axe-core`'s types are `export =`'d from a global-looking `declare namespace
 * axe`, not a plain ambient global — and this repo's base tsconfig pins `types`
 * to exactly `["node"]`, so nothing pulls axe-core's declarations in
 * automatically. The triple-slash reference below is the standard way to load
 * an ambient `export =` package's types for a type-only reference here.
 *
 * Kept as a standalone script file (no top-level import/export) deliberately —
 * combining this with the separate `vitest`-augmentation file
 * (`vitest-axe-matchers.d.ts`) in one file made this block stop resolving
 * (`tsc` reported "could not find a declaration file for module 'jest-axe'" as
 * if this block were entirely absent, confirmed by isolating each half into
 * its own file one at a time). Not fully root-caused beyond that — kept split
 * because the split is what's actually been proven to work, matching how
 * @testing-library/jest-dom itself ships its own vitest augmentation as a
 * dedicated file separate from its main type declarations.
 */
/// <reference types="axe-core" />

declare module "jest-axe" {
  /** `jest-axe`'s pre-configured default export: `configureAxe()` with no overrides. */
  export function axe(
    html: Element | string,
    additionalOptions?: axe.RunOptions,
  ): Promise<axe.AxeResults>;

  export function configureAxe(
    options?: axe.RunOptions & { globalOptions?: Record<string, unknown> },
  ): (html: Element | string, additionalOptions?: axe.RunOptions) => Promise<axe.AxeResults>;

  /**
   * Raw matcher object shape, passed to `expect.extend()` (apps/web/vitest.setup.ts).
   * `message()` is typed as `() => string` to match vitest's `ExpectationResult`
   * contract, not jest-axe's own looser runtime (which returns `undefined` on a
   * passing result) — harmless, since nothing calls `message()` unless `pass` is
   * false, and vitest/jest-axe agree on that convention.
   */
  export const toHaveNoViolations: {
    toHaveNoViolations(results: axe.AxeResults): {
      pass: boolean;
      message: () => string;
    };
  };
}
