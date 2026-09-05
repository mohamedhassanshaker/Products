import "server-only";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isPlatformOpsConfigured, isRequestFromAllowedNetwork } from "./platform-ops-auth";

/**
 * The access-control gate every Server Component under `/internal/ops/**` calls before it
 * renders anything of its own (NFR-11 Platform Manager console).
 *
 * ## Relationship to `middleware.ts`
 *
 * `middleware.ts` normally stops a disallowed caller *before* Next routes the request — not
 * by refusing it, but by declining to rewrite it onto the console's real route path (the
 * segments this gate guards live under `OPS_CONSOLE_INTERNAL_PREFIX`; `/internal/ops/**`
 * itself has no routes at all, see `src/lib/ops-console-route.ts`). So in practice this
 * function's denial branch is only reached when middleware *did* rewrite — i.e. it is the
 * layer that catches a middleware bypass, misconfiguration, or a caller who somehow reaches
 * the internal path directly. That division is deliberate:
 *
 *  - middleware owns **indistinguishability** (a denial is answered by the app's ordinary
 *    "no such route" path, which an in-tree gate provably cannot reproduce; see that file);
 *  - this function owns **access control**, and is what actually guarantees the console
 *    stays closed even if the middleware layer is ever removed, mis-matched, or skipped.
 *
 * Keep both. A denial that only middleware enforces is one config typo away from being
 * open; a denial that only this enforces leaks the console's existence.
 *
 * ## Why *every* segment calls it, not just the root layout
 *
 * The gate used to live only in `app/internal/ops/layout.tsx`. That is not sufficient,
 * and QA's adversarial pass proved it with a live repro: **the App Router renders a
 * route's layouts and its page segment in parallel**, so a layout that denies — whether
 * by calling `notFound()` or by returning something other than `children` — does not stop
 * the segments below it from having already rendered. Both behaviours were measured
 * directly against this app's running server, and both leaked the same things into the
 * denied response for a completely unauthenticated caller on a completely unconfigured
 * deployment:
 *
 *  - the requested page's real component and webpack-chunk names (`TenantListScreen`,
 *    `OpsLoginForm`), which exist in the payload only for a path that is really a route;
 *  - the literal string `NEXT_REDIRECT;replace;/internal/ops/login;307;`, serialized
 *    from `(console)/layout.tsx`'s session redirect having run anyway — naming a real
 *    route outright;
 *  - a body size that tracked whichever real page had been refused (dev: 23502 / 25074 /
 *    25006 / 20571 bytes) against a genuinely-missing path's tight 15217–15241 band,
 *    i.e. a one-request enumeration oracle on size (and, in a production build, on the
 *    per-page `ETag` those sizes imply).
 *
 * So even as the second line of defence, this has to be applied in *every* segment
 * beneath `/internal/ops` — the root layout, the nested `(console)` layout, every page,
 * and the `[...unmatched]` catch-all — rather than once at the top, or a bypass of the
 * middleware layer would be a leak as well as a refusal.
 *
 * ## What it checks
 *
 * Exactly the first two of the three checks `requirePlatformApi()` applies to the
 * sibling `/api/internal/ops/**` routes, via the same shared helpers so the two
 * surfaces can never drift:
 *
 *  1. `NEXTBOT_OPS_OPERATOR_TOKEN` **and** `NEXTBOT_OPS_IP_ALLOWLIST` are both
 *     configured — otherwise the console must not confirm its own existence at all on
 *     a deployment where it was never turned on.
 *  2. The caller's resolved IP matches the allowlist — checked before any notion of a
 *     session, so a disallowed network never even reaches the login form.
 *
 * The session-cookie check is deliberately *not* here: it belongs to the nested
 * `(console)` route group only, because `/internal/ops/login` itself must render for a
 * network-allowed caller who is not signed in yet.
 *
 * @returns Nothing on success.
 * @throws The App Router's not-found signal (via `notFound()`, which never returns) when
 *   either check fails. Callers must `await` this before rendering anything else.
 */
export async function assertOpsPageAllowed(): Promise<void> {
  if (!isPlatformOpsConfigured()) notFound();

  const requestHeaders = await headers();
  if (!isRequestFromAllowedNetwork(requestHeaders)) notFound();
}
