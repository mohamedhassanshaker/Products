import type { ReactNode } from "react";
import { assertOpsPageAllowed } from "@/src/lib/ops-page-gate";

/**
 * Root gate for the entire Platform Manager console subtree (NFR-11).
 *
 * This layout sits at the console's **internal** route prefix
 * (`OPS_CONSOLE_INTERNAL_PREFIX`, see `src/lib/ops-console-route.ts`), not at the
 * `/internal/ops` URL operators type: nothing is routable at the public prefix, and
 * `middleware.ts` rewrites an allowed operator's request onto this subtree. That is what
 * makes a denied request indistinguishable from any other nonexistent path — it never
 * reaches this file at all. The URLs in the rest of this comment are the public ones.
 *
 * It applies, via the shared `assertOpsPageAllowed()`, the same
 * configured-and-network-allowed pair of checks `requirePlatformApi()` applies to the
 * sibling API routes, unconditionally, to *every* path under this segment including
 * `/internal/ops/login` itself and every nonexistent path the `[...unmatched]`
 * catch-all absorbs.
 *
 * The actual "redirect to `/internal/ops/login` when not yet signed in" gate lives one
 * level deeper, in `(console)/layout.tsx` — deliberately split into a nested route
 * group rather than one file, since the login page itself must render for an
 * unauthenticated (but network-allowed) caller instead of being redirected to itself.
 * This file renders no chrome of its own (the login page has its own minimal card UI;
 * `(console)/layout.tsx`'s `OpsShell` renders the real shell for every authenticated
 * page).
 *
 * **This layout is no longer the only gate.** The App Router renders layouts and page
 * segments in parallel, so denying here does not stop the segments below from
 * rendering and leaking their own identity into the response — every segment under
 * `/internal/ops` therefore calls `assertOpsPageAllowed()` itself. See that function's
 * doc comment for the measured leak this closes and why the fix has to be spread across
 * every segment rather than concentrated here.
 */
/**
 * Applies to this segment **and every segment below it** (route-segment config
 * propagates down the subtree), and it is load-bearing for two separate reasons —
 * both discovered by this fix's own adversarial verification against a real
 * production build:
 *
 *  1. **It was the actual root cause of the reported `ETag`/`Content-Length`
 *     divergence.** A production build normally runs with the ops env vars unset (CI
 *     has no operator token), so at build time `assertOpsPageAllowed()` denied, and
 *     Next *cached that denial as a static prerender* — `/internal/ops/login`,
 *     `/internal/ops/tenants` and `/internal/ops/tenants/new` each ended up in
 *     `prerender-manifest.json` with their own baked 404 shell, their own `ETag`
 *     (`"4s3czr4g7a4nj"` etc.) and their own `Content-Length` (6031 / 6213 / 6666).
 *     One `ETag` comparison per path enumerated the real routes — exactly QA's repro.
 *     A forced-dynamic segment is never prerendered, so no such artifact exists.
 *  2. **Without it the console could never be turned on at runtime.** Because that
 *     build-time 404 was cached with `Cache-Control: s-maxage=31536000`, a deployment
 *     that set `NEXTBOT_OPS_OPERATOR_TOKEN`/`NEXTBOT_OPS_IP_ALLOWLIST` *after* the
 *     build still served the baked 404 to a correctly-configured, allow-listed
 *     operator. Verified live: with the env configured and an allow-listed caller IP,
 *     `/internal/ops/login` returned the cached 404 rather than the login form. This
 *     was pre-existing (the old single-layout gate threw before touching any dynamic
 *     API, so the whole subtree was prerenderable) and invisible to earlier QA passes
 *     because they exercised the success path under `next dev`, which has no
 *     build-time prerender step.
 */
export const dynamic = "force-dynamic";

export default async function OpsRootLayout({ children }: { children: ReactNode }) {
  await assertOpsPageAllowed();
  return <>{children}</>;
}
