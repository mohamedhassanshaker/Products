import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { toHaveNoViolations } from "jest-axe";
import { afterEach, expect } from "vitest";
import { installMatchMediaMock } from "./src/test/media-query-mock";

/**
 * Shared setup for the `components` vitest project (design-system.md §10.6).
 *
 * `@testing-library/jest-dom/vitest` registers DOM matchers (`toBeInTheDocument`,
 * `toHaveAttribute`, …) directly against vitest's `expect` — no manual
 * `expect.extend` needed for that half. `jest-axe`'s matcher has no vitest-native
 * entry point, so it's wired by hand here once, rather than every component test
 * repeating `expect.extend(toHaveNoViolations)` itself.
 */
expect.extend(toHaveNoViolations);

/**
 * `@testing-library/react` only self-registers its `afterEach(cleanup)` when
 * it detects a *global* `afterEach` at import time — which requires Vitest's
 * `test.globals: true`. This project deliberately does not set that (every
 * test file imports `describe`/`it`/`expect` explicitly), so cleanup never
 * ran on its own: confirmed directly, not assumed — a component test file
 * with two `render()` calls in separate `it()` blocks left both trees mounted
 * in `document.body` simultaneously, and a `getByRole` query in the second
 * test failed with "multiple elements found" pointing at both. Registered by
 * hand here, once, rather than every component test file repeating
 * `afterEach(cleanup)` itself.
 */
afterEach(() => {
  cleanup();
});

/**
 * jsdom implements no `ResizeObserver` at all (confirmed directly — it is
 * `undefined` in this project's jsdom environment). A real, shared gap found
 * building `Slider`: its `@radix-ui/react-use-size` dependency calls
 * `new ResizeObserver(...)` unconditionally in a layout effect to measure the
 * thumb, which throws on mount — not a defect in `Slider`, but in every
 * future component that measures its own size (a resizable panel, a chart),
 * the identical way the missing `@` alias and the missing `afterEach(cleanup)`
 * registration were shared gaps fixed once here rather than per component
 * test (see this file's own history). A minimal no-op stub is standard
 * practice for a DOM test environment with no real layout engine to observe
 * in the first place — jsdom cannot report genuine size changes regardless of
 * what this polyfill does, so a fuller implementation would buy nothing more
 * "real" here; component tests that need a specific measured size stub
 * `Element.getBoundingClientRect`/`offsetWidth` directly instead, same as
 * they would with a real `ResizeObserver` present.
 */
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverPolyfill;
}

/**
 * `window.matchMedia` (design-system.md §5.5's organism responsive collapses
 * — `DataTable` ≤560px, `Wizard`/`PermissionMatrix` ≤820px). jsdom implements
 * none of it, the same class of gap as `ResizeObserver` above. See
 * `src/test/media-query-mock.ts` for the full rationale and the
 * `setMockViewportWidth` helper individual component tests drive.
 */
installMatchMediaMock();
