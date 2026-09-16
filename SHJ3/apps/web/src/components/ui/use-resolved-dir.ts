"use client";

import * as React from "react";

/**
 * SSR-safe `useLayoutEffect`: identical on the client, a silent no-op on the
 * server (rather than `useLayoutEffect`'s own console warning when it
 * executes during server rendering — every component in this file's callers
 * server-renders on first paint, unlike `Tooltip`'s portal-only content).
 * The standard cross-framework idiom for this exact problem, kept local
 * rather than added as a new shared-package dependency for one line.
 */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

/**
 * Resolves the ambient reading direction for Radix primitives that accept an
 * explicit `dir` prop and use it to decide arrow-key/value direction —
 * `Tabs`/`ToggleGroup` (via `@radix-ui/react-roving-focus`) and `Slider`.
 *
 * ## Why this hook has to exist at all
 *
 * `design-system.md` §10.1 and §5.4 both assert that Radix supplies RTL
 * reversal for these primitives "for free." Verified directly against the
 * installed packages rather than trusted, the same way `tooltip.tsx` verified
 * (and disproved) an equivalent claim about `side`: `@radix-ui/react-direction`'s
 * compiled source is exactly
 * `function useDirection(localDir) { return localDir || globalDir || "ltr"; }`,
 * and `@radix-ui/react-roving-focus` and `@radix-ui/react-slider` both call it
 * as `useDirection(dir)` with whatever `dir` prop (or lack of one) their own
 * caller passed. This app never renders a `@radix-ui/react-direction`
 * `DirectionProvider` (§11.2: direction is a server-set `<html dir>`
 * attribute, not a React context — the identical fact `tooltip.tsx`'s
 * `resolvePhysicalSide` documents for the popper stack), so with no `dir`
 * prop supplied, `globalDir` is always `undefined` and every one of these
 * primitives silently resolves to `"ltr"` forever, regardless of the page's
 * real direction. §10.1's row and §5.4's per-component RTL notes for
 * `SubTabBar`, `ToggleRow` and `Slider` are corrected in the same commit that
 * adds this hook — see those rows for the specifics.
 *
 * ## Why this is a hook with state, not a one-line `document` read
 *
 * `tooltip.tsx` reads `document.documentElement.dir` synchronously at render
 * time and documents exactly why that is safe there: tooltip content only
 * mounts once opened, post-interaction, which cannot happen during SSR. Every
 * caller of *this* hook renders on the initial pass (SSR and first client
 * paint), where a synchronous `document` read would either throw (no
 * `document` on the server) or — worse — silently produce a client/server
 * mismatch: the server has no way to know the real `dir` at all, so it can
 * only ever render as `"ltr"`; a synchronous client read that resolved to
 * `"rtl"` on an Arabic page would then disagree with the server's markup on
 * the very first render, which is exactly what React's hydration diffing
 * flags. Resolving `"ltr"` unconditionally on the first render (identical to
 * today's un-fixed behaviour, and identical to what the server produced) and
 * only correcting it in an effect — which never runs during SSR and always
 * runs after hydration commits — turns this into an ordinary, harmless
 * post-mount state update instead of a hydration bug. `useLayoutEffect`
 * (isomorphic per above) rather than `useEffect` so the correction lands
 * before the browser paints, since `Slider`'s fill/thumb position is visibly,
 * not just behaviourally, direction-dependent.
 */
export function useResolvedDir(): "ltr" | "rtl" {
  const [dir, setDir] = React.useState<"ltr" | "rtl">("ltr");

  useIsomorphicLayoutEffect(() => {
    const resolved = document.documentElement.dir === "rtl" ? "rtl" : "ltr";
    setDir((current) => (current === resolved ? current : resolved));
  }, []);

  return dir;
}
