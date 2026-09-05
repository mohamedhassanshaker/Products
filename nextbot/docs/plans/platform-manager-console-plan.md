# Platform Manager console — cross-tenant operator MVP (phased plan)

Source of truth for scope: `C:\Users\m.hassan\.claude\plans\instead-of-chackraui-modify-frolicking-haven.md`
(the approved plan). This doc tracks phase status/deviations only — see that file
for full rationale on every design decision.

## Phase 1 — Foundation (THIS DISPATCH)

**Goal**: a security-sensitive, fail-closed operator surface exists: token+IP-gated
auth, a minimal shell, read-only tenant list/detail, a working provisioning form, and
a platform-level audit trail wired into `provisionTenant()`.

**Backlog item(s)**: NFR-11 (NextBot Platform Operator persona) — no existing
`docs/BACKLOG.md` ID covers this; it is a newly-identified gap (see the approved
plan's Context section) implemented directly per the orchestrator's dispatch.

**Scope**:
- `apps/web/src/lib/platform-ops-auth.ts` — shared core: env-configured check,
  constant-time token verify (SHA-256 digest comparison), hand-rolled IPv4 CIDR
  allowlist matcher, client-IP extraction (Headers-generic).
- `apps/web/src/lib/platform-api-guard.ts` — `requirePlatformApi()`, the
  `/api/internal/ops/**` route guard (bare 404 on any failure mode — unconfigured,
  wrong token, disallowed IP — all indistinguishable from the outside).
- `apps/web/app/internal/ops/layout.tsx` — root gate (configured+IP check only,
  applies even to the login page) + `(console)/layout.tsx` (session-cookie check +
  redirect to login) + `(console)/OpsShell.tsx` (the genuinely separate minimal
  shell — not `AdminShell`).
- `apps/web/app/internal/ops/login/*` — token-entry Server Action, sets the
  `/internal/ops`-scoped httpOnly/SameSite=Strict session cookie, rate-limited via
  the existing `apps/web/src/lib/rate-limit.ts` primitive (5 attempts/60s per IP).
- `packages/modules/tenancy`: `listAllTenants()`, `getTenantOperatorSummary()` (both
  `withPlatform`), `provisionTenant()` extended with an `actorLabel` param + one
  `platform_audit_log_entry` insert in the same transaction.
- `packages/db`: `platform_audit_log_entry` table/migration (`0030_platform_audit_
  log.sql`), append-only hardening in `ensure-roles.ts` (mirrors `audit_log_entry`'s
  idiom exactly).
- Screens: Tenant List (`/internal/ops/tenants`), Tenant Detail (read-only,
  `/internal/ops/tenants/[id]`), Provisioning form (`/internal/ops/tenants/new`).
- Routes: `apps/web/app/api/internal/ops/tenants/route.ts` (GET/POST),
  `.../tenants/[id]/route.ts` (GET).
- **Out of scope this phase** (explicitly, per dispatch prompt): status/plan-tier
  management, `plan_tier_definition` schema, the audit-trail *viewer* UI/route
  (`/internal/ops/audit`, `api/internal/ops/audit/route.ts`) — the trail is written
  this phase, read only via direct DB query in this dispatch's verification, not
  through a built UI. Cross-tenant MCP health rollup (Phase 3).

**Deliverables**: see file list in the dispatch summary / decision log below.

**Exit gate**: typecheck (all 31 turbo packages green), lint + `lint:boundaries`
(zero dependency-cruiser violations — confirmed `no-platform-outside-allowed-
callers` needed no edit), full unit suite (966 tests) green, integration suite for
the new tenancy functions green, isolation suite green (`platform_audit_log_entry`
correctly excluded from `TENANT_SCOPED_TABLES` — it is intentionally not
tenant-scoped), real-process security verification (unconfigured → 404 on every
route; wrong token/disallowed IP → 404; correct token+IP → 200 with real data) run
against the actual dev Postgres/Redis, DB-level append-only proof against both the
test DB (integration test) and the real dev DB (direct `pg` client), and a real
provision → list → detail → audit-row walkthrough via the actual running process.

**Status: DONE — QA-green (2026-08-19).** Both the API-side and page-side
"indistinguishable 404" defects are independently confirmed fixed after 4 dev rounds
/ 5 QA rounds on this specific requirement (see `docs/NEXUS_STATE.md`'s decision log,
2026-08-19 "round 5 re-verification" entry, for the final verdict). The page-side
mechanism ended up structurally different from the API side: rather than equalizing
a denial response, the console's real routes were moved off `/internal/ops/**`
entirely onto an unguessable secret-segment path middleware only rewrites onto for
allowed operators — a denied caller's request is simply left alone, so it gets
whatever a genuinely-missing path already gets, by construction. 2 small findings
(N1 API-surface timing, medium; N2 malformed-id 500, low) were logged for a future
ticket rather than blocking this phase's closure. See "QA retry 3 — Defect 1, final
approach" and the "Page-surface Defect 1" sections below for the full history; all
retained for the record, describing approaches that were tried and superseded before
the final one above passed.

### QA retry 1 notes (historical — Defect 1's fix here was superseded in retry 3)

QA's adversarial security pass (2026-08-18) found 3 critical/blocking defects + 1
CI-blocking + 2 low/informational; all fixed in this pass:

- **Defect 1 (guard's bare 404 distinguishable from a real 404)**: fixed —
  `requirePlatformApi()`'s denial response now performs a same-origin fetch of a
  guaranteed-nonexistent probe path and mirrors Next's own real not-found response
  (status/headers/body) verbatim, rather than hand-building a bare `Response(null)`.
  Verified live against a real `next dev` process: status/`Content-Type`/size-class
  now match a genuinely missing path (15243 vs 15254 bytes for two different
  genuinely-missing API-ish paths — the residual few-byte delta is the embedded
  RSC pathname string, architecturally unavoidable without Next.js itself treating
  the matched route as unmatched, and far below what a `curl`/header-diff style
  comparison would catch). Falls back to the old bare 404 only if the probe fetch
  itself throws.
- **Defect 2 (IP allowlist bypassed via spoofed X-Forwarded-For)**: fixed —
  `extractClientIp()` now trusts `X-Forwarded-For`/`X-Real-IP` **only** when a new
  `NEXTBOT_OPS_TRUSTED_PROXY_CIDRS` env var is configured, and even then only via
  proper trusted-hop peeling (from the right, never the naive leftmost/attacker-
  controlled entry). Confirmed via `docker-compose.yml`/`docs/deployment/
  DEPLOYMENT.md` that this project's actual, currently-deployed topology has *no*
  reverse proxy in front of `apps/web` (`web`'s port is published directly) — so
  the default (unset) behavior never trusts these headers at all, closing the
  exact exploit QA found. This is a real, documented residual trade-off: Next.js's
  App Router gives Route Handlers/Server Actions no access to the raw TCP peer
  address in any run mode short of a bespoke custom server, so this module cannot
  itself verify the immediate connection came from a trusted proxy — the guarantee
  has to come from network-layer isolation (firewall/security group/no longer
  publishing `web`'s port directly) once a real reverse proxy is added, which is
  flagged as a deployment-topology follow-up in `docs/deployment/DEPLOYMENT.md`'s
  "Known gaps", not decided unilaterally here. Verified live: a spoofed
  `X-Forwarded-For` presenting an allowed IP, sent with no trusted proxy
  configured (today's actual default), still gets a 404 from both the page-layout
  gate and the API route guard. Verified the legitimate path too: with
  `NEXTBOT_OPS_TRUSTED_PROXY_CIDRS` configured (simulating a real reverse-proxy
  deployment) and a proper multi-hop `X-Forwarded-For`, login + the full tenant
  list flow work end-to-end via a real Playwright browser session.
- **Defect 3 (console non-functional in a real browser — cookie Path mismatch)**:
  fixed — the session cookie's `Path` changed from `/internal/ops` to `/` (the
  smallest common ancestor of `/internal/ops/**` and `/api/internal/ops/**`;
  `httpOnly`/`Secure`/`SameSite=Strict` already constrain its actual exposure, so
  widening only the path scope is safe). Verified live via real Playwright: logged
  in, confirmed the browser's cookie jar now has `path: '/'`, and confirmed the
  Tenant List screen's own `fetch("/api/internal/ops/tenants")` actually sends the
  cookie (response no longer 404s from the guard — it reaches the real handler,
  which returned 500 in this sandbox only because no real Postgres is reachable
  here, an environment limitation unrelated to the fix, not a regression).
- **Defect 4 (CI-blocking typecheck failure)**: fixed — both `layout.test.tsx`
  mock functions (`notFoundMock`/`redirectMock`) are now typed to accept a
  variadic arg list so the `mock(...a)` spread call type-checks (`vi.fn()`'s
  inferred signature was locked to zero args by its bare `() => {...}`
  implementation). `pnpm turbo run typecheck` confirmed genuinely green across
  all 31 packages.
- **Low/info items**: rate-limiting already surfaces a distinguishable
  "Too many attempts…" form-error state from the Server Action (no HTTP 429
  possible from a Server Action, but this was already handled acceptably —
  no change needed). Dev-mode-only diagnostic leakage on page 404s could not be
  independently re-verified against a real `next build && next start` in this
  sandbox (a pre-existing, unrelated Windows symlink/`EPERM` limitation in this
  dev environment blocks the standalone build step) — based on code inspection,
  no app-level debug/diagnostic code contributes to this app's 404 pages, so any
  such leakage is Next.js's own dev-only overlay behavior, not something this
  app's code controls; flagged rather than silently assumed fixed.

Full suite re-verified green after all fixes: `pnpm turbo run typecheck` 31/31,
repo-wide `eslint . --max-warnings=0` clean, full unit suite 173 files/991 tests
green, coverage on the two touched security-critical files 97.93%/100%
(`platform-ops-auth.ts`/`platform-api-guard.ts`), well above the 80% bar.

## QA retry 3 — Defect 1, final approach (2026-08-19)

Defect 1 ("a guarded denial must be indistinguishable from a route that was never
built") failed independent adversarial re-verification three times. All three earlier
fixes tried to make the guard's denial **imitate** Next's own not-found render, and each
imitation leaked a different real signal: a hand-built bare `Response(null)` (retry 0);
a relayed same-origin probe fetch of one fixed fake path, making every guarded denial
byte-identical to every other while real 404s always vary, and leaking the probe path's
name (retry 1); and the same relay with the probe path derived from the caller's own
path, which leaked the fixed appended segment literal (`__nextbot_probe_9f1c__`, in 100%
of denials and 0% of real 404s) plus a duplicated `Vary` header from composing two
responses (retry 2).

### Why imitation was abandoned, not refined

Measured directly against this app (Next 15.5.23), Next's not-found response is **not
reproducible from inside a Route Handler**, so the whole strategy was structurally
unfixable:

- Its body embeds the requested path's own segments in the RSC payload
  (`"c":["","api","v1","aaa"]`) — no constant can be pre-captured and replayed.
- In dev it *also* embeds a per-request timestamp (`?v=1787086347441` on every asset URL
  plus a `:N<epoch-ms>` marker): two requests to the *same* missing path differ at 19
  byte offsets. Any hard-coded capture would be stale-by-construction.
- `notFound()` from `next/navigation` in a Route Handler does not render that page at
  all — it returns an empty-bodied 404 with a different header set (no `Cache-Control`,
  `Content-Type`, or `X-Powered-By`).
- A `middleware.ts` rewrite renders the page for the *rewrite target*, echoing that
  target's segments and adding an `x-middleware-rewrite` response header.

### The fix: equalize both sides instead of imitating one

Rather than make the denial resemble a real 404, both sides of the attacker's comparison
now come from one function:

- **New** `apps/web/src/lib/api-not-found-response.ts` — `apiNotFoundResponse()`, a
  fixed 404 (`text/plain`, body `Not Found`, explicit `Content-Length`) that takes no
  arguments, so nothing about it can vary by request.
- **New** `apps/web/app/api/[...unmatched]/route.ts` — the catch-all Next routes every
  genuinely-nonexistent `/api/**` path to, exporting every verb and returning
  `apiNotFoundResponse()`.
- `requirePlatformApi()`'s denial path returns the same `apiNotFoundResponse()`.

The two are therefore identical **by construction** — same bytes, same headers, same
route-handler pipeline, same single-render latency — with no second response to compose
and no per-request variation on either side. It also stops serving a 15KB dev-mode
render to unauthenticated callers.

Scoped to `/api/**` deliberately: page routes keep Next's styled not-found rendering
(verified still intact), and an attacker probing `/api/internal/ops/**` compares it
against other `/api/**` paths — exactly the set this covers uniformly.

### Additional leak found and fixed in the same pass

Adversarial verification surfaced a second, previously-unreported route-existence
disclosure in the same defect class, unreachable from inside the guard because Next
answers it *before* any route code runs: `PUT|PATCH|DELETE /api/internal/ops/tenants`
returned **405**, and `OPTIONS` returned **204 with `Allow: GET, HEAD, OPTIONS, POST`** —
enumerating the route's real method set to a completely unauthenticated caller. Both ops
route files now export every unimplemented verb via `apiMethodNotFoundHandler`. (`HEAD`
is intentionally not exported: Next derives it from `GET`, which runs the guard.)

### Adversarial verification method and result

Real `curl` against a real running app — **both** `next dev` and a real production build
(`next build` compiled 65/65 pages successfully; only the pre-existing Windows
`EPERM`-symlink failure in the `output: "standalone"` tracing step failed, which does not
affect `next start`, so prod-mode verification was obtained). All checks passed in both
modes:

- 5 guarded `/api/internal/ops/**` paths (varying depth and segment length), denied via
  wrong token, vs. 5 genuinely-missing `/api/**` paths (also varying depth/length): one
  single distinct status line, one distinct header list (names, order, case, values;
  `Date` excluded), and one distinct body across all 10 responses.
- No duplicated header name on any response (retry 2's `Vary` bug).
- Token-level test for the retry-1/retry-2 killer: no ≥3-char token appears in 100% of
  one group and 0% of the other, in either direction.
- Body length and header-block length identical across both groups (9 and 221 bytes).
- All six denial reasons byte-identical to each other and to the catch-all's response:
  unconfigured env (verified on a second server started without the ops env vars), wrong
  token via header, wrong token via cookie, no credential, disallowed IP, rate-limited.
- Full verb sweep (`GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS`) against both ops routes vs.
  missing paths: identical in every case.
- Success path unbroken: correct token + allowed IP + under the rate limit still returns
  `200` with real tenant JSON.
- Regression sweep: `/`, `/login`, `/forgot-password`, every sampled `/api/v1/**` route,
  and `/_next/static/**` all still resolve to their own handlers (the catch-all shadows
  nothing); missing *page* paths still get Next's styled HTML 404.

**Measured residual, documented not hidden** (see `requirePlatformApi()`'s inline
comment): the rate-limit Redis round-trip makes a *wrong-token* denial ~0.79 ms slower
at p50 than a nonexistent path (150 samples/arm, production build, loopback). The
*disallowed-IP* arm — which is what any caller outside `NEXTBOT_OPS_IP_ALLOWLIST` gets,
i.e. every remote caller under this project's default no-trusted-proxy config — is
−0.03 ms, indistinguishable. Not "fixed" because both available fixes are worse:
checking the token before the rate limit reopens retry 2's unbounded brute-force defect,
and making all 404s do a Redis round-trip is an abusable amplification vector across the
app's entire 404 surface.

Gates: `turbo run typecheck` 31/31 green, repo-wide `eslint . --max-warnings=0` clean,
unit 174 files/1003 tests green (plus the new/rewritten tests), integration 68 files/290
tests green, isolation 10 files/76 tests green, coverage on every file this pass added or
changed **100% statements/branches/functions/lines**.

## Page-surface Defect 1 — sibling of the API-side leak (2026-08-19)

QA's final adversarial pass confirmed the API-side fix and found the same information leak
on the **page** surface. Same defect class, entirely separate mechanism, fixed here.

### What leaked

`app/internal/ops/layout.tsx` denied by calling `notFound()`, which renders the not-found
boundary *inside the requested route's own tree*. Measured against a real running app:

1. **Page segments render in parallel with their layouts.** A layout that denies does not
   stop the segments below it from rendering — verified twice (once with `notFound()`, once
   with the layout returning a static component instead of `children`). A denied
   `/internal/ops/tenants` therefore carried `TenantListScreen`'s real component and
   webpack-chunk names, `/internal/ops/login` carried `OpsLoginForm`'s, and
   `(console)/layout.tsx`'s session redirect having run anyway put the literal
   `NEXT_REDIRECT;replace;/internal/ops/login;307;` into the payload — naming a real route
   outright to an unauthenticated caller on a completely unconfigured deployment.
2. **A production build baked the denial as a static prerender — the actual root cause of
   the reported `ETag`/`Content-Length` divergence.** CI builds with the ops env vars
   unset, so at build time the gate denied and Next cached that 404: `/internal/ops/login`,
   `/internal/ops/tenants` and `/internal/ops/tenants/new` each landed in
   `prerender-manifest.json` with their own baked shell, own `ETag` and own
   `Content-Length` (6031 / 6213 / 6666), while every genuinely-missing path in the app is
   answered from *one* prerendered not-found entry with *one* `ETag` and 6871 bytes. One
   `ETag` comparison per path enumerated the real routes.
3. **Same bug made the console unbootable.** That baked 404 carried
   `Cache-Control: s-maxage=31536000`, so a deployment that configured the console *after*
   the build still served the cached 404 to a correctly-configured, allow-listed operator —
   verified live. Invisible to every earlier QA pass because they exercised the success path
   under `next dev`, which has no prerender step.
4. **Browser-visible, not just `curl`-visible.** A denied real page rendered Next's bare
   `__next_error__` shell (no `<html lang>`, no stylesheet, no visible text) while genuine
   404s rendered Next's styled default with its own `<title>` — three different-looking
   "not found" answers in one app.

### The fix

Same principle as `apiNotFoundResponse()` — **equalize both sides by construction, never
imitate one from the other** — applied at the only layer where it is achievable for pages.

- `middleware.ts` (new) refuses a `/internal/ops/**` request *before Next routes it*, by
  setting one internal **request** header, `x-nb-ops-denied`. It builds no response, so it
  adds nothing observable.
- `next.config.mjs`'s `rewrites()` (new) matches that header in `beforeFiles` and rewrites
  the request onto `/__nb_route_absent__/<original path>`, which no route implements. Next
  then serves its ordinary "no such route" answer — the *same prerendered entry, through
  the same code*, that any other missing path gets. Identical status, headers, `ETag`,
  `Content-Length`, bytes, `<title>` and visible text, with nothing derived from the path.
- A `fallback` rewrite puts every *other* missing path in the app through the same
  `/__nb_route_absent__/<original path>` shape, so the RSC-only `x-nextjs-rewritten-path`
  header reads identically for both groups. Its `missing:` guard stops it double-applying
  to an already-flagged ops request (rewrites are multi-pass).
- `src/lib/ops-page-gate.ts` (new) `assertOpsPageAllowed()` is called by **every** segment
  under `/internal/ops` — root layout, `(console)` layout, all four pages, and the new
  `[...unmatched]` catch-all. This is the access control (middleware owns
  indistinguishability only), and it must be per-segment because of the parallel-render
  behaviour above.
- `export const dynamic = "force-dynamic"` on the ops root layout (propagates to the whole
  subtree) removes the baked-prerender leak and the cannot-be-turned-on bug at once.
- `src/lib/not-found-page.tsx` + `app/not-found.tsx` (new) make the app have exactly **one**
  not-found UI, static and prop-less, so the three-different-looking-404s problem is gone.
- `src/lib/platform-ops-network.ts` (new) holds the configured/CIDR/trusted-proxy helpers,
  unchanged, re-exported verbatim from `platform-ops-auth.ts`. Needed because middleware runs
  in the Edge runtime, which cannot load `node:crypto` or `server-only`.

### Ruled out by measurement, not by preference

- `NextResponse.rewrite(...)` — matched the body and `ETag` exactly, but Next emits
  `x-middleware-rewrite: <destination>` on it (100% of denials, 0% of genuine 404s), and
  deleting that header from the response **cancels the rewrite outright** (verified: the
  request then returned an empty `200`). Rewriting directly to the prerendered not-found
  entry additionally swapped in its `Cache-Control: s-maxage=…`.
- Denying inside the route tree at all (`notFound()`, or returning a static component) —
  provably cannot match a prerendered entry's bytes *or* headers, and cannot stop the
  requested page's own subtree from rendering. Six variants measured.
- A bare rewrite destination leaving `:path*` unconsumed — Next appended `?path=…`, putting
  the literal token `path` into 100% of denials and 0% of genuine 404s: the exact
  fingerprint class that failed API rounds two and three.
- Any probe fetch or second response. Not attempted; explicitly asserted against in tests.

### Adversarial verification (real running app, dev **and** a production build)

`next build` compiled and generated 62/62 pages; only the pre-existing Windows `EPERM`
symlink failure in the `output: "standalone"` tracing step failed, which does not affect
`next start`, so prod-mode verification was obtained rather than deferred.

Harness: 5 denied **real** ops pages vs. 5 genuinely-missing `/internal/ops/**` paths of
varying depth vs. 5 genuinely-missing paths elsewhere in the app, compared on status line,
the full header block (name, order, case and value; only `Date`/`Connection`/`Keep-Alive`
excluded), `ETag`, `Content-Length` and body bytes — across `GET`/`HEAD`/`POST`/`OPTIONS`/
`PUT`/`DELETE` and an `RSC: 1` flavour. Plus the round-1/2 killer test: no ≥3-char token may
appear in 100% of one group and 0% of another, in either direction (tokens contributed by the
caller's own requested path excluded, since every genuine 404 echoes its own path too).

Result, **all seven request flavours**: exactly ONE status line (`404`), ONE header block,
ONE body (6871 bytes HTML / 3982 bytes RSC / 0 for `HEAD`), and no token leak in any
direction. Confirmed identical for **every** denial reason: unconfigured deployment,
configured-but-unresolvable caller IP, spoofed `X-Forwarded-For`, a real trusted-proxy chain
resolving to a disallowed IP, a multi-hop chain resolving to a disallowed IP, a bogus session
cookie, and the *correct* operator token presented from a disallowed IP. Shape-matched pairs
(`/internal/ops/tenants` vs `/internal/xps/tenants`, and the same for `login` and a 2-deep
path) were byte-diffed individually: identical bodies (same md5), identical headers apart
from the caller's own path echoed in `x-nextjs-rewritten-path`.

Browser-observable check: the response body is byte-identical (same md5) across all three
groups, so no browser-observable difference is possible; the one shared document renders
`<html lang="en" dir="ltr">`, one stylesheet, `<title>NextBot Admin Console</title>`,
`<meta name="robots" content="noindex">`, no icon links, and the visible text
"404 This page could not be found." QA's original repro commands now return one `ETag`
(`"wgyhso1d6d5av"`), one `Content-Length` (6871) and zero matches for
`NEXT_REDIRECT;replace;/internal/ops/login;307;`, `TenantListScreen` and `OpsLoginForm`.

Success path re-verified on a configured deployment (allow-listed IP behind a trusted proxy)
— and it now works in a production build **for the first time**: login form renders `200`,
no/invalid session on `/internal/ops/tenants` redirects `307` to `/internal/ops/login`, the
correct session cookie renders the real Tenants and Provision-a-tenant screens, and a
mistyped ops URL gets the shared 404. Regressions: the API surface is untouched (all four
sampled `/api/**` paths, guarded and missing alike, still return the identical 9-byte
`Not Found`), and `/`, `/login`, `/forgot-password` and `/_next/static/**` all behave as
before.

Gates: `turbo run typecheck` 31/31 green, repo-wide `eslint . --max-warnings=0` clean,
`dependency-cruiser` 0 violations (2132 modules), unit 180 files/1043 tests green,
integration 68/290 green, isolation 10/76 green. Coverage on every file added or changed:
100% statements/branches/functions/lines on `middleware.ts`, `app/not-found.tsx`,
`ops-page-gate.ts`, `not-found-page.tsx`, `platform-ops-auth.ts`, the ops `layout.tsx`s and
all five ops `page.tsx`s; `platform-ops-network.ts` 100% statements/lines, 93.47% branches
(pre-existing `parseIpv4` edge branches).

## Page-surface Defect 1, QA retry 2 — the gated root's transport forms (2026-08-19)

QA confirmed the mechanism above holds and found one residual inside it. Of 13 probed
prefixes, only the three transport forms of the gated **root** —`/internal/ops.rsc`,
`/internal/ops.json`, `/internal/ops.segments/__PAGE__.segment.rsc` — answered *without*
the `x-nextjs-rewritten-path` header every other 404 in the app carries. The header's
presence/absence was itself the leak: one `RSC: 1` request per prefix confirmed the
`/internal/ops` namespace exists, regardless of the caller's own path.

### Root cause (QA's inference — confirmed, with one correction)

Verified against the real generated artifacts and Next's own source, not inferred from
black-box probing:

- `next/dist/build/analysis/get-page-static-info.js`'s `getMiddlewareMatchers()` wraps every
  configured matcher as `/:nextData(_next/data/[^/]{1,})?<source>{(\.json|<app transport>)}?`.
  `.next/server/middleware-manifest.json` confirms it: our `/internal/ops` matcher compiled
  to `…\/internal\/ops(\.json|\.rsc|\.segments\/.+\.segment\.rsc)?[\/#\?]?$`.
- Rewrite sources get no such expansion — `tryToParsePath()` compiles them literally, and
  `routes-manifest.json` confirmed `/internal/ops` → `^/internal/ops(?:/)?$`, matching none
  of those three forms.
- So middleware flagged the request denied, no `beforeFiles` rule could match it, and the
  `fallback` rule — conditioned on the denial flag being **absent** — was suppressed by the
  very flag that needed it. The request fell through unrewritten.
- Only the *root* leaked, because a deeper path's suffix is swallowed by `:path*`'s own
  segment matching (`[^/]+?` matches `tenants.rsc` whole). Hence `/internal/ops/tenants.rsc`
  was always fine.

**Correction to one implication.** "Remove the `missing:` guard so the fallback normalizes
these too" was measured and is wrong: `fallback` rewrites *are* re-applied on top of a
`beforeFiles` rewrite's output, so dropping the guard made denied deeper paths answer
`x-nextjs-rewritten-path: /__nb_route_absent__/__nb_route_absent__/internal/ops/tenants.rsc`
against a genuine 404's single prefix — the same 100%/0% fingerprint, moved from the root
onto every deeper gated path. (`fallback` does *not* re-apply to its own output; a
caller-requested `/__nb_route_absent__/foo` is prefixed exactly once.) The guard stays.

### The fix

`next.config.mjs` gains a third `beforeFiles` rule, `/internal/ops:transport([^/].*)`, and
deliberately **not** an enumeration of the three observed suffixes. The three sources are
jointly exhaustive by case analysis on whatever follows `/internal/ops` — the tail is empty
(rule 1), starts with `/` (rule 2), or starts with anything else (rule 3) — so no suffix
Next invents later can escape them. Enumerating Next's transport grammar here would need an
edit on every Next upgrade, and the cost of missing one is a silent information leak.

`next.config.test.ts` now asserts that exhaustiveness by compiling **both** sides with the
same functions the real build uses — `getMiddlewareMatchers()` for the matcher,
`tryToParsePath()` for the rewrite sources — over a corpus of curated plus 2000
deterministic pseudo-random tails: whatever middleware can flag, a `beforeFiles` rule must
catch. Run against the pre-fix two-rule config it reports exactly the three paths QA found,
derived independently of QA's report; against the fix, none. A Next upgrade that changes the
expansion now fails a test instead of quietly reopening the leak. One shape is recorded as
deliberately uncovered: an empty-segment path (`/internal/ops/a//b`), which no rewrite
matches, which the matcher equally declines to flag (so the fallback normalizes it), and
which Next answers with a 308 to its collapsed form before routing.

### Adversarial verification (real production build, `next build && next start`)

Two harnesses, both comparing denied **real** ops pages vs. denied genuinely-missing ops
paths vs. genuinely-missing paths elsewhere (including QA's near-miss prefixes
`/internal/op`, `/internal/opsx`, `/internal`), on status line, full header block (name,
order, case, value), `ETag`, `Content-Length` and body md5:

- **432 responses per denial reason**: 6 methods (`GET`/`HEAD`/`POST`/`OPTIONS`/`PUT`/
  `DELETE`) × 6 request forms (plain, plain + `RSC: 1`, `.rsc`, `.json`,
  `.segments/__PAGE__.segment.rsc`, `.segments/_tree.segment.rsc`) × 12 paths. Result: one
  status (`404`), one header block, one body per cell (6871 bytes HTML / 3982 RSC / 0 HEAD),
  `x-nextjs-rewritten-path` present and equal to `/__nb_route_absent__` + the caller's own
  path in **every** case, and no ≥3-char token in 100% of one group and 0% of another.
- **95 exotic shapes per denial reason** (19 templates × 5 header sets incl.
  `Next-Router-Prefetch`/`-State-Tree`/`-Segment-Prefetch`): `?query`, `.rsc?query`,
  `.segments/_tree`, two-level `.segments/deep/nested/…`, **`.prefetch.rsc` (a suffix Next
  does not define — uniform, which is the exhaustiveness property paying off)**, `.txt`,
  `..rsc`, `%2Ersc`, trailing slash, `/_next/data/<build-id>/…json` and `…rsc`, `//`-prefixed,
  `/__nb_route_absent__/…`-prefixed, uppercase, `/index`, `;x=1`. All uniform.

Both run against **7 denial reasons**: unconfigured deployment; and on a configured one —
disallowed IP via a trusted-proxy chain, a multi-hop chain resolving to a disallowed IP, an
all-hops-trusted (unresolvable) chain, an unparseable hop, disallowed IP + bogus session
cookie, and disallowed IP + the **correct** operator token. 3024 + 665 responses, zero
differences.

Success path re-verified on the configured deployment: `/internal/ops/login` 200,
`/internal/ops/tenants` 307→login without a session and 200 with one (real Tenants and
Provision screens, `<title>NextBot Admin Console</title>`), and — the regression that
mattered for this fix — `.rsc`/`.segments` transport requests to real ops pages still return
200 for an allowed operator (rule 3 fires only on the denial flag). `/internal/ops` itself is
404 even for an allowed operator: no route is defined there. API surface untouched: all four
sampled `/api/**` paths, guarded and missing alike, still return the identical 9-byte
`Not Found` (md5 `9d1ead73e678`), and `/`, `/login`, `/forgot-password` behave as before.

### Housekeeping

`qa-results/**` added to `eslint.config.mjs`'s ignore list. QA's own evidence scripts
(`timing.mjs`, `shot5.mjs`) are plain `.mjs` with no Node globals entry in this config and
were failing the repo-wide lint gate with 10 `no-undef`/unused-var errors even though product
source was clean. Ignoring the whole evidence tree (rather than deleting the two files) keeps
a future QA pass from breaking `pnpm lint` the same way.

### Gates

`turbo run typecheck` 31/31 green; repo-wide `eslint . --max-warnings=0` clean (was 10
errors); `dependency-cruiser` 0 violations (2134 modules, 7815 dependencies); integration
68 files/290 tests green; isolation 10/76 green; unit 180 files/**1046 of 1047** green.
Coverage on the changed file: `next.config.mjs` 88.95% lines/statements, 100% branches (the
only uncovered region is the pre-existing `webpack()` hook, untouched by this dispatch);
`middleware.ts` remains 100%.

**The one non-green result is a pre-existing, load-sensitive flake, not a regression**:
`app/api/internal/ops/tenants/route.test.ts`'s "returns the guard's Response verbatim when
unauthorized" times out at vitest's 5s default under full-suite parallelism. It passes in
1.66s in isolation; its body is three mock assertions with no I/O, and the cost is the
file's first `await import("./route.js")` cold module load. It reproduces with this
dispatch's new test file excluded, so it is independent of these changes — flagged rather
than silently "fixed" by raising a shared timeout, which is a test-infrastructure decision
outside this dispatch's scope.

## Page-surface Defect 1, retry 3 — mechanism replaced: the console has no public route (2026-08-19)

Status: **implemented, self-verified, awaiting independent QA.** This dispatch was
authorized specifically to replace the failing mechanism rather than patch it again (the
retry cap on the old one was reached), and it does: the `x-nb-ops-denied` request header and
all three `beforeFiles` rules plus the `fallback` rule are **gone from `next.config.mjs`**
(`routes-manifest.json` now reads `{"beforeFiles":[],"afterFiles":[],"fallback":[]}`).

### What was measured first, on a real production build

The instruction was to have middleware issue the rewrite itself
(`NextResponse.rewrite(...)`) and to verify empirically — not assume — that it is
indistinguishable. It is not, and the measurement is unambiguous (Next 15.5.23,
`next build && next start`, harness kept at
`qa-results/ops-page-404-indistinguishability/20260819-dev-retry3-middleware-only/harness/exp-middleware.ts`):

- Denied `/internal/ops/tenants` → `404`, `ETag "uys0phplmm5av"`, `Content-Length 6871` —
  body, `ETag` and every other header identical to a genuine 404 — **plus**
  `x-middleware-rewrite: /__nb_route_absent__/internal/ops/tenants`. On RSC requests it also
  gains `x-nextjs-rewritten-path`. Genuine 404s carry neither. 100% / 0%.
- Deleting the header in middleware **cancels the rewrite** (`200`, empty body), re-confirming
  the earlier round's finding. Root cause read from Next's source, not inferred:
  `server/lib/router-utils/resolve-routes.js` reads `x-middleware-rewrite` *off the middleware
  response* to learn the destination and then copies it to `resHeaders` unconditionally, and
  `router-server.js` `res.setHeader()`s everything in `resHeaders`. There is no config hook
  that removes it, and `headers()` rules are processed *before* middleware, so they cannot
  overwrite it either.
- It cannot be normalized away by making genuine 404s carry it too: the value is necessarily
  the rewrite destination, which for a denial differs from the request path and for an
  untouched path does not exist at all.

So a mechanism that runs **only on the denial path** is itself the signal, whatever it does.
That is the generalization of all three previous failures, and it is what got inverted.

### The mechanism now

**Nothing in this app is routable at `/internal/ops/**`.** The whole console moved one segment
deeper, to `app/internal/ops/nb-c-4f21c8a7e3d9b605/**`
(`OPS_CONSOLE_INTERNAL_PREFIX`, new `apps/web/src/lib/ops-console-route.ts`). `middleware.ts`:

- **allowed operator** → `NextResponse.rewrite()` onto the internal path (browser URL
  unchanged);
- **denied caller** → `NextResponse.next()`, i.e. *nothing at all*. Next routes
  `/internal/ops/whatever`, finds genuinely no route, and answers with the same single
  prerendered not-found entry every other missing path gets;
- **anyone addressing the internal path directly** → rewritten back onto the public
  (routeless) prefix, so it 404s — **identically for allowed and denied callers**, which is
  what keeps that branch from being an authorization oracle.

Why this ends the bug class rather than fixing an instance of it: **the security property no
longer depends on matching anything.** There is no second pattern set to keep in sync with
`config.matcher`, no request header that any rule reads (so nothing a caller sends can
influence which response they get), and if the matcher misses a shape — or middleware fails to
compile, or is deleted — the request still lands on a route tree with nothing at
`/internal/ops/**`, i.e. the failure mode is the correct indistinguishable 404. The matcher is
now a *console-availability* concern, not a security control. Next also normalizes transport
forms away before middleware runs (verified: `/internal/ops.rsc` and
`/_next/data/<id>/internal/ops.json` both arrive as pathname `/internal/ops`), so the whole
suffix/prefix axis that broke retry 2 no longer appears in the code at all.

`force-dynamic` on the console's root layout, the per-segment `assertOpsPageAllowed()` gate,
the `[...unmatched]` catch-all, `app/not-found.tsx` and `platform-ops-network.ts` are unchanged
in behaviour; they all moved with the subtree. Access control is untouched — this is still
only the disclosure control.

### Verification (final build, `next build && next start`, BUILD_ID `xE1CHD3uw0rEmXujLfWTP`)

Evidence: `qa-results/ops-page-404-indistinguishability/20260819-dev-retry3-middleware-only/`.

- **7956 responses / 34 like-for-like buckets / exactly one signature per bucket, zero
  distinguishable** (status line + full ordered header block, name/case/value, `Date`,
  `Connection`, `Keep-Alive` excluded + body sha256). 13 caller contexts × 4 path groups
  (5 gated paths, 5 depth-matched genuinely-missing, 5 near-miss/sibling prefixes) × 12 shapes
  (plain, `.rsc`, `.json`, `.segments/__PAGE__.segment.rsc`, each also under
  `/_next/data/<build-id>/` and `/_next/data/ANY-SEG/`) × `GET`/`HEAD`/`POST`/`OPTIONS`/`PUT`/
  `DELETE` on the plain shape, each with and without `RSC: 1`. One body per shape (6871 B HTML
  / 3982 B RSC / 0 B HEAD), so the "no ≥3-char token in 100% of one group and 0% of the other"
  check is satisfied by construction.
- **Denial reasons covered**: unconfigured; configured with an unresolvable IP; disallowed IP
  direct, via a trusted hop, via a multi-hop chain, all-hops-trusted, unparseable hop, and via
  `X-Real-IP`; bogus session cookie; spoofed `X-Forwarded-For` naming an allow-listed IP; and a
  **forged `x-nb-ops-denied: 1`** — now read by nothing, and measurably inert.
- **Real-browser operator flow, fresh production build**: login form → token submit → redirect
  to `/internal/ops/tenants` with the real console shell (`aria-current="page"` on the Tenants
  nav item still correct, i.e. `usePathname()` returns the *public* URL under the rewrite) →
  `/internal/ops/tenants/new` renders "Provision new tenant" → client-side `next/link`
  navigation back is a real SPA transition (no reload) through the rewrite → sign-out returns
  to the login form. Mistyped console URL → the shared 404. Screenshots `b1`–`b6`.
- **Non-defect recorded so it is not re-flagged**: hydrated-DOM length differs between page
  loads (6545 / 6623 / 7175 chars). It is a client-side race on React Float's `<script async>`
  insertion, not a signal — the *same* path yields different values across fresh contexts
  (`dom-length-is-a-timing-artifact.txt`), and the raw bodies are byte-identical.
- **Regressions**: API-side Defect 1 spot-check — guarded and missing `/api/**` paths still
  return the identical `Not Found`. `/`, `/login`, `/forgot-password`, `/_next/static/**`
  unchanged.
- **Gates**: `turbo run typecheck` 31/31; `eslint . --max-warnings=0` clean;
  `dependency-cruiser` 0 violations (2135 modules / 7817 dependencies); unit 180 files /
  1051 tests green (at `--testTimeout=20000`, the documented workaround for this machine's
  pool-contention flakiness); integration 68/290 green; isolation 10/76 green; coverage 100%
  statements/branches/functions/lines on both changed/added source files (`middleware.ts`,
  `src/lib/ops-console-route.ts`).

### Tests

- `next.config.test.ts` **deleted** with the mechanism it covered — including the
  `stripNextDataPrefix()` helper QA correctly identified as self-fulfilling on exactly the axis
  that leaked. There is no longer a second pattern set to prove exhaustive against.
- `middleware.test.ts` rewritten: a denial's response must carry *only* Next's internal
  `x-middleware-next` (no rewrite header, no request-header override) and must be identical for
  every reason, depth and real-vs-nonexistent path; a forged `x-nb-ops-denied` changes nothing
  on either branch; the allow branch rewrites onto the internal prefix preserving tail and
  query; a direct internal-path request is neutralized identically whatever the gate says; and
  the matcher (compiled with Next's own `getMiddlewareMatchers()`) still covers every transport
  form — now as an *operator-reachability* assertion.
- `src/lib/ops-console-route.test.ts` (new) asserts the load-bearing structural invariant by
  walking `app/`: no `page`/`route`/`default` file resolves to a URL under `/internal/ops`
  except beneath the internal prefix (route groups stripped, so a `(group)` can't smuggle one
  in), and the folder the constant names really exists with the console inside it. Re-adding a
  page at the public prefix — the one change that would silently reopen the leak — fails here.

### Known residual, deliberately recorded rather than hidden

One path in the app answers differently from its neighbours: the console's own internal
prefix. `/internal/ops/nb-c-4f21c8a7e3d9b605[/…]` returns the byte-identical 404 body but with
Next's `x-middleware-rewrite` header attached (measured: same status, `ETag`,
`Content-Length`, body hash as every other 404; only that header differs). It is
**gate-independent** — identical for unconfigured, disallowed and fully-authorized callers, so
it reveals nothing about authorization — and reaching it requires guessing a fixed 16-hex-char
segment. It is not a secret protecting access (the in-tree gate and the API guard are
unchanged), only the reason a scanner cannot find the one path whose header block differs.
Removing it entirely is not possible with any middleware primitive: any route the console is
served from is addressable, and the only ways to answer such a request are a rewrite (which
stamps the header) or letting the in-tree gate render (which is worse — a dynamic render,
and gate-dependent).

## Page-surface Defect 1, QA round 5 — the timing oracle the matcher itself created (2026-08-19)

**Status: implemented, verified, ready for QA.** The round-4 mechanism (no route at
`/internal/ops/**`; middleware rewrites an *allowed* operator onto the secret-segment internal
prefix; a denial is a bare `NextResponse.next()`; a direct internal-path request is rewritten
back onto the routeless public prefix) is **unchanged** — QA confirmed it sound as a design and
this round did not touch it. Two narrowly-scoped defects were fixed *around* it.

### Defect 1 (blocking) — `config.matcher` was the signal

QA measured `/internal/ops/**` 404s at ~+1.25 ms p50 over shape/depth-matched genuinely-missing
paths on a real production build, and identified the matcher's scope as the cause. Reproduced
first, on this host, before changing anything (`next build && next start`, loopback,
BUILD_ID `0XSckFWE-ie0ZFMWIbf50`, interleaved samples, n=380 after warmup drop):

| | p50 (ms) |
|---|---|
| `/internal/ops/tenants`, denied (unconfigured) | 3.191 |
| `/internal/xps/tenants` (missing, same shape/depth) | 1.726 |
| `/nothing-here-at-all` | 1.629 |

→ p50 delta **1.465 ms**; and QA's 5-sample median classifier identified the real prefix in
**40/40** trials (controls 17-22/40) at every sample size n=5/20/50. A 13-path ranking probe put
all five `/internal/ops`-family paths at p50 1.767-1.927 and every non-family path at
1.237-1.286 — a clean separation exactly at the matcher's boundary, with `/internal/opsx`
(outside it) on the fast side.

**Fix, in two parts** — both making cost *universal* rather than boundary-correlated:

1. `config.matcher` is now the single pattern `"/((?!_next/static|_next/image|favicon.ico).*)"`
   — every non-asset path in the app, `/api/**` included (it used to be excluded). The two
   exclusions are not correlated with the boundary: no console route lives in either namespace,
   both are excluded for ops and non-ops paths alike, and every ordinary page-like path — in
   each transport form Next appends to the pattern itself (`.rsc`, `.json`, `.segments/…`,
   `_next/data/<id>/`) — is covered uniformly. There is no narrower "matched but not
   ops-shaped" class left, because `/internal/opsx/tenants`, `/nothing`, `/login` and
   `/internal/ops/tenants` are all now invoked.
2. Broadening the matcher alone only halved the gap (measured: 1.465 → **0.726 ms** p50). The
   remainder was the *gate call*, which was still the one thing ops paths did that no other
   path did — consistent with QA's observation that an unconfigured deployment and a
   fully-configured one cost the same, since in the Edge sandbox the `process.env` reads behind
   it dominate. So `isRequestFromAllowedNetwork()` is now evaluated **unconditionally, before
   anything branches on the path**, and only read back by the last branch. Every request in the
   app does identical work; only the return value depends on the path. (The redundant
   `isPlatformOpsConfigured()` branch went away with it — the network check already fails closed
   when unconfigured.)

**Re-verified** with QA's own methodology, twice: on the fix build (BUILD_ID
`gVAZrwdEyhZq4N7njhdMI`) and again end-to-end on the **shipped tree** (BUILD_ID
`fEmam_-QM685LDXd6TaqL`, rebuilt after the doc-comment edits so no measurement predates the
code it describes):

- QA's classifier, unchanged script, port 3491: gated paths **17-21/40** at n=5, **10-20/40** at
  n=20, **15-20/40** at n=50 — indistinguishable from the missing controls (15-30/40 across the
  same runs). Was 40/40 at every n before. Shipped-build re-run: gated **16-26/40**, controls
  **13-23/40** — fully overlapping ranges.
- Extended classifier (14 candidates incl. escaped spellings, the secret prefix, `/api/**`, a
  real 200 route): no gated page path separable from control; within-class comparisons uniform.
- Ranking probe: all 13 paths inside p50 1.788-1.873 ms (spread 0.085 ms) with the gated paths
  mid-pack — was a 0.5 ms clean split.
- `probe-timing.mjs`'s remaining ~0.6 ms delta is an **artifact of that script's fixed case
  order** (its `denied-gated` case is always the first request of each round, right after the
  ~8 ms ALLOWED console render). Same script with the per-round order shuffled:
  **+0.028 / −0.031 / −0.023 ms** across the three deployments. Recorded here because the raw
  script will keep showing ~0.6 ms.

**Cost to the rest of the app** (measured, port 3492, n=180 after warmup, before → after):
`/login` 1.675 → 2.353, missing page 1.773 → 2.646, `/api` unmatched 2.302 → 2.956, `/api`
ops 2.044 → 2.734, gated ops page 2.834 → **2.671** (now at/below the missing-path control).
Static chunk 6.277 → 6.158 (unchanged — matcher-excluded, as intended). So: **~+0.7 ms per
non-asset request app-wide**, static assets untouched. That is the deliberate price of the
boundary being unmeasurable; `apps/web` is the control plane (the chat runtime is
`apps/gateway`), so the absolute cost sits well inside normal request variance.

### Defect 2 (low, reported as cache-header polish) — was actually a small gate oracle

QA found the percent-encoded secret path returning `Cache-Control: s-maxage=31536000` instead of
`no-store`. Investigating the mechanism showed it was more than a header: Next's router decodes
a pathname before matching it against the route tree, but middleware sees the escapes — so
`/internal/ops/nb%2Dc%2D…/tenants` slipped past the internal-prefix neutralization and reached
the *real* console route, where only the in-segment `assertOpsPageAllowed()` stopped it
(correctly — the defense-in-depth layer did its job — but by a different code path). Measured
consequences, all requiring the secret segment to already be known:

- denied → 404 with the cacheable `s-maxage` header; **allowed → 404 with the doubled-prefix
  rewrite header and a different `Content-Length`** — i.e. gate-*dependent*, not gate-independent.
- The signature also distinguished console routes that exist (`/tenants`, `/login` → `s-maxage`)
  from ones that don't (`/definitely-not-a-page` → `no-store`).
- Escaping any character worked, not just the secret segment's own: `/internal/o%70s/nb-c-…`
  did too.

**Fix**: `decodeOpsPathnameOnce()` (new, in `ops-console-route.ts`) — middleware now treats a
pathname whose *decoded* form is under the internal prefix as internal, and builds the rewrite
target from whichever form matched. Every escaped spelling therefore collapses onto the one
plain-internal-path response. Decoding is applied **once**, matching the router, so a
double-escaped spelling stays a plain 404 rather than being folded in; a malformed escape
sequence returns the pathname unchanged instead of throwing. Deliberately *not* changed: the
allow-side rewrite still uses the raw pathname, so no new console reachability was introduced
for any encoded shape — the fix only ever routes escaped spellings *away* from the console.

Verified on the final build: plain, `%2D`-escaped and `o%70s`-escaped spellings of the secret
path now return identical status / `Cache-Control` / `ETag` / `Content-Length` / body and the
same `x-middleware-rewrite: /internal/ops/tenants`, across unconfigured, disallowed-IP and
fully-authorized callers alike. `probe-pairwise`'s `secret-seg-encoded` signature is now
byte-identical to `secret-seg-vs-decoy`'s (the plain secret-path family) — one class, where
there were three.

### Regression re-check (nothing QA already confirmed clean moved)

Full historical shape matrix re-run on the fix build **and again on the shipped build**, compared
line-for-line with QA's round-4 artifacts: `denied-vs-missing` **0 distinguishable out of 34
buckets / 10 982 responses** both times (identical to round 4); internal-secret-prefix probe 4 gate-dependent cases out of 378×8 —
*the same four* as round 4 (the `<secret>.json` / `.segments` suffix forms of the prefix
itself); exotic-shape probe 416/812 deviations, same 24-shape breakdown as round 4 (harness
artifacts: RSC-header rows compared against a plain baseline, plus 308 redirect shapes);
pairwise probe the same 7 deviating shapes. API side spot-checked: `/api/internal/ops/**` and
`/api/[...unmatched]` still byte-identical (`404`, 9 bytes, same hash, no middleware headers)
on GET and POST across all three deployments, despite middleware now running on `/api`.
Real-browser operator flow (Playwright, port 3492): login → wrong token → correct token →
tenant list → mistyped path 404 → secret path 404 → sign-out, all working, output identical to
round 4 including its two known harness quirks (the provision-link selector, and the
hydrated-DOM-length race already documented as an artifact).

One deliberate behaviour change on the **allow** side: `/internal/xps/../ops/tenants` now
renders for an authorized operator instead of 404ing, because Next consults the matcher before
`..` normalization, so the broadened matcher reaches a shape the scoped one missed. Denied-side
behaviour for that shape is unchanged. This is the documented "a shape the matcher misses costs
an operator a spurious 404" trade-off resolving in the operator's favour, not a disclosure change.

### Gates

`typecheck` 31/31 · `lint` + `lint:boundaries` clean (dependency-cruiser: 0 violations, 2135
modules) · unit 1060/1060 · integration 290/290 · isolation 76/76 · coverage on both changed
files **100% stmts/branch/funcs/lines**. Tests added: matcher scope + non-ops coverage +
asset-exclusion assertions; "gate evaluated exactly once for every request, whatever the path"
(the regression guard for Defect 1's second half); escaped-spelling neutralization across all
three caller states; double-escape and malformed-escape behaviour; `decodeOpsPathnameOnce`'s own
unit tests. Evidence: `qa-results/ops-page-404-indistinguishability/20260819-dev-round5-matcher/`
(before/after probe outputs, harness, screenshots).

### Residual, unchanged from round 4

The internal prefix's `x-middleware-rewrite` header (see the previous section) still stands, and
still requires guessing a fixed 16-hex-char segment. Two measurement notes for that class,
recorded rather than hidden: it is marginally slower than a bare denial (the rewrite branch does
real work — 24-37/40 on the classifier), and the escaped spellings now sit in *this* class
rather than in a class of their own. Both are behind the same precondition and neither is
gate-dependent.

## Local design decisions made without escalating (small, reversible)

- **Route structure**: split into a top `layout.tsx` (configured+IP gate only,
  applies uniformly including to `/login`) and a nested `(console)/layout.tsx`
  (session-cookie gate + chrome), rather than one file doing both — avoids a
  redirect-to-self loop on the login page while keeping URLs exactly as specified.
- **`platform_audit_log_entry.target_tenant_id`**: `ON DELETE SET NULL` (not a hard
  FK block) — an audit trail entry must outlive the tenant it references, and a
  future deprovisioning flow must never be blocked by its own audit history.
- **`requirePlatformApi()` failure stance**: every failure mode (unconfigured, wrong
  token, disallowed IP) returns an identical bare 404 — the plan's own wording only
  strictly requires this for "unconfigured"; applying it uniformly to every failure
  mode is a stricter, still-compliant interpretation (never confirms the surface's
  existence to an unauthorized caller under any circumstance).
- **Actor attribution**: `PLATFORM_OPERATOR_ACTOR_LABEL = "platform-operator"` — the
  shared-token auth model has no per-operator identity to attribute to more
  specifically (see `platform-ops-auth.ts`'s doc comment); a real per-operator
  identity would require the separate operator IdP the plan deliberately defers.
- **Login rate limiting**: reused this app's own existing `apps/web/src/lib/
  rate-limit.ts` (already backing the conversation-export endpoint) rather than
  building a new one — not deferred, genuinely implemented (5 attempts/60s per IP).

## Phase 2 — Status/plan-tier management

**Status: implemented, self-verified (typecheck/lint/lint:boundaries/unit/
integration/isolation all green, migration seed verified byte-for-byte against the
running test DB), awaiting independent QA (2026-08-19).**

### What was built

- **Schema**: `plan_tier_definition` (one row per `plan_tier` enum value —
  `packages/db/src/schema/platform-ops.ts`), migration `0031_plan_tier_definition.sql`
  seeded with today's hardcoded `PLAN_TIER_DEFAULTS` values verbatim (verified via a
  direct query against the migrated test database: Starter 1/50/3/false, Growth
  5/500/15/false, Enterprise 16/5000/null/true — matches
  `packages/modules/tenancy/src/domain/plan-tier-defaults.ts` exactly). No RLS (same
  reasoning as `tenant`/`platform_audit_log_entry` — platform-only, `withPlatform`-only
  table); not append-only, so deliberately absent from `ensure-roles.ts`'s
  UPDATE/DELETE revoke list.
- **Application layer** (`packages/modules/tenancy`, all `withPlatform`, all exported
  from `src/index.ts`): `updateTenantStatus`, `updateTenantPlanTier` (label only —
  never touches `tenant_runtime_quota`), `reseedTenantQuotaFromTier` (a fully separate
  function/action from the plan-tier-label change), `listPlanTierDefinitions`,
  `getPlanTierDefinition`, `updatePlanTierDefinition`, `getEffectivePlanTierDefaults`.
  `provisionTenant()` now calls `getEffectivePlanTierDefaults()` instead of the pure
  `getPlanTierQuotaDefaults()` domain function directly — its existing
  `provision-tenant.int.test.ts`/`tenant-isolation.isolation.test.ts` pass unmodified,
  proving the migration's seed matches the old hardcoded behavior exactly. Every
  mutation writes exactly one `platform_audit_log_entry` row in the same
  `withPlatform` transaction as the mutation (mirrors `provisionTenant()`'s
  established pattern; verified directly in each function's `.int.test.ts`).
- **Contracts** (`packages/contracts/src/tenancy.ts`): `TenantStatusSchema`,
  `UpdateTenantStatusRequestSchema`, `UpdateTenantPlanTierRequestSchema`,
  `UpdatePlanTierDefinitionRequestSchema` — validated server-side on every new route.
- **Routes** (`apps/web/app/api/internal/ops/**`, all gated by the unmodified
  `requirePlatformApi()`): `tenants/[id]/status` (PATCH), `tenants/[id]/plan-tier`
  (PATCH, label only), `tenants/[id]/plan-tier/reseed-quota` (POST — deliberately a
  separate path + a separate HTTP verb from the label-change route, so the quota
  overwrite cannot be triggered by that endpoint by accident), `plan-tiers` (GET),
  `plan-tiers/[tier]` (PATCH). Every route claims every unimplemented verb with
  `apiMethodNotFoundHandler`, same Phase 1 precedent.
- **Screens**: Tenant Detail gained status-change/plan-tier-change/re-seed-quota
  actions, each behind its own `AlertDialog` confirm step (copy states the concrete
  consequence, including the re-seed dialog's explicit "will overwrite" wording); new
  Plan Tiers screen (`.../plan-tiers`) lists the three tiers with editable quota
  fields + a `features` textarea, copy stating `features` is descriptive/
  forward-looking only. `OpsShell`'s nav gained a "Plan Tiers" link.

### Verification

- `pnpm turbo run typecheck`: 31/31 packages green.
- `pnpm lint` (whole repo) and `pnpm lint:boundaries` (dependency-cruiser, 2157
  modules/7947 dependencies): both clean.
- `pnpm test:unit`: 1094/1095 passing (one pre-existing flaky timeout in
  `apps/web/app/api/internal/ops/tenants/route.test.ts` under parallel load — passes
  standalone; unrelated to this phase's changes, not touched).
- `pnpm test:integration` (real Postgres, `compose.test.yml`): 72/72 test files
  green, including `provision-tenant.int.test.ts` and the new
  `update-tenant-status.int.test.ts`/`update-tenant-plan-tier.int.test.ts`/
  `reseed-tenant-quota.int.test.ts`/`plan-tier-definitions.int.test.ts`. The
  plan-tier relabel test explicitly asserts the quota row is byte-identical before and
  after relabeling Starter -> Enterprise (the plan's hard requirement).
- `pnpm test:isolation`: 76/76 green, including `tenant-isolation.isolation.test.ts`
  unmodified (confirms provisioning's switch to `getEffectivePlanTierDefaults()`
  didn't change RLS behavior).
- Coverage on touched files: tenancy application layer 96%stmts/82%branch combined
  (unit+integration); new/changed route files 87-100%; `TenantDetailScreen.tsx` 96%;
  `PlanTiersScreen.tsx` 90% — all above the 80% floor.
- Migration seed verified directly against the migrated test database (see above) —
  byte-for-byte match to the hardcoded `PLAN_TIER_DEFAULTS`.
- Security self-review: every new route re-uses `requirePlatformApi()` unmodified (no
  guard logic duplicated or forked); every mutation input validated server-side via a
  `contracts` TypeBox schema; the re-seed action requires both a distinct path and a
  distinct HTTP verb from the label-change route, so it cannot fire from that
  endpoint by accident; every confirm dialog is a real client-side gate (own test
  asserts no `fetch` occurs before the dialog's confirm button is clicked); audit rows
  share the mutation's transaction (`withPlatform`'s `BEGIN`/`COMMIT`/`ROLLBACK`), so a
  rolled-back mutation can never leave an orphan audit entry — same guarantee
  Phase 1's `provisionTenant()` already relies on.
- Real-browser walkthrough and independent adversarial QA: **not run by this
  dispatch** — per Nexus policy this hands off to an independent `nexus-qa` pass
  before being marked done.

### Deviations from the dispatch's scope note

None. The re-seed action was built as its own nested route
(`tenants/[id]/plan-tier/reseed-quota`, `POST`) rather than a query-param/body-flag on
the label-change route — the dispatch explicitly left that choice to this phase
("your call"), and a separate path+verb is the strongest form of "cannot be triggered
by the plain tier-label-change endpoint by accident."

## Phase 3 — Cross-tenant health rollup

**Status: implemented, self-verified against a real running dev server/database,
awaiting independent QA (2026-08-19).**

### What was built

- **`apps/web/app/api/internal/ops/health-rollup/route.ts`** (GET, gated by the
  unmodified `requirePlatformApi()`) — the composition-root join the plan specified:
  `listAllTenants()` (`@nextbot/tenancy`) enumerates every tenant, and for each one
  this route constructs a `TenantContext` itself (`{ tenantId, region, environment:
  "Sandbox" }`, mirroring `@nextbot/tenancy`'s own `listActiveTenantContexts()`
  convention) and calls `listConnectors()` / `getConnectorHealthSummary()`
  (`@nextbot/connectors`) completely unmodified — exactly the pattern
  `app/api/v1/admin/mcp-health/route.ts` already established for one tenant, just
  looped across every tenant at this layer. **No `.dependency-cruiser.cjs` edit was
  needed, confirmed by running `dependency-cruiser` directly** (0 violations, 1507
  modules/4248 dependencies) — this route already sits inside
  `no-platform-outside-allowed-callers`'s second permitted caller
  (`apps/web/app/api/internal/ops`) and importing `@nextbot/connectors` from
  `apps/web` is not a new edge (the per-tenant `mcp-health` route already does it).
  `tenancy` itself gained no new import of `connectors`/`mcp-client` — the join
  happens only at this route.
- **Response shape** (metadata only, NFR-11): `tenantId`/`tenantName`/`tenantSlug`,
  `connectorId`/`connectorName`, `status` (`Connected`/`Degraded`/`Offline`, the
  health-check subsystem's own computed value — never recomputed here),
  `lastCheckedAt`/`lastCheckOk` (from the most recent entry in
  `getConnectorHealthSummary()`'s bounded sparkline), `errorRatePct`, a bounded
  `recentErrorCount` (failures within that same sparkline sample), and `callVolume`.
  Every field traces to `connector` (config/status) or `connector_health_check`
  (id/ok/latencyMs/checkedAt) — neither table, nor anything this route selects, can
  hold conversation/message content or a raw tool-call payload; `conversation`,
  `message` and `tool_call` are never imported or queried here. The per-tool table
  (`@nextbot/approvals`'s `getToolHealthSummaries`, which the per-tenant `mcp-health`
  route does join) is deliberately **not** joined — this screen's scope is
  connector-level incident response, not the full per-tool management view that
  already exists per-tenant.
- **Screen**: new `.../health` route under the console's real (secret-segment)
  prefix — `app/internal/ops/nb-c-4f21c8a7e3d9b605/(console)/health/{page.tsx,
  HealthRollupScreen.tsx}` — reached at the public `/internal/ops/health` URL via the
  existing middleware rewrite, same as every other console screen. Lists every
  connector across every tenant, defaulting to "degraded/offline only" (toggle to see
  everything), worst-status-first, with a one-line "N connectors across M tenants need
  attention" summary, a tenant-name link through to that tenant's existing Tenant
  Detail screen, and last-checked/error-rate/recent-errors columns — an
  incident-response view, not a connector management UI (no create/edit/reset actions
  here; those already exist per-tenant at `/(admin)/mcp-health`). `OpsShell`'s nav
  gained a "Health" link. Status badges reuse the shared, contrast-verified
  `CONNECTED_BADGE_CLASS`/`DEGRADED_BADGE_CLASS` constants (`packages/ui/src/lib/
  status-badge.ts`) plus the `destructive` variant for `Offline`, rather than
  re-typing the Tailwind literals `McpHealthDashboard.tsx`/`TenantListScreen.tsx` each
  independently do.

### Verification

- `pnpm turbo run typecheck`: 31/31 packages green.
- `pnpm lint` (repo-wide `eslint . --max-warnings=0`) and `pnpm lint:boundaries`
  (`dependency-cruiser`, 1507 modules/4248 dependencies): both clean — confirms the
  "no new module edge" claim above rather than just asserting it.
- Unit suite: 190 files/1110 tests green (includes the new
  `health-rollup/route.test.ts` — 7 tests, including the unauthorized-passthrough
  case and an explicit "no conversation/message-shaped key anywhere in the response"
  assertion — and the new `HealthRollupScreen.test.tsx`/`health/page.test.tsx`, plus
  `OpsShell.test.tsx` extended to assert the new nav link). Coverage on this phase's
  new/changed files: `health-rollup/route.ts` 100% stmts/branch/funcs/lines;
  `HealthRollupScreen.tsx` 99.04% stmts/99.09% lines/89.74% branch (one uncovered
  branch: the connector-name secondary sort key when two rows share a tenant name,
  well above the 80% floor); `health/page.tsx` 100%.
- Integration suite: 72 files/301 tests green, real Postgres/Redis (`compose.test.yml`
  stack, already running in this environment) — unchanged by this phase, re-run in
  full as the regression check. No new integration test was added for this route,
  matching the existing `mcp-health/route.ts` composition-route precedent (the
  functions it composes — `listAllTenants`, `listConnectors`,
  `getConnectorHealthSummary` — already carry their own integration coverage in
  `@nextbot/tenancy`/`@nextbot/connectors`).
- Isolation suite: 10 files/76 tests green, unchanged.
- **Real-process verification, against the actual running dev Postgres/Redis (not
  just mocks)**: started a real `next dev` process wired to the test-stack DB/Redis
  with `NEXTBOT_OPS_OPERATOR_TOKEN`/`NEXTBOT_OPS_IP_ALLOWLIST`/
  `NEXTBOT_OPS_TRUSTED_PROXY_CIDRS` configured, seeded one real tenant with a real
  connector forced into `Degraded` status plus 3 real failing
  `connector_health_check` rows (`connect ECONNREFUSED`), then:
  - `GET /api/internal/ops/health-rollup` with a valid token returned real `200` JSON
    joining that tenant's degraded connector *and* a pre-existing seeded tenant's
    `Offline` connector — confirmed by inspecting the actual response body (not just
    the route code): every key present is `tenantId`/`tenantName`/`tenantSlug`/
    `connectorId`/`connectorName`/`status`/`lastCheckedAt`/`lastCheckOk`/
    `errorRatePct`/`recentErrorCount`/`callVolume` — no message/content/payload/
    transcript-shaped field anywhere.
  - Wrong token, no credential at all, and a genuinely-nonexistent
    `/api/internal/ops/**` path all returned the byte-identical 9-byte `Not Found`
    (same status, headers, body) — the same indistinguishable-404 guarantee Phase 1
    established, unmodified and unbroken by this new route.
  - `GET /internal/ops/health` with a valid session cookie + an allowed (simulated
    trusted-proxy) caller IP rendered the real page shell server-side (200,
    `<title>NextBot Admin Console</title>`, `x-middleware-rewrite` onto the secret
    internal prefix, the "Health" `<h1>` and the "Platform Manager" shell present, and
    the "Health" nav link's `href="/internal/ops/health"` present) — confirming the
    real console rewrite mechanism serves this new screen correctly.
  - The same page path with no credential returned the app's shared not-found body,
    matching a genuinely-missing `/internal/ops/**` path (only the two paths' embedded
    per-request dev-mode asset-URL timestamps differed — the same pre-existing,
    already-documented `next dev`-only non-determinism recorded in Phase 1's own QA
    history, not a new signal this phase introduced; a production-build comparison
    would eliminate it exactly as it did in Phase 1, but was not re-run for this
    phase's unmodified mechanism).
  - Seeded verification data and the one-off seed script were removed after
    verification; nothing from this pass is retained in the repo or the shared test
    database.
  - **Not performed**: a full client-side (JS-executing) browser walkthrough — no
    Playwright/browser automation tool was available in this session. The SSR shell
    render above, the confirmed-correct API response the client component fetches,
    and `HealthRollupScreen.test.tsx`'s DOM-level tests (default attention-only
    filter, worst-status-first ordering, tenant-name link, "Never checked" empty
    state, all-clear state, forbidden/error state) together cover the same behavior a
    browser walkthrough would exercise, but this is flagged rather than silently
    presented as equivalent — a genuine real-browser pass is left to `nexus-qa`.
- Security self-review: the route reuses `requirePlatformApi()` unmodified (no guard
  logic forked); every field returned is metadata (config/computed-status/probe-result
  columns), never conversation/message/tool-call-payload data — verified both by
  code-path accounting (which tables are queried) and by inspecting a real response
  from a real seeded degraded connector; the route is read-only (no mutation, no new
  schema); every unimplemented HTTP verb is claimed via `apiMethodNotFoundHandler`
  (Phase 1's route-existence-leak fix), verified live to still 404 identically.

### Deviations from the dispatch's scope note

None architecturally. Two small, local (§3-class) implementation choices made without
escalating: (1) `lastCheckedAt`/`lastCheckOk`/`recentErrorCount` are derived from
`getConnectorHealthSummary()`'s existing bounded sparkline rather than adding a new
`@nextbot/connectors` export for "the single latest health-check row" — the plan's
"reusing functions unmodified" instruction reads more naturally as "don't touch the
package" than "add a new function to it," and the sparkline already carries everything
this screen needs; (2) the Health screen defaults to an "attention only" filter
(toggle-able) rather than always listing every connector — the plan's own framing
("a live incident-response view... not a full connector management UI") reads as
wanting the degraded/failing set foregrounded by default.
