/**
 * A minimal, real `window.matchMedia` implementation for the `components`
 * vitest project (jsdom has none at all — confirmed directly, the same kind
 * of shared gap `apps/web/vitest.setup.ts` already documents for
 * `ResizeObserver`: a DOM test environment with no real layout engine has
 * nothing to report a viewport size from, so nothing here pretends to be a
 * general-purpose polyfill). Scoped to exactly the one query shape every
 * caller in this codebase constructs — `use-media-query.ts`'s
 * `(max-width: ${px}px)` — rather than a real CSS media-query parser.
 *
 * Installed once from `apps/web/vitest.setup.ts`; `setMockViewportWidth` is
 * imported directly by a component test that needs to drive a breakpoint
 * (`data-table.test.tsx`'s ≤560px card collapse, `wizard.test.tsx` and
 * `permission-matrix.test.tsx`'s ≤820px collapses) — the same "mock the
 * breakpoint the same way the component itself detects it, don't just assert
 * a class name exists" bar this batch's brief sets, made possible only
 * because `useIsBelowBreakpoint` reads a real, mockable `matchMedia` value
 * instead of leaning on a CSS-only responsive class jsdom could never
 * evaluate.
 */

const MAX_WIDTH_QUERY = /^\(max-width:\s*(\d+)px\)$/;

/** Wide enough that none of this project's breakpoints (≤560/820/1080px) match by default — component tests render the desktop layout unless a test opts into a narrower one. */
export const DEFAULT_MOCK_VIEWPORT_WIDTH = 1920;

let currentViewportWidth = DEFAULT_MOCK_VIEWPORT_WIDTH;

/** Every live `MediaQueryList` this mock has handed out, so a width change can recompute and notify each one. */
const liveQueries = new Set<MockMediaQueryList>();

interface MockMediaQueryList extends MediaQueryList {
  /** The parsed `max-width` breakpoint this list was constructed for, or `null` for a query shape this mock does not understand (always non-matching). */
  readonly maxWidthPx: number | null;
}

function createMockMediaQueryList(query: string): MockMediaQueryList {
  const target = new EventTarget();
  const maxWidthMatch = MAX_WIDTH_QUERY.exec(query.trim());
  const maxWidthPx = maxWidthMatch?.[1] !== undefined ? Number(maxWidthMatch[1]) : null;

  const mql: MockMediaQueryList = Object.assign(target, {
    media: query,
    matches: maxWidthPx !== null && currentViewportWidth <= maxWidthPx,
    maxWidthPx,
    onchange: null,
    // Deprecated `addListener`/`removeListener` aliases: not this project's
    // own call path (`use-media-query.ts` uses `addEventListener`), but kept
    // since a real `MediaQueryList` carries them and a future caller reaching
    // for the old API should not silently get `undefined is not a function`.
    addListener(listener: (event: MediaQueryListEvent) => void): void {
      target.addEventListener("change", listener as EventListener);
    },
    removeListener(listener: (event: MediaQueryListEvent) => void): void {
      target.removeEventListener("change", listener as EventListener);
    },
    dispatchEvent: target.dispatchEvent.bind(target),
  }) as MockMediaQueryList;

  return mql;
}

/** Installs `window.matchMedia` if the environment has none. Idempotent and safe to call from every test file's setup — `vitest.setup.ts` calls it once per test file, matching the `ResizeObserver` polyfill's own guard. */
export function installMatchMediaMock(): void {
  if (typeof window.matchMedia === "function") return;

  window.matchMedia = (query: string): MediaQueryList => {
    const mql = createMockMediaQueryList(query);
    liveQueries.add(mql);
    return mql;
  };
}

/**
 * Simulates a browser viewport resize: recomputes every live query's
 * `matches` and fires a real `change` event on each one whose value actually
 * flipped — exactly what `useIsBelowBreakpoint`'s `addEventListener("change",
 * ...)` listener expects, so a test drives the same code path production
 * does. Call with `DEFAULT_MOCK_VIEWPORT_WIDTH` in an `afterEach` to undo a
 * test's own call before the next test runs (this mock's registry is
 * module-level state, which — like `document.documentElement.dir` in
 * `toggle-row.test.tsx` — persists across `it()` blocks within one test file
 * even though Vitest gives each *file* a fresh module graph).
 */
export function setMockViewportWidth(widthPx: number): void {
  currentViewportWidth = widthPx;

  for (const mql of liveQueries) {
    if (mql.maxWidthPx === null) continue;
    const matches = currentViewportWidth <= mql.maxWidthPx;
    if (matches === mql.matches) continue;
    (mql as { matches: boolean }).matches = matches;
    mql.dispatchEvent(new Event("change"));
  }
}
