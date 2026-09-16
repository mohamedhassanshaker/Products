"use client";

import * as React from "react";

/**
 * SSR-safe `useLayoutEffect` — identical rationale to `use-resolved-dir.ts`'s
 * copy of the same idiom (kept as a second small local copy rather than a
 * shared third file, matching how this project already tolerates the same
 * one-line pattern living once per hook rather than factoring out a
 * one-line utility module for it).
 */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

/**
 * Resolves whether a `(max-width: ...)` media query currently matches, and
 * stays correct as the viewport is resized.
 *
 * ## Why this exists, and why it is not a Tailwind responsive class
 *
 * `design-system.md` §5.5 requires several organisms to structurally change
 * their DOM at a breakpoint — not just restyle it — e.g. #41 `DataTable`
 * ("collapses to stacked cards" at ≤560px, a `<table>` replaced by `Card`
 * elements) and #42/#43 `Wizard`/`PermissionMatrix` (a tablist/grid replaced
 * by a `Select` or a stack of `Card`s at ≤820px). This project's Tailwind v4
 * bridge (`packages/tokens/src/tailwind-theme.ts`) does wire `sm:`/`md:`/
 * `lg:`/`xl:` to this project's own 560/820/1080/1400 scale (confirmed by
 * reading the generated `--breakpoint-*` values directly, not assumed), so a
 * *purely visual* responsive difference could lean on those classes alone.
 * But jsdom — this project's component-test environment (`vitest.config.ts`)
 * — implements no layout engine at all: it never evaluates a `@media`
 * condition against a viewport size, so a class-only collapse would be
 * structurally untestable beyond "assert the class string is present," which
 * is exactly the bar this batch's own brief says not to settle for ("resize
 * the test viewport or mock the breakpoint the same way the component itself
 * detects it — don't just assert a class name exists"). A `matchMedia`-backed
 * hook makes the breakpoint a real, mockable *value* a test can drive and then
 * assert real, different DOM against — the same reasoning that makes
 * `useResolvedDir()` a hook reading `document.documentElement.dir` rather
 * than a `dir:` CSS selector.
 *
 * ## SSR / hydration
 *
 * Same discipline as `useResolvedDir()`: the server cannot know the client's
 * real viewport, so it can only ever guess. This hook guesses `false` (i.e.
 * renders the *wider* layout) on the first render, identically on server and
 * client, and self-corrects in a layout effect — never a synchronous
 * `window.matchMedia` read at render time, which would either throw during
 * SSR or produce a hydration mismatch the instant the real client viewport
 * disagreed with the guess.
 */
export function useIsBelowBreakpoint(maxWidthPx: number): boolean {
  const [matches, setMatches] = React.useState(false);

  useIsomorphicLayoutEffect(() => {
    const query = window.matchMedia(`(max-width: ${maxWidthPx}px)`);
    setMatches(query.matches);

    // Re-reads `query.matches` rather than trusting the fired event's own
    // `.matches` payload: this is what lets a test drive the mock in
    // `src/test/media-query-mock.ts` (which dispatches a plain `Event`, not a
    // real `MediaQueryListEvent`) with the exact same handler path production
    // code takes — one behaviour to verify, not two.
    const handleChange = (): void => {
      setMatches(query.matches);
    };

    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, [maxWidthPx]);

  return matches;
}
