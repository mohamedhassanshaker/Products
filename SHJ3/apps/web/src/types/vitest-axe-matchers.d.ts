/**
 * Registers `.toHaveNoViolations()` on vitest's `expect`, mirroring the exact
 * pattern @testing-library/jest-dom ships its own vitest augmentation in
 * (`@testing-library/jest-dom/types/vitest.d.ts`) — including keeping it in a
 * dedicated file separate from `jest-axe.d.ts`'s module declaration (see that
 * file's header for why the split, not just the augmentation, is load-bearing).
 *
 * The `import "vitest"` below is load-bearing, not decorative: without it,
 * `declare module "vitest" { ... }` *replaces* vitest's ambient module instead
 * of augmenting it, deleting `describe`/`it`/`expect` for the whole program —
 * confirmed by removing it and watching `tsc` fail on every `*.test.ts` file in
 * the repo, not just this one.
 */
import "vitest";

declare module "vitest" {
  interface Assertion<T = unknown> {
    toHaveNoViolations(): T;
  }
  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): void;
  }
}
