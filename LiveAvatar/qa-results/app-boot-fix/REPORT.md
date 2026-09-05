# QA Report -- Cross-cutting urgent fix: real app-boot defect (F-1) + follow-on findings

**Verdict: PASS-WITH-CAVEATS**

This is an independent re-verification pass, not tied to a single backlog phase.
Scope: the dev's claimed fix for F-1 (apps/api could never actually boot via
NestFactory.create), the second instance of the same defect class in
InternalAppModule, the newly-flagged ProvidersModule-controllers-leak-onto-
internal-app architectural finding, Phase 1's long-deferred
tenant-isolation.e2e-spec.ts, and full regression (backend jest, frontend
jest, Python pytest).

## Environment

- Docker reachable (Docker Desktop 4.86.0 / Engine 29.7.2). Host ports
  5432/6379 already occupied by unrelated local projects (nextbot-*), same as
  the prior QA pass -- used disposable containers on alternate ports instead:
  liveavatar-pg-qa2 (Postgres 16-alpine, host port 15432),
  liveavatar-redis-qa2 (Redis 7-alpine, host port 16379),
  liveavatar-lk-qa2 (livekit/livekit-server:latest --dev, host ports
  17880/17881).
- apps/api/.env (gitignored, left in place by the prior dev session) already
  pointed at these exact ports (15432/16379/18090/18091/17880) -- reused as-is,
  not modified.
- Backend built for real: npx prisma generate, npx prisma db push (confirmed
  live that --skip-generate is genuinely rejected by Prisma 7's CLI -- matches
  the dev's claim), npx tsx prisma/seed.ts (seeded 10 provider-definition
  rows), npx tsc -p tsconfig.build.json (clean build, zero errors).
- Ran both node dist/main.js (port 18090) and node dist/main-internal.js
  (port 18091) directly against the live containers -- env vars supplied via
  the shell (confirmed apps/api has no dotenv bootstrap of its own; loadEnv()
  only reads process.env directly, so the process's real env must already
  carry these values -- a fact worth knowing operationally, not a defect in
  scope here).
- Frontend/Python: existing installs (apps/web's node_modules,
  apps/agent/.venv) reused in place.
- All QA-created Docker containers and DB rows removed at the end of this
  pass; both node processes killed; no repo file was modified.

## 1. Real app boot -- independently reproduced

Both processes booted clean, in this exact order confirming the fix:

Public app (main.js, :18090) -- log line 2 is "PrismaModule dependencies
initialized", immediately after NestFactory's "Starting Nest application...",
with zero UnknownDependenciesException/DI errors anywhere in the boot
sequence. All 12+ feature modules (AuthModule, AdminUsersModule,
TenantsModule, ProvidersModule, DeploymentConfigModule, SessionsModule,
etc.) initialized successfully. GET /api/health -> live 200 {"status":"ok"}.

Internal app (main-internal.js, :18091) -- a genuinely separate
NestFactory.create(InternalAppModule) call/DI container. Log confirms
"InternalAppModule dependencies initialized" -> "PrismaModule dependencies
initialized" -> "RedisModule dependencies initialized" -> ... ->
"ProvidersModule dependencies initialized", all clean. This directly confirms
the second fix: RedisModule (needed transitively by
SessionsModule -> ProvidersModule's RedisProbeRateLimiter) is now imported
into InternalAppModule and resolves. Hitting the real LiveKit-webhook route
(POST /internal/livekit/webhooks) with no signature correctly 204s after
logging a webhook-signature-verification failure (expected -- proves the route
and its DI graph are alive, not that webhook auth is being tested here).

Verdict on the core claimed fix: genuinely true. The app could not boot
before this fix (per the prior QA report, reproduced then); it boots cleanly
now, on both listeners, independently re-verified from a cold container set.

## 2. Real endpoint exercise against the live public app

| Request | Result | Evidence |
|---|---|---|
| GET /api/provider-definitions unauthenticated | 401 AUTH_UNAUTHORIZED | curl transcript |
| POST /api/auth/seed unauthenticated (no x-bootstrap-secret header) | 401 AUTH_UNAUTHORIZED | curl transcript |
| POST /api/auth/seed with correct x-bootstrap-secret header | 201, real operator row created | curl transcript + direct psql read of admin_user confirming qa-appboot@example.com/{operator} |
| POST /api/auth/login | 200, real JWT (300-char access token, refresh token, 8h expiry) issued | curl transcript |
| GET /api/provider-definitions with bearer token | 200, real 10-row seeded catalog (livekit, deepgram, faster-whisper, anthropic, google, ... incl. alibaba-liveavatar from Phase 6) | curl transcript |
| POST /api/tenants | 201, real tenant row created | curl transcript + direct psql read of tenant table confirming the row (cee4bccf-..., qa-appboot-tenant, active) |
| GET /api/tenants | 200, lists the just-created tenant | curl transcript |

All writes independently confirmed correct by reading straight from Postgres
via docker exec ... psql, not merely trusting the HTTP 200/201 -- the actual
bar this pass was asked to hold to.

## 3. Phase 1 tenant-isolation.e2e-spec.ts (FR-TENANT-5) -- genuinely re-run

Read the spec itself first: it is not a trivially-true test. It bootstraps a
real operator via /api/auth/seed, confirms a second seed attempt is
correctly rejected 409 AUTH_ALREADY_SEEDED (proving the atomic
create-first-operator guard), creates two tenants, invites+accepts an admin
scoped only to tenant A, confirms the admin can read tenant A (200),
confirms reading tenant B (unassigned) is 404 TENANT_NOT_FOUND -- never
403, which would leak that the id exists -- confirms a wholly unknown id
returns byte-for-byte the same error envelope as the real-but-unassigned
tenant (no side channel), confirms a cross-tenant PATCH is also rejected
(403/404, both acceptable per spec), and -- critically -- confirms the
rejected write did not mutate the target row by re-reading it as the
operator afterward. This is a meaningful, non-trivial assertion set.

Ran it myself against a fresh @testcontainers/postgresql container (not the
disposable containers above -- the suite spins up its own):

- First attempt failed with "LIVEKIT_URL is required" -- my shell session
  hadn't inherited that env var into the new bash invocation. This is not
  a defect in the suite or the fix; LiveKitClientAdapter's constructor
  requires it and the suite (correctly, by design) doesn't stub/mock it out,
  it drives the real AppModule. Re-ran with LIVEKIT_URL/LIVEKIT_API_KEY/
  LIVEKIT_API_SECRET/AGENT_NAME/INTERNAL_TOKEN exported.
- Second attempt: 1 passed, 1 total, ~17s, against a genuinely fresh
  testcontainers Postgres, prisma db push executed live (also independently
  confirmed --skip-generate is rejected by the installed Prisma 7 CLI,
  matching the dev's claimed test-harness fix), every assertion in the spec
  (409/200/404/403/byte-identical-envelope/post-rejection-integrity) passed
  against real HTTP responses logged in full (pino request/response lines
  captured, all status codes match expectations exactly: 201, 409, 200, 201,
  201, 201, 201, 200, 200, 404, 404, 403, 200).

This requirement is genuinely proven now -- the first real execution of
this suite in the project's history, independently reproduced.

(Housekeeping note, not a finding: an earlier attempt at this same run, made
before I exported the LiveKit env vars, took several minutes longer than
expected for its testcontainers Postgres to become visible in docker ps and
never completed within this session -- almost certainly a slow/cold
first-container-of-the-session effect on this Docker Desktop/WSL2 host
compounded by ts-jest's cold compile, not a defect; it was left running
harmlessly in the background and was not needed once the second, successful
run above completed.)

## 4. ProvidersModule admin controllers mounted on the internal app -- investigated thoroughly

Confirmed via code + live reproduction that SessionsModule (imported by
InternalModule) imports ProvidersModule, and NestJS mounts every controller
of an imported module onto the hosting application regardless of import
depth -- so ProviderDefinitionsController and ProviderCredentialsController
(both admin-only, @UseGuards(AdminJwtGuard, RolesGuard)) really do get routed
on :18091 (the internal listener).

Reproduced live, several variants:

| Request | Result |
|---|---|
| GET /provider-definitions (internal port, unauthenticated) | 500 INTERNAL_ERROR (generic envelope, only a request_id, no stack trace, no data) |
| GET /provider-definitions (internal port, valid admin bearer token minted moments earlier from the real public-app login) | 500 INTERNAL_ERROR, identical body shape |
| PATCH /provider-definitions/deepgram {"enabled":false} (internal port, no auth) | 500 INTERNAL_ERROR -- and confirmed via the real public app afterward that deepgram's enabled flag is still true -- the write never reached the use case |
| POST /tenants/:id/provider-credentials {} (internal port, no auth) | 500 INTERNAL_ERROR |

Server-side log (not client-visible) shows the exact failure for every case:
Error: Unknown authentication strategy "admin-jwt", thrown synchronously
inside Passport's own attempt()/authenticate() -- i.e. inside
AdminJwtGuard.canActivate() itself, before the guard's handleRequest
callback, before RolesGuard, and before the controller method is ever
invoked. This happens because AdminJwtStrategy (which registers the named
'admin-jwt' Passport strategy as a side effect of its own instantiation) is
only ever constructed as part of AuthModule, which InternalAppModule
deliberately never imports -- and Passport's strategy registry is a
process-global singleton, so a second, wholly separate Node process
(main-internal.js) that never loads AuthModule genuinely never registers
that strategy name, for any request, under any circumstances.

This determines the three questions the dispatch asked:

1. What does the 500 expose? Nothing beyond a generic INTERNAL_ERROR
   envelope with a request_id -- no stack trace, no partial data, confirmed
   across all four request variants above (read, write-with-flag-flip,
   write-with-body, with and without a real valid token).
2. Does any tenant/provider data leak in any variant? No -- confirmed the
   deepgram row's enabled state was unchanged after the rejected internal
   PATCH, i.e. the use case layer was never reached, not even partially.
3. Does the guard even run / is there any path to a 200 with real data? Yes,
   the guard runs (AdminJwtGuard.canActivate() is on the call stack in every
   stack trace captured) and it is where the failure originates -- the guard
   fails synchronously and unconditionally for every request to these two
   controllers on this process, including with a token that is perfectly
   valid against the public app. There is no code path in the current wiring
   where this could ever return 200 with real data on the internal app:
   AuthModule is never imported into InternalAppModule's module graph in any
   request path, so 'admin-jwt' can never become a registered strategy in
   that process regardless of headers/tokens/route variant tried.

Conclusion: this is a genuine, safe (fail-closed) architectural gap, not a
security defect. The dev's characterization is accurate. It should still be
fixed (split ProvidersModule into a controller-free core + a
public-app-only HTTP module, as recommended in the decision log) because it
contradicts the internal app's own "only what /internal routes need"
documented intent and is one dependency-graph refactor away from becoming
dangerous if a future change ever imports AuthModule into InternalAppModule
for an unrelated reason without re-checking this seam -- but it is not a
blocking finding for this pass, and does not leak data today.

## 5. LiveKit round trip -- re-verified

Independently re-ran a real room lifecycle against the fresh --dev LiveKit
container: createRoom -> real room SID returned -> listRooms shows it ->
minted a real AccessToken/JWT (221 chars) -> deleteRoom -> listRooms
confirms it's gone. All against the live container, not mocked.

## 6. Full regression -- independently re-run

| Suite | Dev's claim | Independently re-run | Match |
|---|---|---|---|
| Backend jest --runInBand (apps/api) | 577/577, 99 suites | 577/577, 99 suites, 138.2s | Exact match |
| Frontend jest --coverage (apps/web) | 296/296, 43 suites | 296/296, 43 suites, 94.66/83.85/94.4/94.79% stmt/branch/func/line, 48.2s | Exact match |
| Python pytest --cov=avatar_agent (apps/agent) | 237/237, 94.39% | 237/237 passed, 94.39% coverage, 95.2s | Exact match |

No new failures introduced by the F-1/InternalAppModule fix in any of the
three suites.

## Traceability matrix

| # | Requirement/claim | Scenario tested | Result | Evidence |
|---|---|---|---|---|
| 1 | Public app boots via real NestFactory.create(AppModule) | Live boot against real Postgres/Redis, health check | PASS | Section 1, boot log |
| 2 | Internal app boots via real NestFactory.create(InternalAppModule), second Prisma+Redis DI fix | Live boot, webhook route reachable | PASS | Section 1, boot log |
| 3 | Real endpoints function correctly against live Postgres (seed/login/tenant CRUD/catalog/401) | Live curl exercise + direct psql read-back | PASS | Section 2 |
| 4 | Phase 1 FR-TENANT-5 e2e suite genuinely passes against live testcontainers Postgres, asserts something meaningful | Read spec, ran it twice (once revealing an env-setup gap, once green) | PASS | Section 3 |
| 5 | ProvidersModule internal-app finding is safe, not a security defect | Reproduced 500 with/without valid token, on read and write routes, confirmed no data mutation/leak, traced exact failure point in the guard | PASS (confirmed non-blocking) | Section 4 |
| 6 | LiveKit round trip against real --dev server | create/list/token/delete | PASS | Section 5 |
| 7 | Full regression unaffected | backend/frontend/python suites re-run independently | PASS | Section 6 |

## Non-blocking findings carried forward (not gating this verdict)

- F-2 (architectural, flagged by dev, confirmed safe by this pass):
  ProvidersModule's admin HTTP controllers are reachable (but fail closed,
  500, no data) on the internal :8081 listener via
  InternalModule -> SessionsModule -> ProvidersModule. Recommend splitting
  ProvidersModule into a controller-free core module plus a public-app-only
  HTTP module, per the dev's own recommendation, as ordinary architectural
  cleanup -- not urgent, not a security fix.
- Operational note (not a defect): apps/api has no dotenv bootstrap of its
  own (loadEnv() reads process.env directly); running the built app outside
  of a process manager/compose file that populates the environment requires
  the operator to export every variable in .env into the shell first. Worth
  a dotenv/config import or documented deployment note, but out of scope for
  this urgent-fix verification.

## Overall verdict

PASS-WITH-CAVEATS. The core claim -- apps/api's public and internal Nest
applications now both genuinely boot against live Postgres/Redis/LiveKit,
where before this fix they could not -- is independently confirmed true from
a cold environment, not from reading code or trusting the dev's decision-log
description. Real endpoints function correctly against a live database with
writes verified by direct SQL read-back. Phase 1's long-deferred
tenant-isolation e2e suite genuinely passes now, for the first time in the
project's history, and asserts something non-trivial. The newly-flagged
ProvidersModule-on-internal-app finding is confirmed to be a real
architectural gap but not a security defect -- it fails closed
unconditionally, exposes no data or stack trace, and no code path in the
current wiring can bypass the guard to reach a real 200. Full regression
(backend/frontend/Python) is unchanged and green, matching the dev's claims
exactly. Recommend the orchestrator close out F-1/the internal-app Prisma+
Redis fix and proceed; F-2 (ProvidersModule/InternalAppModule controller
leak) should be logged as a normal architectural follow-up, not re-dispatched
urgently.
