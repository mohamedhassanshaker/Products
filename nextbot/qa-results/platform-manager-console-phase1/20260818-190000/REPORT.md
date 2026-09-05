# QA Report - Platform Manager Console, Phase 1 (NFR-11 Foundation)

**Scope**: Phase 1 foundation dispatch - requirePlatformApi() fail-closed auth guard,
IPv4 CIDR allowlist, login page/cookie, minimal OpsShell, listAllTenants()/
getTenantOperatorSummary(), Tenant List/Detail (read-only), Provisioning form,
platform_audit_log_entry table + append-only hardening + provisionTenant() audit
wiring. Verified per the approved plan
(C:\Users\m.hassan\.claude\plans\instead-of-chackraui-modify-frolicking-haven.md) and
docs/plans/platform-manager-console-plan.md.

**Environment**: Real dev Postgres/Redis (compose.test.yml containers, already running;
reached directly via pg/ioredis clients and a real next dev process on port 3050
since the docker CLI itself was unresponsive all session - see Environment Notes).
Real next dev process, real browser (Playwright/Chromium, headless), real curl. Test
tenants provisioned and cleaned up afterward (qa-tenant-alpha, qa-tenant-bravo, plus
their audit rows).

## Environment notes (non-product issue, disclosed for reproducibility)

- The docker CLI hung indefinitely (docker ps/version never returned within 180s)
  all session despite Docker Desktop's backend processes running and its container
  ports being reachable. Verified DB/Redis were live by connecting directly with
  pg/ioredis clients instead of via docker exec/docker ps. This did not block any
  test in this report but means container inventory was not independently confirmed
  via docker itself.
- Ports 3000/3010 were occupied by an unrelated, pre-existing process (a different
  product's leftover container, confirmed by its response body). Used port 3050 for
  the real next dev instance instead.

## Independently-reproduced automated suite results (matches dev's claim)

| Suite | Dev claim | Independently reproduced |
|---|---|---|
| Unit | 982 | 982 passed, 173 files, 46.3s |
| Integration | 290 | 290 passed, 68 files, 31.7s (includes platform-audit-log-append-only.int.test.ts, provision-tenant-audit.int.test.ts, tenant-operator-summary.int.test.ts, list-all-tenants.int.test.ts) |
| Isolation | 76 | 76 passed, 10 files, includes platform_audit_log_entry correctly excluded from TENANT_SCOPED_TABLES |
| pnpm lint + lint:boundaries | clean | Clean - 0 dependency-cruiser violations, 1426 modules/3925 dependencies cruised |
| pnpm typecheck (31 packages) | all green | FAILED - nextbot-web#typecheck fails with 2 real TS2556 errors (see Defect 5) |

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| Fail-closed: unconfigured -> 404 on every /internal/ops/** and /api/internal/ops/** route | Unset both env vars, hit page + API routes | PASS (headers/body match Next's genuine 404 for page routes in dev mode, modulo dev-only diagnostics - see Defect 4 note) | curl transcripts, dev server log |
| Fail-closed: correct token + disallowed IP -> never 200, indistinguishable | Real loopback (unmatched by IPv4-only allowlist) + correct Authorization header | PASS for "never 200" | curl transcript (404, 0 bytes) |
| Fail-closed: allowed IP + wrong/missing token -> never 200, indistinguishable | Spoofed X-Forwarded-For in allowlist + wrong/no token | PASS for "never 200" | curl transcript |
| Correct token + allowed IP -> real data | Spoofed allowed IP + correct token | PASS | Real tenant JSON returned |
| API guard 404 indistinguishable from a genuinely nonexistent route | Compared byte-for-byte against a true 404 under /api/** | FAIL - Defect 1 (Critical) | See below |
| IP allowlist as an independent factor | Spoofed X-Forwarded-For bypass attempt | FAIL - Defect 2 (Critical) | See below |
| Rate limiting on the auth mechanism as a whole | Brute-forced Authorization header directly against the API guard | FAIL - Defect 3 (High) | See below |
| Timing side-channel resistance | In-process microbenchmark, 200k iterations/candidate, varying mismatch position and length | PASS | ~1.8-2.2us/op, no measurable correlation with mismatch position or length |
| CIDR matcher: /32, /24, boundary, malformed entry, IPv6 | Code review + existing unit tests (platform-ops-auth.test.ts) | PASS | All cases covered and correct; IPv6 input fails closed (unparseable -> rejected), not open |
| Cookie: httpOnly, Secure (dev), SameSite=Strict | Real Playwright/Chromium session via CDP cookie inspection | PASS | httpOnly:true, sameSite:"Strict", secure:false (dev - code sets secure: NODE_ENV==="production"), path:"/internal/ops" |
| Cookie path scope must cover the console's own API calls | Real browser login -> Tenant List screen's client-side fetch | FAIL - Defect 6 (Critical/blocking) | See below |
| Login rate limiting (5/60s) | 7 consecutive wrong-token submissions via real browser | PASS functionally, but see Defect 7 (real status code) | Attempts 1-4: "Invalid operator token."; attempts 5-7: "Too many attempts." |
| DB append-only: platform_audit_log_entry UPDATE/DELETE denied for both roles | Live pg client connected as both app and platform test roles | PASS | "permission denied for table platform_audit_log_entry" on both UPDATE and DELETE, both roles |
| Cross-tenant tenant list/detail correctness | Provisioned 2 real tenants (Starter/UAE, Enterprise/EU) via the real API | PASS | Both appear correctly in listAllTenants(), quota gauges accurate, Enterprise correctly gets isDedicatedDatabase:true and its quota defaults |
| Audit trail: exactly one row per provisioning action, correct actorLabel/targetTenantId/details | Same 2 provisioning calls | PASS | 2 rows, actor_label:"platform-operator", correct target_tenant_id/details; duplicate-slug attempt wrote 0 audit rows |
| Duplicate/invalid slug -> clean error, not 500 | POST with a slug that already exists | PASS | 409 TENANT_ALREADY_EXISTS, no raw 500, no stray audit/tenant row |
| NFR-11 "metadata only" boundary | Inspected getTenantOperatorSummary() response for the Enterprise tenant | PASS | Only status/region/plan-tier/quota-caps/retention-day-counts; no conversation/message content anywhere |
| Typecheck (all 31 packages green) | pnpm typecheck | FAIL - Defect 5 (Medium, non-blocking to runtime, blocking to CI gate) | See below |

## Defects (ordered by severity)

### Defect 1 - Critical. API guard's "bare 404" is trivially distinguishable from a genuinely nonexistent route
Expected (plan, platform-api-guard.ts's own doc comment): "a bare 404 with no
body - deliberately indistinguishable from 'this route genuinely doesn't exist'... an
unconfigured deployment, a wrong token, and a disallowed IP must all be equally
unconfirmable-as-existing from the outside."

Actual: requirePlatformApi()'s notFound() returns new NextResponse(null, { status:
404 }) - headers: only Vary, no Content-Type, no Cache-Control, no X-Powered-By,
0-byte body. A genuinely nonexistent path under the same /api/** tree (verified both a
typo under /api/internal/ops/* and an unrelated /api/v1/* path) returns Next's real
not-found page render: Content-Type: text/html, Cache-Control: no-store,
must-revalidate, X-Powered-By: Next.js, ~15KB HTML body. An external prober can
trivially fingerprint "this exact path is a real, gated route" vs. "this is a random
typo" from response size/headers alone - defeating the entire stated purpose of the
bare-404 design.

Repro:
  curl -s -D - -o body1.txt http://localhost:3050/api/internal/ops/tenants        (0 bytes, no Content-Type)
  curl -s -D - -o body2.txt http://localhost:3050/api/internal/ops/typo-xyz-999   (15247 bytes, text/html)
  curl -s -D - -o body3.txt http://localhost:3050/api/v1/this-truly-does-not-exist-anywhere  (same 15KB HTML shape)

Phase: Phase 1 (platform-api-guard.ts).

### Defect 2 - Critical. IP allowlist is trivially bypassed by a client-supplied X-Forwarded-For header
Expected: "Two independent checks, both required" (token + IP allowlist) - the plan
frames the IP allowlist as defense-in-depth independent of the token.

Actual: extractClientIp()/isRequestFromAllowedNetwork() read x-forwarded-for
directly from the incoming request with no validation that it originated from a
trusted reverse proxy (no allowlisted-proxy check, no header-stripping at any boundary
in this code). Any external caller can simply set X-Forwarded-For: <ip-in-the-
allowlist> themselves and the "IP check" passes unconditionally, regardless of their
real source IP. Confirmed live: with the allowlist configured to
203.0.113.0/24,198.51.100.7 (real loopback intentionally excluded), a request from
real loopback with correct token was denied (404) as expected - but the same
request with X-Forwarded-For: 198.51.100.7 added returned 200 with real cross-tenant
tenant data. This reduces the "two independent checks" model to exactly one real
check (the token) for any attacker who can reach the app over the network at all.

Repro:
  curl -H "Authorization: Bearer <correct>" http://.../api/internal/ops/tenants
    -> 404 (real IP not allowlisted)
  curl -H "Authorization: Bearer <correct>" -H "X-Forwarded-For: 198.51.100.7" http://.../api/internal/ops/tenants
    -> 200, real tenant data

This mirrors apps/web/src/lib/client-ip.ts's identical, undocumented trust
assumption - acceptable there (only used as a rate-limit bucketing key, so spoofing
only self-harms the attacker), but reused here as a genuine security gate on a
cross-tenant admin surface without re-evaluating that the stakes are entirely
different.

Phase: Phase 1 (platform-ops-auth.ts's extractClientIp/isRequestFromAllowedNetwork).

### Defect 3 - High. No rate limiting at all on the Authorization header path
Expected: the plan's intent is that the operator token cannot be brute-forced.

Actual: the 5-attempts/60s rate limit (rate-limit.ts via checkRateLimit) is wired
only into the browser login Server Action (opsLoginAction). requirePlatformApi()
itself - the guard every /api/internal/ops/** route uses, reachable directly via
Authorization: Bearer <guess> - has zero rate limiting. Confirmed live: 20
consecutive wrong-token guesses directly against /api/internal/ops/tenants all
returned instantly with no throttling, no lockout, no increasing latency. Combined
with Defect 2 (IP check bypassable), an attacker can brute-force the operator token
at network-bound speed from anywhere.

Repro: 20x curl -H "Authorization: Bearer guess-$i" -H "X-Forwarded-For:
<allowed>" .../api/internal/ops/tenants - all 404, no throttling observed.

Phase: Phase 1 (platform-api-guard.ts - never calls checkRateLimit).

### Defect 4 - Low/Informational. Dev-mode page-route 404s leak route/component names (framework artifact, not confirmed in production)
In next dev (not next start), the streamed RSC payload for /internal/ops/** page
routes embeds component names/file paths (OpsRootLayout, OpsConsoleLayout,
TenantListScreen, internal/ops/(console)/tenants/page.tsx, the redirect target
/internal/ops/login) even on a 404 - this differs from a truly nonexistent page
route's dev-mode body (which only shows a generic NotFound/HTTPAccessErrorFallback
component). This is standard Next.js dev-server diagnostic behavior for any error
boundary, not something this feature's code controls, and does not appear in a
production build (next start). Not independently re-verified against a production
build this pass due to time - recommend nexus-deploy/final-review confirm this
explicitly before treating the page-route side of the fail-closed guarantee as fully
proven for the real deployment target.

Phase: N/A (environment/framework, not a code defect) - flagged for awareness only.

### Defect 5 - Medium (CI-blocking, not runtime-blocking). pnpm typecheck fails, contradicting the claimed "all 31 packages green"
Actual: nextbot-web#typecheck fails with two real errors, independently reproduced:

  app/internal/ops/(console)/layout.test.tsx(19,47): error TS2556: A spread argument must either have a tuple type or be passed to a rest parameter.
  app/internal/ops/layout.test.tsx(20,47): error TS2556: A spread argument must either have a tuple type or be passed to a rest parameter.

Both are in the vi.mock("next/navigation", () => ({ redirect/notFound: (...a:
unknown[]) => xMock(...a) })) mock wrappers - spreading a unknown[]-typed rest
parameter into the mocked function call. Test-only code (does not affect runtime
behavior of the shipped guard/layouts), but this is exactly the gate the plan's own
"Exit gate" section requires green, and it is not.

Repro: pnpm typecheck (or cd apps/web && pnpm typecheck) from a clean shell.

Phase: Phase 1 (app/internal/ops/layout.test.tsx, app/internal/ops/(console)/layout.test.tsx).

### Defect 6 - Critical/Blocking. The session cookie's Path=/internal/ops never reaches /api/internal/ops/** - the console's own screens are non-functional for a real, cookie-authenticated browser operator
Expected: the cookie is "checked as an alternative to the Authorization header" for
the browser flow, and the Tenant List/Detail screens are Phase 1 deliverables.

Actual: the login cookie is set with path: "/internal/ops". Per RFC 6265 cookie
path-matching, a cookie scoped to /internal/ops is only sent on requests whose URL
path starts with the literal string /internal/ops - it is never sent to
/api/internal/ops/** (a sibling path tree, not a descendant: they diverge at the very
first segment, "internal" vs "api"). Confirmed with a real headless-Chromium session
(Playwright): logged in successfully via the real UI (cookie correctly set - httpOnly,
SameSite=Strict, correct value), was correctly redirected to /internal/ops/tenants,
but the Tenant List screen's own client-side fetch("/api/internal/ops/tenants") call -
captured directly - sent no Cookie header at all (cookie: "(none)"), so
requirePlatformApi() sees neither a valid bearer token nor a valid cookie and returns
its bare 404, which the UI renders as "Something went wrong. Please try again." This
means the entire Phase 1 read-only console (Tenant List, and by the same mechanism
Tenant Detail and the Provisioning form's own list-refresh) is broken for any operator
who authenticates the way the product actually offers them to (the token-entry login
form) - it only "works" when called directly with an Authorization header (i.e., by
curl/API tooling), which is not how the built UI calls its own backend.

This appears to have gone undetected because: (a) the unit test for the login action
only asserts the cookie's path value equals the literal string "/internal/ops", never
that this path scope actually covers the API tree the UI calls; and (b) no
integration/e2e test drives the real Tenant List/Detail screens through a real cookie
session against the real API routes - the existing route.test.ts files for
/api/internal/ops/tenants[/[id]] test the guard via a directly-injected
Authorization-equivalent bypass, never a real browser cookie flow.

Repro (real Chromium, x-forwarded-for injected via context.route to satisfy the IP
check - same effect as a real allowed-network caller):
1. page.goto("/internal/ops/login"), fill correct token, submit -> cookie set
   correctly (nb_ops_session, httpOnly, Strict, path /internal/ops), redirected to
   /internal/ops/tenants.
2. Observed outgoing request: GET /api/internal/ops/tenants - cookie: "(none)".
3. Response: 404. Rendered UI: "Something went wrong. Please try again."

Fix direction (for nexus-dev, not applied by QA): the cookie's path scope cannot
simultaneously (a) exclude every other route in the app and (b) cover
/api/internal/ops/**, since that tree is not a descendant of /internal/ops. Either
scope the cookie to / (relying on requirePlatformApi()'s own checks - not the
cookie's Path attribute - to provide the actual isolation from the tenant Admin
Console/widget, which is what already protects those surfaces) or restructure the URL
space so the API routes live under /internal/ops/api/** instead of the current
/api/internal/ops/**.

Phase: Phase 1 (app/internal/ops/login/actions.ts cookie path value, in combination
with the /api/internal/ops/** route location choice) - this is a cross-cutting seam
defect between the login/cookie code and the API route placement, both introduced in
this same Phase 1 dispatch.

### Defect 7 - Low/Informational. Login rate limiting never surfaces as an HTTP 429
The 5-attempts/60s login rate limit is functionally real (confirmed live: attempts 1-4
show "Invalid operator token.", attempts 5-7 show "Too many attempts. Please wait a
minute and try again.") but is implemented as a Next.js Server Action, which always
returns HTTP 200 OK regardless of outcome - the "too many attempts" state is
communicated only via the RSC form-state payload, never a real 429 status code. This
does not weaken the actual protection (further guesses are genuinely rejected), but
scripted/automated clients checking status codes rather than rendered text would not
detect the throttling from the HTTP layer alone.

Phase: Phase 1 (app/internal/ops/login/actions.ts - inherent to the Server Action
mechanism chosen, not fixable without moving the login submission to a real route
handler).

## Items verified clean (no defect)

- Timing side-channel: constant-time comparison via SHA-256 digest +
  crypto.timingSafeEqual is correctly implemented; in-process microbenchmark shows no
  measurable timing correlation with mismatch position or candidate length.
- CIDR matcher: /32, /24, /0, boundary IPs, malformed entries (skipped individually,
  not fail-open), and unparseable/IPv6 input (fails closed) all correct per code
  review + existing unit coverage.
- DB append-only guarantee for platform_audit_log_entry: independently proven live
  against both the app and platform test-DB roles (UPDATE/DELETE both denied,
  SELECT/INSERT both allowed) via a direct pg client, not just re-reading the
  migration or the integration test.
- Cross-tenant correctness: two real tenants (different plan tier/region) list and
  detail correctly, quota gauges accurate, exactly one audit row per provisioning
  action with correct actorLabel/targetTenantId/details.
- Duplicate slug: clean 409 TENANT_ALREADY_EXISTS, never a raw 500, and correctly
  writes zero audit/tenant rows on the rejected attempt.
- NFR-11 metadata-only boundary: getTenantOperatorSummary() exposes only
  status/region/plan-tier/quota-caps/retention-day-counts - no conversation or
  message content anywhere in the payload or its underlying queries.
- Cookie flags (independent of Defect 6's path-scope defect): httpOnly: true,
  SameSite: Strict, Secure correctly conditioned on NODE_ENV === "production" - all
  confirmed via real browser CDP cookie inspection, not just source reading.

## Verdict

NOT READY. Two Critical defects (Defect 1: fail-closed 404 is not actually
indistinguishable from a nonexistent route for API calls; Defect 2: the IP allowlist -
one of the two stated independent auth factors - is trivially bypassed by a
client-supplied header) plus one Critical/blocking functional defect (Defect 6: the
console's own screens are broken for real, cookie-authenticated browser use) mean this
surface does not meet its own stated security bar and does not deliver a working
read-only console through the UI as built. Defect 3 (no rate limiting on the API guard
itself) compounds Defect 2 into a fully brute-forceable token check from the open
network. pnpm typecheck also fails (Defect 5), contradicting the claimed green gate.
Route to nexus-dev for a retry addressing Defects 1, 2, 3, 5, and 6 at minimum before
re-dispatching to QA.
