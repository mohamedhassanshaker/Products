import { NextResponse, type NextRequest } from "next/server";
import { isRequestFromAllowedNetwork } from "@/src/lib/platform-ops-network";
import {
  OPS_CONSOLE_INTERNAL_PREFIX,
  OPS_CONSOLE_PUBLIC_PREFIX,
  decodeOpsPathnameOnce,
  isOpsConsoleInternalPath,
  isOpsConsolePublicPath,
  swapOpsConsolePrefix,
} from "@/src/lib/ops-console-route";

/**
 * Edge middleware serving the NFR-11 Platform Manager console's **page-surface
 * indistinguishability** requirement: a caller who is not allowed to see
 * `/internal/ops/**` must get a response they cannot tell apart from the response any
 * other nonexistent path in this app produces.
 *
 * ## The mechanism, in one sentence
 *
 * `/internal/ops/**` has **no routes** — the console's files live under
 * `OPS_CONSOLE_INTERNAL_PREFIX` (see `src/lib/ops-console-route.ts`) — so this middleware
 * *rewrites an allowed operator's request onto them* and does **nothing whatsoever** to a
 * denied one. A denial is therefore not a response this app builds; it is Next routing a
 * path that genuinely has no route, through the same code, to the same single prerendered
 * not-found entry, that `/anything-else-missing` reaches.
 *
 * ## Why the gate is on the allow path rather than the deny path
 *
 * Every earlier version put the machinery on the *denial* path — deny, then make the denial
 * look like a 404 — and each one leaked, because a mechanism that runs only for denied
 * requests is itself the signal:
 *
 *  1. Gating inside the route tree (`notFound()` from a layout): the App Router renders
 *     layouts and pages in parallel, so denied responses still carried `TenantListScreen` /
 *     `OpsLoginForm` chunk names and the literal
 *     `NEXT_REDIRECT;replace;/internal/ops/login;307;`. And a per-request dynamic render can
 *     never reproduce a prerendered entry's `ETag` / `Content-Length` (measured: 6213 /
 *     7534 / 6031 bytes by route depth, against one 6871-byte entry for every genuine 404).
 *  2. `NextResponse.rewrite()` on the denial path: body and `ETag` matched exactly, but Next
 *     unconditionally adds `x-middleware-rewrite: <destination>` (and, on RSC requests,
 *     `x-nextjs-rewritten-path`) to the response — re-measured against this exact Next
 *     version on a real production build: present on 100% of denials, 0% of genuine 404s.
 *     It cannot be suppressed: `resolve-routes.js` sets it from the middleware response, so
 *     deleting it in middleware cancels the rewrite outright (re-verified — the request then
 *     returns an empty `200`).
 *  3. An internal request header (`x-nb-ops-denied`) plus `beforeFiles`/`fallback` rewrites
 *     in `next.config.mjs` reacting to it: added no response header, but split the decision
 *     across two independently-compiled pattern sets — the middleware `config.matcher`
 *     (which Next expands to `.rsc` / `.json` / `.segments/…` suffix forms *and* a
 *     `_next/data/<id>/` prefix form) and the rewrite `source` strings (which get no such
 *     expansion). Keeping those in sync by hand failed three times; each miss was a request
 *     middleware denied that no rewrite caught, answering without the
 *     `x-nextjs-rewritten-path` header every other 404 carried. It also let a caller's own
 *     `x-nb-ops-denied` header influence which rewrite rule fired.
 *
 * Putting the rewrite on the allow path removes all three failure modes at once, and the
 * reason is structural rather than a matter of getting the patterns right: **the security
 * property no longer depends on matching anything.** If this middleware's matcher misses a
 * request shape, or this file fails to compile, or the whole mechanism is removed, the
 * unmatched request still resolves against a route tree that has nothing at
 * `/internal/ops/**` — i.e. the failure mode is the correct indistinguishable 404, for
 * allowed and denied callers alike. Nothing here reads a caller-supplied header for the
 * routing decision, so no client input can influence which response a request gets.
 *
 * ## Security framing: this is a disclosure control, not the access control
 *
 * Access is enforced by `assertOpsPageAllowed()` inside every console segment and by
 * `requirePlatformApi()` on every `/api/internal/ops/**` route, both reading the same
 * `platform-ops-network.ts` helpers this file reads so the layers cannot disagree about who
 * is allowed. If this middleware were bypassed or misconfigured the console would still
 * refuse the request; it would only go back to *leaking that it exists*.
 *
 * Runtime note: this file is bundled for the Edge runtime, which is why it imports
 * `platform-ops-network.ts` rather than `platform-ops-auth.ts` (the latter pulls in
 * `node:crypto` and `server-only`, neither of which loads here). See that module's doc.
 */

/**
 * **Deliberately as broad as it can be**: every request path in the app except the two
 * static-asset namespaces below.
 *
 * ## Why not scope it to `/internal/ops/**` (QA round 5, Defect 1 — timing oracle)
 *
 * Being *invoked* costs measurably more than not being invoked. Next only runs middleware
 * for paths its `config.matcher` covers, so a matcher scoped to `/internal/ops` made the
 * console's prefix the one prefix in the app whose 404s were slower than everyone else's —
 * measured on a real production build over loopback at ~+1.3-1.5 ms p50 (~85% over the
 * ~1.25 ms baseline of a shape- and depth-matched genuinely-missing path). That is far above
 * the noise floor: a 5-sample median comparison against a known-missing control identified
 * the real prefix in 40/40 trials, versus 17-22/40 (chance) for missing controls. Roughly half
 * of it is the invocation itself and half the gate's `process.env` reads (see `middleware()`);
 * neither depends on how much gate *logic* runs, which is why an unconfigured deployment —
 * short-circuiting immediately — measured the same as a fully-configured one doing the real
 * `X-Forwarded-For` parse, and why the whole gap disappeared when middleware was removed. It
 * showed up for *any* path under the prefix, including nonexistent ones, which is the matcher's
 * shape rather than anything about a particular console route.
 *
 * So the invocation cost has to be paid by everything, not by the security boundary. With this
 * matcher every ordinary page path — the console's, a real route's, a nonexistent one's — is
 * invoked and runs the identical body below, differing only in which value it returns. The
 * comparison class an attacker can measure is therefore uniform, and there is no narrower
 * "matched but not ops-shaped" class either: `/internal/opsx/tenants`, `/nothing` and
 * `/internal/ops/tenants` all now run middleware.
 *
 * Broadening the matcher was necessary but **not sufficient**: it halved the gap (measured
 * 1.465 → 0.726 ms p50 on this host), leaving the gate call as the last ops-only work. See the
 * `middleware()` doc for that second half. With both in place the same classifier scores the
 * console's paths at 17-21/40 — chance, level with the missing controls.
 *
 * ## Why the two exclusions are safe
 *
 * `_next/static` (the build's immutable JS/CSS chunks) and `_next/image` (the image
 * optimizer) are excluded so the whole app's asset traffic doesn't pay a middleware
 * invocation per request. Neither exclusion is correlated with the security boundary: the
 * console has no route in either namespace, both namespaces are excluded wholesale for ops
 * and non-ops paths alike, and the relevant comparison class for this defect — ordinary
 * page-like paths, in every transport form Next generates for them (`.rsc`, `.json`,
 * `.segments/…`, and the `_next/data/<build-id>/` prefix form, all of which Next appends to
 * this pattern itself; see `middleware.test.ts`) — is covered uniformly. `favicon.ico` is
 * excluded on the same "fixed asset path, not page-like" grounds.
 *
 * `/api/**` is deliberately *included* now (it used to be excluded). It needs no gate here —
 * `requirePlatformApi()` answers `/api/internal/ops/**` with `apiNotFoundResponse()`,
 * byte-identical to `app/api/[...unmatched]/route.ts`'s answer — but including it keeps the
 * API surface uniformly invoked too, rather than making "is this path under /api" another
 * axis along which invocation cost varies.
 *
 * ## What this matcher still is not
 *
 * A control. It decides which requests get the *chance* to be rewritten to the real console,
 * so a shape it misses costs an allowed operator a spurious 404 and costs a denied caller
 * nothing at all. There is no second pattern set anywhere that has to agree with it.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

/**
 * Rewrites an allowed operator's console request onto the console's real route path, and
 * leaves every other request strictly untouched.
 *
 * Since QA round 5 (see `config` above) this runs for **every** non-asset request in the app,
 * and it deliberately does the *same work* for all of them: evaluate the network gate, decode
 * the pathname, compare it against the two prefixes, then pick a return. Only the return value
 * depends on the path. That is what makes the console's prefix cost the same as any other
 * path — the round-5 defect was precisely that ops paths did work no other path did, first by
 * being the only paths middleware ran for at all (~+1.3 ms) and then, once the matcher was
 * broadened, by being the only ones that evaluated the gate (~+0.7 ms; in the Edge sandbox the
 * `process.env` reads behind it dominate, which is why an unconfigured deployment that
 * short-circuits immediately measured the same as one running the full IP parse).
 *
 * So: no early return before the gate, and no cheaper path for a non-console request. It costs
 * the whole app a fixed ~1.4 ms per request (measured, see the plan doc) to make the boundary
 * unmeasurable, and there is no I/O or allocation beyond that — keep it that way.
 *
 * Next normalizes a request's transport form away before middleware runs (verified against
 * a production build: `/internal/ops.rsc` and `/_next/data/<build-id>/internal/ops.json`
 * both arrive here as the pathname `/internal/ops`), so this function never has to know
 * about `.rsc`, `.json`, `.segments/…` or `_next/data/` — it maps clean route paths, and
 * Next re-applies the transport handling to the rewritten path itself.
 *
 * @param request The incoming request. Only its pathname and (via the shared helpers) its
 *   headers' caller-IP information are read; never its body or cookies. No header
 *   influences the branch taken.
 * @returns A rewrite onto the internal console path for an allowed operator; a rewrite onto
 *   the (routeless) public path for anyone addressing the internal path directly; otherwise
 *   `NextResponse.next()`, which adds nothing to the request or the response and lets Next
 *   answer a routeless path exactly as it answers any other.
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Evaluated for EVERY request, before anything branches on the path, and read back only by
  // the last branch below. That looks wasteful and is the point: it is the only way the gate's
  // cost cannot be attributed to the console's prefix (QA round 5, Defect 1 — see this
  // function's doc). Its cost depends on the deployment's env and on this request's own
  // headers, never on which path was asked for, so two requests that differ only in path do
  // identical work. `isRequestFromAllowedNetwork()` already fails closed when the deployment is
  // unconfigured, so there is no separate `isPlatformOpsConfigured()` branch to skip either.
  const isAllowedOperatorNetwork = isRequestFromAllowedNetwork(request.headers);

  // The internal path is never addressable from outside. Rewriting it back onto the public
  // prefix (which has no route) 404s it for *everyone*, so this branch — unlike every
  // denial mechanism that came before it — is not conditioned on the gate at all and
  // therefore cannot be used as an oracle for whether the caller would have been allowed.
  // Middleware runs once per request, before rewrites, so a request seen here with this
  // prefix can only have come from a caller who typed it, never from our own rewrite below.
  //
  // The percent-decoded spelling counts too (QA round 5, Defect 2): the router decodes a
  // pathname before matching it but middleware sees the escapes, so `nb%2Dc%2D…` used to
  // reach the real console route and answer from a different code path — with a cacheable
  // `s-maxage` 404 when denied and the doubled-prefix rewrite when allowed, i.e. a gate
  // oracle for a caller who already knew the secret segment. Whichever spelling arrived,
  // the rewrite target is built from the form that actually matched the internal prefix, so
  // every spelling collapses onto one byte-identical response.
  const decodedPathname = decodeOpsPathnameOnce(pathname);
  const internalForm = isOpsConsoleInternalPath(pathname)
    ? pathname
    : isOpsConsoleInternalPath(decodedPathname)
      ? decodedPathname
      : null;
  if (internalForm !== null) {
    const target = request.nextUrl.clone();
    target.pathname = swapOpsConsolePrefix(internalForm, OPS_CONSOLE_INTERNAL_PREFIX, OPS_CONSOLE_PUBLIC_PREFIX);
    return NextResponse.rewrite(target);
  }

  // Everything else in the app — real routes, missing paths, `/api/**`, near-misses such as
  // `/internal/opsx` — lands here, by design (the matcher covers them so that being invoked
  // is not itself a signal about the console's prefix; see `config`). Doing nothing is the
  // correct answer, and it is the *same* answer, reached by the same work, that a denied
  // console request gets from the next line.
  if (!isOpsConsolePublicPath(pathname)) return NextResponse.next();

  // Denied — and deliberately a no-op. `NextResponse.next()` sets only Next's internal
  // `x-middleware-next`, which the router consumes and never forwards, so the caller's
  // response is produced by exactly the code that answers every other routeless path. Note
  // this is a *read* of a decision already made above, not the decision itself: nothing about
  // reaching this line costs more than reaching the line above it.
  if (!isAllowedOperatorNetwork) return NextResponse.next();

  const target = request.nextUrl.clone();
  target.pathname = swapOpsConsolePrefix(pathname, OPS_CONSOLE_PUBLIC_PREFIX, OPS_CONSOLE_INTERNAL_PREFIX);
  return NextResponse.rewrite(target);
}
