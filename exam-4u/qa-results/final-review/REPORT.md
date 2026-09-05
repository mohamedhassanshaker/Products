# ExamLand — Final Review QA Report (full-system, pre-deployment)

- **Date**: 2026-08-14 (re-run; supersedes the 2026-08-13 report)
- **Mode**: Final Review / full regression (not scoped to one phase)
- **Verdict**: **NOT READY for `nexus-deploy` — no product defects remain; 2 CI-gate/test-infrastructure blockers (D8, D6/D9)**
- **Prepared by**: `nexus-qa`, independent of the agents that implemented the D1-D4 fixes

## 1. Overall verdict

Every defect from the 2026-08-13 Final Review (D1 blocking, D2/D3 high, D4 low, D5 medium)
is **independently confirmed fixed** — verified live, not taken on the fixing agents' word.
The application itself, the deployment artifacts (Dockerfiles, compose stack, migration
CLI, readiness checks), and the full regression estate are all in excellent shape.

What remains open is entirely in the **test/CI-gate layer**, not the product:

- **D8 (MEDIUM, NEW, gate-blocking)**: a systemic gap — 61 `beforeAll`/`afterAll` hooks
  across ~50 e2e specs have no explicit Jest timeout. This is very likely the true root
  cause of much of this pipeline's historical "flaky e2e / Docker contention" narrative.
  One instance (`tenant-registry-cross-schema.e2e-spec.ts`) currently fails deterministically
  (4/4 runs), disabling 5 real tenant-isolation regression tests; it passes 5/5 with a longer
  timeout, and the underlying product code is correct.
- **D6 (raised to MEDIUM)** and **D9 (LOW/MEDIUM, NEW)**: the mTLS smoke-test *gate command*
  (`docker compose up --abort-on-container-exit --exit-code-from ...`) is unreliable — a
  false-fail in check 6 (missing `curl --max-time`) and a race where `--abort-on-container-exit`
  can trip on `certs-init`'s own intentional exit 0, before the smoke test container even runs.
  The underlying mTLS product behavior is correct in both cases (confirmed by hand-issued
  requests and by `docker compose run --rm mtls-smoke-test`, which is deterministic).

Recommendation: one small `nexus-dev` pass to add explicit hook timeouts (D8) and harden the
mTLS smoke-test script/gate command (D6/D9), then re-run this gate. D10-D13 below are
low-severity/informational and do not need to block deployment.

## 2. Independently confirmed fixed (re-verified live, not re-read from prior claims)

**D1 — platform-schema migration entrypoint: CLOSED.**
Dropped a genuinely fresh schema (`examland_fr2_fresh`, 0 tables confirmed), ran
`npm run migrate:platform` → exit 0, `{"appliedCount": 21}`, 16 tables created including
`migrations`. Booted the real build against it: `POST /api/platform/auth/login` → **200
with a real signed platform JWT** (was 500 in the prior review); wrong password → 401
`INVALID_CREDENTIALS`. `migrationsRun: false` still hard-coded in both
`platform-data-source.ts` and `tenant-data-source-factory.ts` — the CLI is the only shipped
`runMigrations()` caller, no boot-time race introduced. Also confirmed containerized:
`docker compose run --rm api node dist/api/migrate-platform.js` → same 21 migrations.

**D2 — real readiness checks: CLOSED.**
Observed live: healthy-but-no-worker → `503 degraded` with `worker:false, "no worker
heartbeat has ever been recorded"`; stopped the Qdrant container → only `qdrant:{ok:false,
"fetch failed"}` flipped, no 500, `GET /api/health` stayed 200; restarted Qdrant →
`qdrant:true` again (genuine self-heal); started `ROLE=worker` → `200 ok` with "last
heartbeat 4430ms ago". `ai.state:"disabled"` never affects overall `status`. Degraded
correctly returns 503, not 200.

**D3 — compose stack + the WorkerModule crash-loop: CLOSED.**
Verified against an isolated compose project (non-overlapping ports). `docker compose
config` resolves 5/8 services correctly with profiles; real image build passes (bcrypt
compiles on musl); all five services reach healthy/running. **Zero**
`UnknownDependenciesException`/`ErrorResponseWriter` errors in the worker log, single clean
`worker.started`. Additionally confirmed bare-metal (`node apps/api/dist/worker.js`
outside any container) — proves the `TenancyModule → ErrorResponseModule` fix is real, not
a container-specific workaround. SPA served correctly from the same port as the API
(`/`, `/login`, `/platform/login` all 200; unknown `/api/**` path → 404 JSON, no SPA
fallthrough).

**D4 — CLOSED.** Both permission-count assertions read `toBe(30)` with an explanatory
comment; the real seeded count is 30; passes inside the full e2e run; independent grep
found no other stale hardcoded counts.

**D5 — RESOLVED.** `SELECT VERSION()` against the live container returns `8.4.11` — genuine
MySQL 8.4, not the `26.7.0` mismatch flagged previously.

**The `afterAll` hook-timeout fix (from the prior fix pass) — confirmed effective**:
`tenant-migration-runner.e2e-spec.ts` now reads `}, 60_000);` and passed in 36.2s in the
full serial run.

## 3. Regression estate (exact counts, this run)

| Suite | Result |
|---|---|
| Backend unit + coverage | **203/203 suites, 1751/1751 tests**, exit 0. Coverage 96.67% stmt / 81.44% branch / 92.65% func / 97.08% line — 80% gate passes. |
| Frontend unit | **62/62 files, 363/363 tests**, exit 0. |
| Backend e2e (live MySQL 8.4 + Qdrant, `--runInBand`) | **52/53 suites, 389/394 tests**, exit 1. Zero assertion failures, zero connection-level failures — the sole failure is D8's hook-timeout issue. |
| Typecheck / lint / build | Clean (`--max-warnings=0`); one pre-existing bundle-budget warning on build. |
| mTLS smoke (`run --rm mtls-smoke-test`) | 6/6 checks, exit 0. |
| Real-browser pass | Zero 5xx observed; only expected `404 /api/tenant/public-config` on a fresh deployment with no tenant yet provisioned. |
| Cross-cutting security | Qdrant single-import chokepoint intact; RBAC fail-closed guard re-read and confirmed; signed-file delivery uses `timingSafeEqual`; Stripe `constructEvent` on real raw body + packageId re-validation; mTLS `rejectUnauthorized: true` hard-coded and lint-banned from being disabled; engine-side `hmac.compare_digest` + CN pinning; architecture-layering lint rules enforced; no committed secrets found. **All green.** |

## 4. Open issues

### D8 — MEDIUM, NEW, gate-blocking
`apps/api/test/tenant-registry-cross-schema.e2e-spec.ts` fails **deterministically, 4/4
runs**, including 3/3 in complete isolation on an otherwise-idle host against two different
MySQL containers:
```
thrown: "Exceeded timeout of 5000 ms for a hook."
  at tenant-registry-cross-schema.e2e-spec.ts:56   (beforeAll)
```
Its `beforeAll` (line 56) performs `ensureSchemaExists` x2, `registry.acquire()` x2,
`runMigrations()` x2 (~16 tenant migrations each), and two INSERTs, all under Jest's
default 5000ms hook timeout — neither `beforeAll` nor its `afterAll` (line 88, drops two
databases) declares an explicit timeout. With `--testTimeout=60000` and nothing else
changed: **passes 5/5 in 10.0s**. Product code and all five assertions are correct.

This matters more than an isolated flaky test: these five assertions are the cross-schema
**tenant-isolation** proof (including the structural "no `query(schema, sql)` escape hatch"
assertion), and they currently never execute in CI. A broader AST-shaped scan found **61
`beforeAll`/`afterAll` hooks across ~50 e2e specs with no explicit timeout** — this is very
likely the real, mundane root cause behind much of this pipeline's historical "flaky
e2e / Docker host contention" narrative, not (only) actual environment instability.

**Not fixed by QA itself**, consistent with this pipeline's QA/dev separation of duties.

### D6 — raised to MEDIUM (was LOW), still open, now gate-visible
In the documented `up --abort-on-container-exit --exit-code-from ...` run, check 6
("correct cert but wrong bearer token is rejected 401") false-failed again. Product
behavior is correct — confirmed two ways: a hand-issued mTLS request with correct cert +
wrong token against an idle engine returns `401 {"code":"AI_UNAUTHORIZED"}`, and the same
smoke-test script via `run --rm` passes 6/6, exit 0. Root cause: check 5 leaves LiteLLM
mid-retry against an unreachable OpenRouter; check 6's `curl` has no `--max-time`, so it
can't distinguish "no response yet" from "wrong status". Now that `--exit-code-from` is
wired in (the D3-item-4 fix), this flake **fails the build** instead of being silently
invisible, which is why it's raised to medium.

### D9 — LOW/MEDIUM, NEW
The documented mTLS gate command returned **exit 127 with zero checks executed** in one
run: compose logged `certs-init-1 exited with code 0` then aborted immediately, because
`--abort-on-container-exit` fires on `certs-init`'s own *intentional* successful exit, not
just on failures. Timing-dependent — another run correctly executed and propagated exit 1
on a deliberately-broken scenario, so the underlying D3-item-4 exit-code fix works; the gate
command itself is just unreliable. `docker compose ... run --rm mtls-smoke-test` is
deterministic and should be the documented/used gate instead.

### D10 — LOW, NEW
First image build failed hard with `Inlining of fonts failed ... getaddrinfo EAI_AGAIN
fonts.googleapis.com`. `angular.json`'s production config has `optimization.fonts: true`
and `index.html` links Google Fonts, so every build must reach that host or fail outright —
same fragility class as the bcrypt native-build issue already fixed. A retry succeeded
(sandbox DNS was intermittent), so this isn't a repo bug per se, but an air-gapped
build/deploy pipeline has no fallback today.

### D11 — LOW, NEW
`.env.example` documents `PLATFORM_METRICS_TOKEN` as guarding `GET /api/metrics`
(Prometheus text format, per HLD §12). The token exists end-to-end in
`env.schema.ts`/`configuration.ts` and is passed through by compose, but **there is no
`/api/metrics` route anywhere in the app**. `DEPLOYMENT.md` §7 discloses this gap but
doesn't say where an operator would configure a scraper for it. Separately, `.env.example`
claims to document every schema variable but currently lists 32 of 108.

### D12 — informational
Obsolete `version:` keys in `docker-compose.dev.yml` and `docker-compose.ai.yml` produce a
warning on every `docker compose` invocation. Cosmetic only.

### D13 — informational (provenance)
This QA pass ran on host Node v22.16.0 against an `engines: >=24.13.0` requirement. The
*deployed* runtime is correct (`node:24-alpine`, verified via a real image build) — this is
only a note that the host-side verification environment itself doesn't match; worth one
confirmation pass on Node 24 if that matters for future QA provenance.

### D7 — partially closed (carried over from the prior review)
MySQL e2e schema leakage is fixed — the instance held only `examland_platform` after this
run. Still open: 247 orphaned `examland_e2e_*` Qdrant collections, plus several stray
temp/test-artifact directories not covered by `.gitignore` (`qa-tmp-retry1/`, a
mis-escaped `apps/api/workproductsexam-4uqa-resultsdev-17b<ctrl>60810/` directory, and a
newly-noticed `apps/api/migrate-platform-15b.cjs`). Hygiene only, no functional impact.

## 5. Environment instability observed during this pass (not product defects)

Docker Desktop's daemon itself crashed four times during this QA pass (twice mid-build,
`rpc error ... EOF`) and was restarted each time; this also collaterally killed a
concurrently-running agent's throwaway `examland-seedverify-*` containers. Separate
third-party container stacks were observed appearing on the shared host at 20:14:46Z and
21:28:04Z, both *after* this pass's own e2e run (19:27-19:39Z) — and D8 reproduced 3/3
independently afterward against a different MySQL container — so D8 does not rest on host
contention; it is a genuine, repeatable test-code gap.

## 6. Related: separately-found deployment gap (not part of this QA pass)

A concurrently-dispatched devex fix (adding `apps/api/src/seed-demo-tenant.ts` for local
first-run convenience) found that `docker/docker-compose.dev.yml`'s `examland` MySQL user
has grants scoped only to `examland_platform`, not `CREATE DATABASE` globally — meaning
tenant provisioning (this new script, and the pre-existing `POST /api/platform/tenants`
HTTP path) cannot create a tenant schema against the real compose stack as currently
configured. This is being tracked and fixed alongside the D8/D6/D9 pass; see
`docs/NEXUS_STATE.md`'s decision log for status.
