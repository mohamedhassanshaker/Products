"use client";

import * as React from "react";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

/**
 * SSR-safe viewport-width media query, the same isomorphic shape
 * `use-resolved-dir.ts` (graph-canvas's sibling wave, `components/ui/`)
 * established: resolves to `false` on the server and on first client paint
 * (matching what the server necessarily rendered, avoiding a hydration
 * mismatch), then self-corrects via `useLayoutEffect` before the browser's
 * next paint, and stays live via a real `matchMedia` change listener rather
 * than a one-time read.
 *
 * `breakpointPx` is taken as a plain number (not a token reference): this
 * hook is a structural viewport condition, the same category §4.9 already
 * carves breakpoints out of the token system for — a CSS custom property
 * cannot appear inside a `matchMedia` query string at all, so there is no
 * token form to consume here even in principle.
 */
export function useIsBelowBreakpoint(breakpointPx: number): boolean {
  const [isBelow, setIsBelow] = React.useState(false);

  useIsomorphicLayoutEffect(() => {
    const query = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const update = () => setIsBelow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [breakpointPx]);

  return isBelow;
}
