/**
 * The single source of truth for the app's "this page does not exist" UI.
 *
 * Rendered by:
 *
 *  - `app/not-found.tsx` — the app-wide not-found boundary, i.e. what Next serves for
 *    every path in this app that has no route. That set includes every `/internal/ops/**`
 *    request from a caller `middleware.ts` declined to rewrite onto the console, because
 *    the public console prefix deliberately has no routes of its own.
 *  - the console's own `[...unmatched]` catch-all (under `OPS_CONSOLE_INTERNAL_PREFIX`) —
 *    a mistyped console URL from an already-authorized operator.
 *
 * ## Why it is a shared, static, prop-less component (NFR-11, page-surface Defect 1)
 *
 * Because it is the *only* not-found UI in the app, there is nothing for an attacker to
 * compare against. Before this fix, `/internal/ops/**` denials rendered Next's built-in
 * default 404 — which carries its own distinct `<title>` ("404: This page could not be
 * found.") and markup — inside the requested route's own tree, while denied real pages
 * ended up on Next's bare `__next_error__` shell (no `<html lang>`, no stylesheet, no
 * visible text at all). Three different-looking answers to "not found" is three groups
 * to separate. Now there is one.
 *
 * The heavy lifting of making a *denial* indistinguishable from a *nonexistent path* is
 * done in `middleware.ts`: a denied request is a path with no route, so Next's own
 * not-found answer is what gets served, byte for byte, `ETag` included, with nothing added
 * to it. Read `middleware.ts`'s doc comment for that mechanism and for the measurements
 * that ruled out every alternative (including a middleware-issued rewrite of the denial,
 * which Next stamps with an unremovable `x-middleware-rewrite`). This component's job
 * is only to be the one, unvarying thing that answer renders.
 *
 * ## Constraints this component must keep
 *
 * Takes **no props** and reads nothing — not the pathname, not headers, not cookies, not
 * the clock, not a random id. Any such dependency is what gets diffed, and it would also
 * force the app-wide not-found to be dynamically rendered per request instead of served
 * from one prerendered entry (which is precisely what makes every genuine 404 in this app
 * byte-identical today). Keep it a plain, static Server Component: no `useId`, no client
 * component, no `Date`, no asset that only this page pulls in. It deliberately renders no
 * navigation and no hint of which check denied the caller or whether a route exists.
 *
 * Its `<title>` comes from the root layout's shared `metadata` export (a not-found
 * boundary cannot export its own metadata), which every page in the app inherits — so the
 * trivially-observable browser signal is identical too, not just the bytes.
 */

/**
 * The canonical "not found" page body — one static element, identical for every path,
 * every caller, and every denial reason.
 *
 * @returns The shared not-found UI. No parameters by design (see the module doc).
 */
export function NotFoundPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-2xl font-semibold">404</h1>
      <p className="text-muted-foreground text-sm">This page could not be found.</p>
    </main>
  );
}
