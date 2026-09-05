import "server-only";

/**
 * The single source of truth for "this `/api/**` path does not exist" in
 * `apps/web`.
 *
 * ## Why this module exists (NFR-11 Platform Manager console, QA retry 3, Defect 1)
 *
 * `requirePlatformApi()` (`platform-api-guard.ts`) must answer every denial —
 * unconfigured deployment, wrong token, disallowed IP, rate-limited — with a response
 * an attacker cannot distinguish from "this route was never built". Three earlier
 * attempts tried to make the guard's denial *imitate* Next.js's own not-found
 * response, and each one leaked a different, real signal:
 *
 *  1. A hand-built `new Response(null, { status: 404 })` — nothing like Next's own
 *     ~15KB `text/html` not-found page (wrong headers, wrong `Content-Type`, empty
 *     body).
 *  2. A same-origin `fetch` of one FIXED fake path, relayed verbatim — every guarded
 *     denial body became byte-identical to every other one (all echoing that one fake
 *     path) while genuine 404s always vary, and the fake path's literal name leaked.
 *  3. The same relay with the probe path derived from the caller's own path plus a
 *     fixed extra segment — that fixed segment literal then appeared in 100% of
 *     guarded denials and 0% of genuine 404s, and composing a second response through
 *     the route-handler pipeline emitted a duplicated `Vary` header no native 404 has.
 *
 * This module takes the opposite approach: instead of making the guard's denial
 * imitate Next's not-found response, it makes **both sides of the comparison come
 * from this one function**, so they are identical by construction rather than by
 * imitation. `app/api/[...unmatched]/route.ts` (the catch-all that Next routes any
 * genuinely-nonexistent `/api/**` path to) and `requirePlatformApi()`'s denial path
 * both return `apiNotFoundResponse()`. Same bytes, same headers, same
 * response-pipeline, same single-render latency — there is no second response to
 * compose, no probe request to fingerprint, and no per-request or per-path variation
 * on either side to diff.
 *
 * ## Why imitation was abandoned rather than refined
 *
 * Measured directly against this app's running dev server (see the decision-log entry
 * in `docs/NEXUS_STATE.md`), Next's native not-found response for a missing path is
 * **not reproducible from inside a Route Handler**:
 *
 *  - Its body embeds the *requested path's own segments* verbatim in the RSC payload
 *    (`"c":["","api","v1","aaa"]`), so it can never be pre-captured as a constant and
 *    replayed for a different path.
 *  - In dev mode its body also embeds a **per-request timestamp** (`?v=1787086347441`
 *    on every asset URL, plus a `:N<epoch-ms>` marker) — two requests to the *same*
 *    missing path differ from each other at 19 byte offsets. Any hard-coded capture is
 *    therefore stale-by-construction the moment it is written.
 *  - `notFound()` from `next/navigation`, called inside a Route Handler, does *not*
 *    render that page: it produces an empty-bodied 404 with a different header set
 *    entirely (no `Cache-Control`, no `Content-Type`, no `X-Powered-By`).
 *  - A `middleware.ts` rewrite to a nonexistent path renders the page for the
 *    *rewrite target*, echoing that target's segments in the body and adding an
 *    `x-middleware-rewrite` response header.
 *
 * Equalizing downward (one small static response for both sides) is the only option
 * left that has no residual signal — and it is strictly better than imitation anyway,
 * because it also stops leaking a 15KB dev-mode render to unauthenticated callers.
 *
 * ## Scope: `/api/**` only
 *
 * Deliberately scoped to the API surface rather than the whole app. Page routes keep
 * Next's own styled not-found rendering (a human who typos an Admin Console URL should
 * still get a real page, not a bare 404), and an attacker probing
 * `/api/internal/ops/**` compares it against other `/api/**` paths — which is exactly
 * the set this covers uniformly.
 */

/** Status every "nonexistent API path" answer uses. */
const NOT_FOUND_STATUS = 404;

/**
 * Body bytes. Deliberately short, framework-neutral, and free of any hint about
 * whether a route exists, which check denied the caller, or what stack is serving it.
 */
const NOT_FOUND_BODY = "Not Found";

/**
 * Headers. Only `Content-Type`/`Content-Length` — nothing derived from the request, so
 * two responses can never differ. `Content-Length` is spelled out explicitly (rather
 * than left to the runtime to infer, which would pick chunked framing for one caller
 * and a fixed length for another depending on how the body was passed) so the
 * transport framing is identical on every response too.
 */
const NOT_FOUND_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "text/plain; charset=utf-8",
  "content-length": String(new TextEncoder().encode(NOT_FOUND_BODY).byteLength),
};

/**
 * Builds the canonical "this API path does not exist" response.
 *
 * Takes no arguments **by design**: nothing about the response may depend on the
 * request, because any such dependency is exactly what an attacker diffs. A fresh
 * `Response` is constructed per call rather than a shared singleton being returned,
 * since a `Response` body stream can only be consumed once.
 *
 * @returns A 404 `Response` with a fixed body and fixed headers — byte-identical on
 *   every call, for every caller, for every path, and for every denial reason.
 */
export function apiNotFoundResponse(): Response {
  return new Response(NOT_FOUND_BODY, {
    status: NOT_FOUND_STATUS,
    headers: { ...NOT_FOUND_HEADERS },
  });
}

/**
 * Route-handler export for an HTTP method a `/api/internal/ops/**` route deliberately
 * does not implement — e.g. `export const PUT = apiMethodNotFoundHandler;`.
 *
 * ## Why every unimplemented method must be exported explicitly
 *
 * Found during QA retry 3's adversarial verification and fixed in the same pass: when
 * a Route Handler omits a method, Next answers for it *before* any guard code runs,
 * and both of its answers confirm the route exists to a completely unauthenticated
 * caller —
 *
 *  - `PUT|PATCH|DELETE /api/internal/ops/tenants` returned **405 Method Not Allowed**,
 *    while the same verb against a nonexistent `/api/**` path returns 404.
 *  - `OPTIONS /api/internal/ops/tenants` returned **204** with
 *    `Allow: GET, HEAD, OPTIONS, POST` — i.e. it enumerated the route's real method
 *    set outright.
 *
 * Either one defeats NFR-11's "a caller must not be able to confirm this surface
 * exists" requirement just as decisively as a distinguishable denial body would, and
 * neither is reachable from inside `requirePlatformApi()` (the guard never executes).
 * The only fix is for each ops route to claim every verb and answer the unimplemented
 * ones with the exact same response a nonexistent path gets.
 *
 * `HEAD` is deliberately *not* in that list: Next derives it from `GET`, so it already
 * runs the guard and already produces this exact response's headers on a denial
 * (verified by `curl -X HEAD` against both a guarded route and a missing path).
 *
 * Accepts and ignores any arguments Next passes (request, route context) — the response
 * must not depend on them.
 *
 * @returns The same 404 `Response` as {@link apiNotFoundResponse}.
 */
export function apiMethodNotFoundHandler(): Response {
  return apiNotFoundResponse();
}
