/**
 * Vitest global setup (Phase 2 sub-slice "2a" addition — this app's first component tests). Extends
 * `expect` with `@testing-library/jest-dom`'s DOM-specific matchers (`toBeDisabled`,
 * `toBeInTheDocument`, ...) used by the new `.test.tsx` component tests. Has zero effect on the
 * ~350 pre-existing `.test.ts` server-side tests (they never call a jest-dom matcher), so this is a
 * strictly additive setup file, not a behavior change to any existing suite.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// `@testing-library/react` only auto-registers its own `afterEach(cleanup)` when it detects Jest-style
// globals (`test.globals: true` in the Vitest config, which this project deliberately does NOT set —
// every test file imports `describe`/`it`/`expect` explicitly instead). Without this explicit call,
// each `.test.tsx` file's rendered DOM trees accumulate across every `it()` in the same file (found by
// actually running the new component tests: `getByTestId` failed with "found multiple elements" once a
// second `it.each` case rendered a second `<StatusBadge>` alongside the first, un-unmounted one).
afterEach(() => {
  cleanup();
});
