/**
 * The two path constants that define how the Platform Manager console (NFR-11) is
 * addressed: the URL operators use, and the route path its files actually live at.
 *
 * ## Why those are two different things
 *
 * The console's hard requirement is that a caller who is not allowed to see it must get a
 * response they cannot tell apart from the response any other nonexistent path in this app
 * produces (page-surface Defect 1). Four rounds of trying to *produce* such a response —
 * from the route tree, then from middleware, then from a `next.config.mjs` rewrite driven
 * by an internal request header — each leaked something: a per-page `ETag`, a component
 * name, a `x-nextjs-rewritten-path` present on one side only, a `x-middleware-rewrite`
 * that Next adds to every middleware-issued rewrite and that cannot be removed.
 *
 * The mechanism here removes the need to produce anything at all. **No route in this app
 * is served at `/internal/ops/**`.** Every file of the console lives one segment deeper,
 * under {@link OPS_CONSOLE_INTERNAL_PREFIX}, and `middleware.ts` rewrites an *allowed*
 * operator's request onto that internal path. A denied request is simply not rewritten, so
 * Next routes `/internal/ops/whatever` and finds — genuinely, not by imitation — no route,
 * and answers with the identical prerendered not-found entry that answers every other
 * missing path in the app. There is no denial response to construct, no header to
 * normalize, and no second pattern set that has to agree with the middleware matcher:
 * whatever shape a request arrives in, if middleware does not recognize and rewrite it, the
 * result is the correct indistinguishable 404. The security property holds even if
 * middleware never runs at all.
 *
 * ## Why the internal segment is a random-looking constant
 *
 * Because `/internal/ops/**` has no routes, the console's real route path has to be *some*
 * other string, and that string is directly requestable by a caller who knows it. Two
 * things keep that from mattering:
 *
 *  1. `middleware.ts` neutralizes it: any request that arrives already carrying the
 *     internal prefix is rewritten back onto the public prefix — which has no route — so it
 *     404s, **identically for allowed and denied callers alike**. The response there is
 *     therefore not an authorization oracle; it tells a caller nothing about the gate.
 *  2. Access control is unchanged and unrelated to this string: every segment under the
 *     internal prefix still calls `assertOpsPageAllowed()` (see `src/lib/ops-page-gate.ts`),
 *     and every `/api/internal/ops/**` route still calls `requirePlatformApi()`. This is a
 *     disclosure control, never the access control — the console does not become reachable
 *     by learning this string.
 *
 * What the random suffix buys is only that a scanner cannot *guess* the one path whose
 * response (a 404 carrying Next's `x-middleware-rewrite`) differs from a 404 for a
 * neighbouring path, which is the single residual difference this design leaves anywhere.
 * It is a fixed constant rather than a per-build secret on purpose: it has to name a real
 * folder in `app/`, which is decided at authoring time, and treating it as a secret would
 * imply a security property it does not have (see point 2).
 *
 * Renaming the folder without changing this constant would take the console offline
 * (every operator request would 404). `ops-console-route.test.ts` asserts the constant and
 * the folder on disk still agree, so that mistake fails a test instead of a deployment.
 *
 * Runtime note: this module is imported by `middleware.ts` and therefore must stay
 * Edge-safe — string constants only, no Node built-ins, no `server-only`, no I/O.
 */

/** The URL prefix operators and links use, and the only one that ever appears in a browser
 * address bar. Deliberately backed by **no route at all** — see the module doc. */
export const OPS_CONSOLE_PUBLIC_PREFIX = "/internal/ops";

/** The route path the console's files actually live at (`app/internal/ops/nb-c-…/**`).
 * Reached only via `middleware.ts`'s rewrite of an allowed operator's request; a request
 * that arrives at this prefix from outside is rewritten back to the public prefix and 404s.
 */
export const OPS_CONSOLE_INTERNAL_PREFIX = "/internal/ops/nb-c-4f21c8a7e3d9b605";

/**
 * Maps a path under one console prefix onto the other, preserving the tail exactly.
 *
 * @param pathname A request pathname that starts with `from` (callers check that first).
 * @param from The prefix to strip — one of the two constants above.
 * @param to The prefix to apply instead — the other constant.
 * @returns `pathname` with its `from` prefix replaced by `to`; the remainder, including an
 *   empty remainder (a request for the prefix itself), is passed through untouched.
 */
export function swapOpsConsolePrefix(pathname: string, from: string, to: string): string {
  return to + pathname.slice(from.length);
}

/**
 * Whether `pathname` is `prefix` itself or a path beneath it.
 *
 * The check on the character after the prefix is what makes this a *path* test rather than a
 * string test: without it a sibling path that merely starts with the same characters
 * (`/internal/opsx`, `/internal/ops/nb-c-4f21c8a7e3d9b605x`) would be treated as being inside
 * the prefix and rewritten, when it should be left alone to 404 like any other nonexistent
 * path.
 *
 * @param pathname The (already Next-normalized) request pathname.
 * @param prefix A path prefix with no trailing slash.
 * @returns Whether `pathname` lies at or under `prefix`.
 */
function isUnderPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/**
 * True when `pathname` addresses the console's internal route path directly, i.e. it is
 * {@link OPS_CONSOLE_INTERNAL_PREFIX} itself or something beneath it.
 *
 * @param pathname The (already Next-normalized) request pathname.
 * @returns Whether the request is addressing the internal prefix from outside.
 */
export function isOpsConsoleInternalPath(pathname: string): boolean {
  return isUnderPrefix(pathname, OPS_CONSOLE_INTERNAL_PREFIX);
}

/**
 * Percent-decodes a request pathname once, so a caller cannot dodge
 * {@link isOpsConsoleInternalPath} by spelling the internal prefix with escapes.
 *
 * ## Why this exists (QA round 5, Defect 2)
 *
 * Next's router percent-decodes a pathname when it matches it against the route tree, but
 * `NextRequest.nextUrl.pathname` in middleware still carries the escapes. So
 * `/internal/ops/nb%2Dc%2D…/tenants` (and `/internal/o%70s/nb-c-…/tenants`, which encodes a
 * character outside the secret segment entirely) used to slip past the internal-prefix
 * neutralization in `middleware.ts` and reach the *real* console route, where only the
 * per-segment `assertOpsPageAllowed()` gate stopped it — correctly, but by a different code
 * path, which is measurable: a denied caller got `Cache-Control: s-maxage=31536000` where
 * every other 404 gets `no-store`, and an allowed one got the doubled-prefix rewrite instead,
 * making that spelling a small authorization oracle for anyone who already knew the secret
 * segment. Decoding here folds every such spelling back onto the plain internal-path branch,
 * whose response (the accepted, documented residual) is identical for allowed and denied
 * callers alike.
 *
 * Decoding is applied **once**, matching what the router itself does, so a double-encoded
 * spelling decodes to something that is still not a route and 404s like any other missing
 * path rather than being folded in on a second pass.
 *
 * @param pathname A request pathname, possibly containing percent-escapes.
 * @returns The decoded pathname, or `pathname` unchanged when it contains a malformed escape
 *   sequence (`decodeURIComponent` throws on those; a path we cannot decode is a path we
 *   leave alone, which fails closed — it reaches no console route either way).
 */
export function decodeOpsPathnameOnce(pathname: string): string {
  // `middleware.ts` runs this on every non-asset request in the app, and a pathname with no
  // `%` in it decodes to itself — so skip the work rather than allocating for the common case.
  if (!pathname.includes("%")) return pathname;
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/**
 * True when `pathname` is the console's public URL prefix or a path beneath it — i.e. one of
 * the paths this app deliberately has **no route for**, and which an allowed operator's
 * request is rewritten off of.
 *
 * @param pathname The (already Next-normalized) request pathname.
 * @returns Whether the request addresses the console's public surface.
 */
export function isOpsConsolePublicPath(pathname: string): boolean {
  return isUnderPrefix(pathname, OPS_CONSOLE_PUBLIC_PREFIX);
}
