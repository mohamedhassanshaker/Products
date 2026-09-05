import "server-only";
import type { NextRequest } from "next/server";
import { apiNotFoundResponse } from "./api-not-found-response.js";
import {
  OPS_SESSION_COOKIE,
  extractClientIp,
  isPlatformOpsConfigured,
  isRequestFromAllowedNetwork,
  verifyOperatorToken,
} from "./platform-ops-auth";
import { checkRateLimit } from "./rate-limit";

/**
 * QA retry 2, Defect 2 fix: previously only the `/internal/ops/login` Server Action
 * was rate-limited — a caller who already knows (or spoofs past) an allowed IP could
 * brute-force `NEXTBOT_OPS_OPERATOR_TOKEN` directly against any
 * `/api/internal/ops/**` route via the `Authorization` header at unlimited speed,
 * with no throttling at all. Reuses the exact same fixed-window Redis primitive
 * (`checkRateLimit`) the login action already uses, keyed by the same
 * `extractClientIp` resolution (post-trusted-proxy-peeling) so both surfaces share
 * one consistent notion of "the caller".
 *
 * Deliberately a higher ceiling than the login form's (5/60s): this key also covers
 * every legitimate, already-authenticated browser session's own API traffic (the
 * Tenant List/Detail screens issue several fetches per page view), not just
 * credential-guessing attempts — a limit tight enough to meaningfully bound
 * brute-force throughput while staying well above realistic legitimate call volume
 * for a low-traffic internal console.
 */
const PLATFORM_API_RATE_LIMIT = 30;
const PLATFORM_API_RATE_LIMIT_WINDOW_SECONDS = 60;

/**
 * Denial response for `requirePlatformApi()` — deliberately indistinguishable from
 * "this route genuinely doesn't exist", per the plan's fail-closed requirement: an
 * unconfigured deployment, a wrong token, a disallowed IP, and a rate-limited caller
 * must all be equally unconfirmable-as-existing from the outside, not merely "denied".
 *
 * QA retry 3, Defect 1 fix — this is now a direct call to `apiNotFoundResponse()`,
 * the **same function** `app/api/[...unmatched]/route.ts` returns for any `/api/**`
 * path that genuinely has no handler. The two sides of the attacker's comparison are
 * therefore identical by construction (same bytes, same headers, same response
 * pipeline, same single-render latency) rather than by imitation.
 *
 * Three earlier attempts tried instead to *imitate* Next's own not-found render —
 * first hand-built, then by relaying a same-origin probe fetch of a fixed fake path,
 * then by relaying a probe derived from the caller's own path. Every one of them
 * leaked a fresh, real signal (an unrelatable body shape; one byte-identical body
 * shared by all guarded endpoints; a fixed probe-segment literal present in 100% of
 * denials and 0% of genuine 404s, plus a duplicated `Vary` header from composing two
 * responses). Measurements against the running app proved that whole strategy
 * unfixable — Next's not-found body embeds both the requested path's own segments and,
 * in dev mode, a per-request timestamp — so it was abandoned rather than refined. The
 * full evidence and the alternatives ruled out (including `next/navigation`'s
 * `notFound()` and a `middleware.ts` rewrite) are recorded in
 * `api-not-found-response.ts`'s module doc.
 *
 * Takes no `request` argument on purpose: the denial response must not depend on the
 * request in any way, because any such dependency is precisely what gets diffed.
 */
function notFound(): Response {
  return apiNotFoundResponse();
}

/**
 * Standalone guard for every `apps/web/app/api/internal/ops/**` route handler
 * (NFR-11 Platform Manager console). Deliberately NOT `requireApi()` (see
 * `platform-ops-auth.ts`'s module doc for why) — two independent checks, both
 * required, regardless of which of the two auth mechanisms is used:
 *
 *  1. Caller IP must match `NEXTBOT_OPS_IP_ALLOWLIST` (checked unconditionally,
 *     even when auth is via the browser cookie rather than a header).
 *  2. Either an `Authorization: Bearer <token>` header OR the `/internal/ops`-scoped
 *     httpOnly session cookie must carry the exact `NEXTBOT_OPS_OPERATOR_TOKEN`
 *     value (constant-time comparison — see `verifyOperatorToken`).
 *
 * If `NEXTBOT_OPS_OPERATOR_TOKEN`/`NEXTBOT_OPS_IP_ALLOWLIST` are unset/empty, every
 * check fails identically to a wrong token, a disallowed IP, or a rate-limited caller:
 * the shared `apiNotFoundResponse()` (see `notFound()` below), never a 401/403 that
 * would confirm the surface exists at all.
 *
 * @returns `{ authorized: true }` on success, or a `Response` the caller must return
 *   immediately — mirrors `requireApi()`'s `Response`-or-context return shape (see
 *   that file's doc comment) without importing/reusing it directly.
 */
export async function requirePlatformApi(request: NextRequest): Promise<Response | { authorized: true }> {
  if (!isPlatformOpsConfigured()) return notFound();
  if (!isRequestFromAllowedNetwork(request.headers)) return notFound();

  // QA retry 2, Defect 2 fix: bound the rate at which any single caller IP can hit
  // this guard at all — placed after the network-allowlist check (so the key is
  // always a genuinely resolved, non-spoofable IP; see `extractClientIp`'s own doc
  // comment) and before the token comparison (so a rate-limited caller is turned away
  // before ever spending a `verifyOperatorToken` call). The denial path is identical
  // either way — `notFound()` — so being rate-limited is not a distinguishable
  // response shape from a wrong token/disallowed IP/unconfigured deployment; it never
  // introduces a new status code, header, or body shape of its own.
  //
  // QA retry 3, measured residual (documented rather than "fixed", because every
  // available fix is worse): this Redis round-trip is the one thing that makes a denial
  // *timing*-distinguishable from a nonexistent path. Measured over loopback against a
  // production build, 150 samples per arm:
  //   - disallowed IP (returns above, never reaching this line): p50 5.15ms vs a
  //     nonexistent `/api/**` path's 5.18ms — a −0.03ms delta, indistinguishable.
  //   - wrong token (reaches this line): p50 5.96ms — a +0.79ms delta.
  // The +0.79ms arm is only reachable by a caller who has *already* satisfied
  // `NEXTBOT_OPS_IP_ALLOWLIST`; every caller who has not — which, with no trusted proxy
  // configured (this project's default, see `extractClientIp`), is every remote caller —
  // gets the indistinguishable arm. Closing the 0.79ms would mean either checking the
  // token before the rate limit (reopening QA retry 2's unbounded brute-force defect) or
  // making nonexistent-path 404s do a Redis round-trip too (a trivially abusable
  // amplification vector on the app's entire 404 surface). Neither trade is worth
  // 0.79ms of loopback timing that any real network path's jitter swamps.
  const callerIp = extractClientIp(request.headers);
  const rateLimit = await checkRateLimit(`ops-api:${callerIp}`, PLATFORM_API_RATE_LIMIT, PLATFORM_API_RATE_LIMIT_WINDOW_SECONDS);
  if (!rateLimit.allowed) return notFound();

  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice("bearer ".length).trim() : undefined;
  const cookieToken = request.cookies.get(OPS_SESSION_COOKIE)?.value;

  const tokenIsValid = (bearerToken && verifyOperatorToken(bearerToken)) || (cookieToken && verifyOperatorToken(cookieToken));
  if (!tokenIsValid) return notFound();

  return { authorized: true };
}
