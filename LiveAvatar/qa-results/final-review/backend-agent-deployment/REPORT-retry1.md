# Final Review — retry 1 re-verification (deployment + backend/agent regression)

- **Agent:** `nexus-qa` (independent of `nexus-dev`)  •  **Date:** 2026-08-20
- **Scope:** independent re-verification of the fixes `nexus-dev` claims for D-1..D-9 and the
  documentation-integrity defect from `qa-results/final-review/backend-agent-deployment/REPORT.md`,
  plus a full three-language regression. Frontend re-verification (page-header responsive fix,
  Provider Registry accessible-name fix) was handled by a parallel agent and is **not** in this report.
- **Evidence:** `qa-results/final-review/backend-agent-deployment/retry1-evidence/`

---

## Overall verdict

### PASS-WITH-CAVEATS — every defect re-tested is genuinely fixed; no blocking defect remains.

Both of the two fixes this dispatch singled out were proven **fresh, from scratch, by me** — not
re-read from the dev's claims:

- **D-1 is GENUINELY PROVEN.** I started from a state with **zero `liveavatar/*` images on the host**
  (`docker images | grep liveavatar` -> empty) and a `docker compose down -v`, then followed
  `DEPLOYMENT.md` section 2 verbatim: `cp .env.example .env` (+ the edits it now enumerates) ->
  `mkdir -p secrets` -> `docker compose build` -> `docker compose run --rm migrate` -> `docker compose up -d`.
  All five services came up healthy with **0 restarts each**, LiveKit booted on the `sed`-rendered
  config, and the agent **registered with the real LiveKit** (`registered worker,
  agent_name=avatar-agent, url=ws://livekit:7880`). No manual substitution step of any kind was needed.
- **D-9 is GENUINELY PROVEN.** `pnpm --filter @liveavatar/api test:e2e` with the CI job env:
  **exit code 0, wall clock 20.0 s** against a Jest-reported test time of 18.2 s — i.e. it
  self-terminated ~1.8 s after the suite finished, with **zero** occurrences of "Jest did not exit"
  in the log. It was **not** killed by me or by a timeout. No `--forceExit` was added — the fix is a
  real `OnModuleDestroy` that closes the previously-unclosed shared ioredis client.

One **new, non-blocking** finding (D-10) and one **residual** of D-9 are recorded below, plus the
carried-forward caveats that still belong in the completion report.

---

## Fixed / not-fixed, per defect ID

| ID | Claim | My independent verdict | How I proved it |
|---|---|---|---|
| **D-1** (blocking) | LiveKit placeholder substituted via compose `sed` entrypoint / k8s initContainer | **FIXED — proven live from a clean state** | Full clean bring-up, see above and part 1 |
| **D-2** (blocking CI) | `ruff format` / `mypy` clean via a narrowly-scoped override | **FIXED** | `ruff check` -> "All checks passed!"; `ruff format --check .` -> "85 files already formatted"; `mypy src` -> **"Success: no issues found in 58 source files"**; override reviewed and is narrow (part 2) |
| **D-3** (security) | tenant PATCH/status now 404 for both cases; test no longer tolerates 403 | **FIXED — proven live** | Live probe on the composed stack: PATCH and POST-status return **404 `TENANT_NOT_FOUND` identically** for an existing-other tenant and a random UUID; tenant B unchanged in DB. `tenant-isolation.e2e-spec.ts:186` is now `.expect(404)` — no `expect([403, 404])` anywhere in the file |
| **D-4** (moderate) | root-caused by pinning `tsBuildInfoFile` into `dist/` | **FIXED — original bug reproduced first, then shown gone** | part 4: I reproduced the ORIGINAL failure mechanism, then showed the shipped config does not exhibit it |
| **D-5** (rough edge) | UDP range moved to `20000-20100` in all three files | **FIXED — all three consistent** | `docker-compose.yml:96` `20000-20100:20000-20100/udp`; `deploy/livekit/livekit.yaml:38-39`; `k8s/livekit.yaml:28-29`. Confirmed live in the running server own startup line: `"rtc.portICERange": [20000, 20100]` |
| **D-6** (blocking k8s) | `app: livekit` admitted to `:8081`, plus a `livekit-egress` policy | **FIXED (manifest review only — no cluster reachable)** | part 6 |
| **D-7** (blocking k8s) | migrate Job labelled `app: migrate` + `migrate-egress` policy | **FIXED (manifest review only)** | part 6 |
| **D-8** (low) | (not in this dispatch fix list) | **not re-tested** | out of scope this pass |
| **D-9** (blocking CI) | unclosed Redis client; `redis-client-shutdown.provider.ts` added | **FIXED — proven fresh, clean exit in 20 s** | part 5. One residual, see D-9-R |
| **Doc-integrity** | CI/docs now point at the real cross-language contract test | **FIXED** | part 7 |

**New this pass:** **D-10** (low, k8s-only) — NetworkPolicy assumes in-cluster Postgres/Redis pods
while `DEPLOYMENT.md` section 3 documents *managed* Postgres/Redis. **D-9-R** (low) — the e2e suite
still hangs forever when `beforeAll` fails. **D-11** (cosmetic) — stale status claims in
`DEPLOYMENT.md` sections 7-8.

---

## Environment actually used

| Component | Value |
|---|---|
| Docker | Server 29.7.2, reachable and used throughout |
| Compose project | `liveavatar-qa2`, from the **production** `docker-compose.yml` |
| Images | Built fresh this pass from the shipped Dockerfiles (`liveavatar/web` 885 MB, `liveavatar/agent` 1.62 GB); host had **no** `liveavatar/*` image before the build |
| Public app | `http://localhost:18080` (see deviation) |
| Internal app | `http://localhost:8081` |
| Kubernetes | **No cluster reachable.** `kubectl cluster-info` fails; even `kubectl apply --dry-run=client` fails because modern kubectl needs API discovery. k8s work is manifest review + YAML parse only |
| Python | `apps/agent/.venv` (the project own venv) |

### Deviation from the shipped compose file (1, host-forced)

`web` public host port `8080` -> `18080`, via a QA-only override file, because an unrelated
product container (`nextbot-widget-embed-1`) holds host 8080 on this shared sandbox.
Container-internal ports untouched; `:8081` published as shipped; **no** LiveKit port change was
needed this time (D-5 move to 20000-20100 removed the collision that forced one last pass).
The first `up` attempt failed on a port bind because Compose *appends* `ports` from an override file
rather than replacing it — fixed by using Compose `!override` tag. That is an artifact of my
override file, **not** a defect in `docker-compose.yml`.

---

## 1. D-1 — clean bring-up, redone from scratch

```
docker images | grep liveavatar        -> (empty)
docker compose -p liveavatar-qa2 ... down -v --remove-orphans
cp .env.example .env  (+ the enumerated edits)  ;  mkdir -p secrets
docker compose build                   -> BUILD_EXIT=0 (both images built)
docker compose run --rm migrate        -> applied 20260819234327_init; "Seeded 10 provider definitions."
docker compose up -d                   -> UP_EXIT=0, all five services
```

| Check | Result |
|---|---|
| `docker compose build` (web + agent) | **PASS**, exit 0 |
| `docker compose run --rm migrate` | **PASS** — migration applied, 10 provider definitions seeded |
| Schema in Postgres | **PASS** — 21 tables; `provider_definition` = 10 rows (verified by `psql` inside the container) |
| `docker compose up -d`, all five | **PASS** — postgres/redis/livekit/web healthy, agent healthy, migrate exited 0 |
| Restart counts after ~20 min | **0 on every service** |
| LiveKit booted on rendered config | **PASS** — `starting LiveKit server {... "rtc.portICERange": [20000, 20100]}`; no `api_key is required to use webhooks` |
| Agent registered with real LiveKit | **PASS** — agent side: `registered worker, agent_name=avatar-agent, url=ws://livekit:7880`; **and LiveKit own side**: `worker registered {"agentName":"avatar-agent","workerID":"AW_xXViVtadBYYJ"}` |
| `GET /api/health` | **PASS** — real `200 {"status":"ok"}` |
| SPA + deep link | **PASS** — `/admin/` 200, `/c/` 200, `/admin/tenants/abc` 200 (genuine SPA fallback) |
| `/internal` guard on `:8081` | **PASS** — no token 401, wrong token 401, correct token 404 `SESSION_NOT_FOUND` (guard passed) |
| Agent-to-control-plane seam, from *inside* the agent container | **PASS** — `web-internal:8081` resolves; 401 without token, 404 (guard passed) with the shared `INTERNAL_TOKEN` |
| Forged LiveKit webhook | **PASS** — 204 silent drop, `web` restart count stayed **0** (original crash mode did not recur) |
| Error lines in web / agent / livekit logs | **zero** in all three |

Evidence: `retry1-evidence/01-build-tail.log`, `02-migrate.log`, `03-up.log`, `04-agent-registered.log`.

The k8s side of D-1 could not be run (no cluster), but the initContainer in `k8s/livekit.yaml` uses
the *same* `livekit/livekit-server:v1.8.0` image and the *same* `sh -c` + `sed` one-liner that I just
proved works live in compose, rendering into a shared `emptyDir` the main container mounts at
`/etc/livekit`, with `LIVEKIT_API_KEY` sourced from `liveavatar-web-secrets`. The Secret template
defines both `LIVEKIT_API_KEY` (used by the initContainer) and `LIVEKIT_API_KEY_PAIR` (used by the
server `LIVEKIT_KEYS`). Structurally correct.

## 2. D-2 — Python CI gates

```
ruff check .          -> All checks passed!
ruff format --check . -> 85 files already formatted
mypy src              -> Success: no issues found in 58 source files
lint-imports          -> Contracts: 3 kept, 0 broken
pytest                -> 253 passed in 88.03s
```

**The override is narrowly scoped**, not a blanket suppression. `pyproject.toml` has exactly two
`[[tool.mypy.overrides]]` blocks:
- three named modules (`adapters.llm.openai`, `.anthropic`, `.google`) disabling exactly
  `arg-type`, `union-attr`, `call-overload`;
- one named module (`orchestration.graph_pydantic_ai`) disabling exactly `type-arg`, `call-overload`.

No `ignore_errors`, no wildcard module patterns, no global `disable_error_code`. The pre-existing
global `ignore_missing_imports = true` / `disallow_untyped_defs = false` are unchanged from before
this fix pass. The dev also genuinely *fixed* rather than suppressed the `pipeline.py` `object`-typed
params and `telemetry/logging.py` — those files carry no override and pass clean.

## 3. D-3 — tenant enumeration oracle

Live, against the composed stack, with a real invite-provisioned tenant-A-scoped admin:

| Probe (as tenant-A admin) | Existing *other* tenant (B) | Non-existent UUID |
|---|---|---|
| `PATCH /api/tenants/:id` | **404 `TENANT_NOT_FOUND`** | **404 `TENANT_NOT_FOUND`** |
| `POST /api/tenants/:id/status` | **404 `TENANT_NOT_FOUND`** | **404 `TENANT_NOT_FOUND`** |
| `GET /api/tenants/:id` | **404 `TENANT_NOT_FOUND`** | **404 `TENANT_NOT_FOUND`** |

Byte-identical response bodies in all six cases — no oracle remains. Tenant B name and status were
re-read as operator afterwards and are unchanged (`QA Tenant B`, `active`), so the write is still
correctly blocked.

Source confirms the fix is at the right layer: `update-tenant.use-case.ts` and
`change-tenant-status.use-case.ts` both collapse "does not exist" and "not yours" into a single
`AppError.notFound('TENANT_NOT_FOUND')` branch. `TENANT_FORBIDDEN` no longer appears in either file
(it still legitimately exists on invite/config/credential use cases, which are not tenant-existence
oracles in the same way).

**The tolerant assertion is gone**: `apps/api/test/tenant-isolation.e2e-spec.ts` contains no
`expect([403, 404])` anywhere; line 186 is `.expect(404)` for exactly the PATCH that used to be
tolerated. Evidence: `retry1-evidence/05-d3-probe.log`.

## 4. D-4 — stale `.tsbuildinfo` silent no-op build

I did what the dispatch asked: **reproduced the original bug pattern first**, using the same compiler
and the same project, differing only in where the build-info file lives.

```
# ORIGINAL configuration (tsBuildInfoFile OUTSIDE outDir)
tsc -p tsconfig.build.json --outDir .qa-d4 --tsBuildInfoFile ./tsconfig.build.tsbuildinfo
  run1                            -> emitted main.js  (1)
  delete .qa-d4 ; run again       -> emitted NOTHING  (0)   <-- ORIGINAL BUG REPRODUCED, exit 0
# SHIPPED configuration (tsBuildInfoFile INSIDE outDir)
tsc -p tsconfig.build.json --outDir .qa-d4 --tsBuildInfoFile ./.qa-d4/.tsbuildinfo
  run1                            -> emitted main.js  (1)
  delete .qa-d4 ; run again       -> emitted main.js  (1)   <-- FIXED
```

And end-to-end through the real build script:
- deleting `dist` plus a **real source change** (a new `src/qa-d4-marker.ts` exporting `VALUE_ONE`) ->
  `pnpm build` emitted `dist/main.js`, `dist/main-internal.js`, `dist/qa-d4-marker.js` (`VALUE_ONE`)
  and `dist/.tsbuildinfo`;
- changing the marker to `VALUE_TWO` and rebuilding -> `dist/qa-d4-marker.js` contains `VALUE_TWO`
  (the change is genuinely reflected);
- planting a legacy `apps/api/tsconfig.build.tsbuildinfo` at the *old* default path and wiping
  `dist/` -> `pnpm build` still emitted both entrypoints (the legacy file is now inert).

This is a genuine root-cause fix, not another symptom patch: `deleteOutDir` now deletes the cache
together with `dist/`, so a wiped `dist/` can never coexist with a cache claiming it is up to date.
The temporary marker file and all scratch dirs were removed; `git status` is clean of them.

## 5. D-9 — Jest e2e clean exit

**Fresh run, timed by me, CI-equivalent env:**

```
EXIT=0   WALL_MS=20011
Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
Time:        18.162 s
Ran all test suites.
grep -c "Jest did not exit" -> 0
```

The suite self-terminated ~1.8 s after finishing. `test:e2e` still has **no** `--forceExit` and
`jest-e2e.config.cjs` still has no `forceExit`/`globalTeardown`, so this is the leak actually being
closed, not masked. The fix is exercised on every run: the `redis.module.ts` factory constructs an
ioredis client unconditionally (falling back to `redis://localhost:6379` when `REDIS_URL` is unset,
which the spec deliberately unsets), and `RedisClientShutdown.onModuleDestroy` calls `quit()` with a
`disconnect()` fallback. Evidence: `retry1-evidence/07-e2e-clean-exit.log`.

### D-9-R — LOW (residual, new) — the suite still hangs forever when `beforeAll` fails

- **Originating phase:** Phase 1 (e2e harness) — a remaining edge of the same defect class.
- **Actual:** run `pnpm --filter @liveavatar/api test:e2e` **without** `LIVEKIT_URL` etc. (the clean
  local-checkout case, caveat 4 below). The suite fails fast in `beforeAll` with
  `LIVEKIT_URL is required`, prints `Jest did not exit one second after the test run has completed`,
  and then **never exits**. Three such processes accumulated during this pass and I confirmed one was
  still alive **20 minutes** after its 17 s run finished; all three had to be killed with
  `Stop-Process`. Evidence: `retry1-evidence/06-e2e-missing-env-hang.log`.
- **Why:** on that path `Test.createTestingModule().compile()` throws, so `app` is never assigned,
  the `afterAll` `await app?.close()` is a no-op, and `RedisClientShutdown` — which is only invoked
  via the Nest shutdown lifecycle — never runs. The ioredis client (and possibly the testcontainer
  socket) created during the partial bootstrap stays open.
- **Impact:** low. On the happy path and in CI (where the env is supplied) this never triggers. But
  it means **any future failure inside `beforeAll` in CI burns the runner to the job timeout**
  instead of failing fast — the exact symptom D-9 was raised for, just on a different code path.
- **Severity:** Low / rough edge. Not blocking.

## 6. D-6 / D-7 — Kubernetes NetworkPolicy (manifest review; no cluster reachable)

No cluster was reachable (`kubectl cluster-info` fails; `--dry-run=client` also fails because kubectl
requires API discovery). All 15 manifests parse cleanly as YAML and declare 21 objects.

**D-6 — internally consistent and would work:**
- `web-ingress` `:8081` `from:` now lists `podSelector {app: agent}`, **`podSelector {app: livekit}`**,
  and `namespaceSelector {gpu-workers}` — LiveKit is admitted.
- A new **`livekit-egress`** policy (`podSelector {app: livekit}`, `policyTypes: [Egress]`) allows DNS
  plus `to: podSelector {app: web}` on **TCP 8081** — the reverse direction `default-deny-all` was
  blocking.
- The `k8s/livekit.yaml` Deployment pod template carries `labels: {app: livekit}`, so both selectors
  actually match. The webhook URL (`http://web-internal:8081/internal/livekit/webhooks`) targets the
  `web-internal` Service, whose backing pods are `app: web` — which is what `livekit-egress` allows
  (NetworkPolicy applies to pod IPs, and `web-internal` is a normal ClusterIP over `app: web` pods).
  Consistent.

**D-7 — internally consistent and would work:**
- The `migrate-job.yaml` pod template now carries `labels: {app: migrate}`.
- `postgres-ingress` `from:` now includes `podSelector {app: migrate}`.
- A new **`migrate-egress`** policy allows DNS + `app: postgres` on 5432.
- This holds **regardless of apply order**, which was the point.

**NFR-3 boundary re-checked:** `web-internal` remains ClusterIP-only with no Ingress path;
`web-ingress.yaml` routes only to `web-public:8080`; the NetworkPolicy still splits 8080 (ingress-nginx
namespace only) from 8081. Unchanged and still correct.

### D-10 — LOW (new, k8s-only) — NetworkPolicies assume in-cluster Postgres/Redis, but the runbook documents *managed* ones

- **Originating phase:** deployment layer (pre-existing; surfaced while reviewing the D-6/D-7 fixes).
- **Expected:** `DEPLOYMENT.md` section 3 states "Managed Postgres/Redis are assumed (HLD 8.2) — this
  repo does not ship StatefulSets for them."
- **Actual:** with `default-deny-all` in force, the only egress `web` has is DNS, `podSelector
  {app: postgres}`:5432, `podSelector {app: redis}`:6379, `podSelector {app: livekit}`:7880/7881, and
  `0.0.0.0/0`:**443**. A managed Postgres/Redis is an out-of-cluster IP on **5432/6379**, matched by
  no rule — so `web` (and the migrate Job, whose `migrate-egress` has the same shape) would be unable
  to reach the database in the documented topology. It only works if Postgres/Redis are in-cluster
  pods carrying those exact labels, which this repo does not ship.
- **Impact:** a first k8s deploy against managed data stores would fail at DB connect. Config-review
  finding; no cluster available to confirm.
- **Fix direction:** either add an `ipBlock` egress rule for the managed endpoints (documented as
  environment-specific, like the existing 443 rule), or state explicitly that these policies assume
  in-cluster data stores.
- **Severity:** Low (k8s-only, and k8s has never been deployed).

## 7. Documentation-integrity defect — cross-language contract test

- The referenced file **exists**:
  `apps/api/src/modules/deployment-config/domain/agent-config-cross-language.contract.spec.ts`.
- It **actually runs where the comment now says it does**: `jest --listTests` for `@liveavatar/api`
  lists it, so it is inside the `api` job `test:cov` step. It was in the 129-suite run below.
- Both former false claims are corrected and the correction is explained in place:
  `.github/workflows/ci-cd.yml:118-131` and `DEPLOYMENT.md` section 4 (lines 228-235) now name the
  real path and explicitly record that the old
  `packages/contracts/src/agent-config/schema.contract.spec.ts` never existed.
- The Python half (`apps/agent/tests/contracts/test_agent_config_contract.py`) exists and ran as part
  of the 253-test pytest pass.

**Verdict: FIXED.**

---

## Full regression — all three languages, re-run this pass

| Check | Result |
|---|---|
| `apps/agent` — `pytest` | **PASS — 253 passed** (88.0 s) |
| `apps/agent` — `ruff check .` | **PASS** — All checks passed! |
| `apps/agent` — `ruff format --check .` | **PASS** — 85 files already formatted |
| `apps/agent` — `mypy src` | **PASS** — no issues found in 58 source files |
| `apps/agent` — `lint-imports` | **PASS** — 3/3 contracts KEPT |
| `apps/api` — `jest --runInBand` | **PASS — 129 suites / 717 tests** (was 128/715; +1 suite = `redis-client-shutdown.provider.spec.ts`) |
| `apps/api` — ESLint | **PASS** — clean |
| `apps/api` — `tsc --noEmit` | **PASS** — clean |
| `apps/api` — `nest build` | **PASS** — emits both entrypoints reliably (D-4) |
| `apps/api` — `test:e2e` | **PASS — 1/1, exit 0 in 20 s** (D-9) |
| `packages/contracts` — build + lint | **PASS** — clean |
| `apps/web` — `jest --coverage` | **PASS — 61 suites / 424 tests** |
| `apps/web` — ESLint | **PASS** — clean |
| `apps/web` — `ng build admin` + `ng build conversation` | **PASS** — both bundles emitted; same single pre-existing "`@liveavatar/contracts` is not ESM" CommonJS warning |

**Observation for the parallel frontend agent (not a finding of mine):** the frontend suite count is
unchanged at 61/424 despite two claimed frontend fixes — worth confirming those fixes carry
regression tests.

### Security / AI-boundary spot-check (independent re-run)

| Check | Result |
|---|---|
| Provider SDK imports outside `adapters/` | **Clean** (grep + `import-linter` contract KEPT) |
| Agent-framework imports outside orchestration/registry | **Clean** — only a `Literal["langgraph","pydantic-ai"]` key type and the entrypoint two orchestrator constructions |
| Registry module present | **Yes** |
| Hardcoded vendor model ids | Only `settings.py:19-20` `gpt-4o-mini` env **defaults** — the same low note as last pass, still open |
| Secrets committed | **None tracked**; `.gitignore` covers `.env`, `secrets/`, `*.tsbuildinfo`, both venvs |
| Tenant isolation (live) | 404-identical on every probed route (part 3) |
| `/internal` guard (live, host **and** in-container) | 401 without/with wrong token on every probed route |
| Forged LiveKit webhook | 204 silent drop, no process crash |

---

## Traceability matrix

| Dispatch item | Scenario(s) | Result | Evidence |
|---|---|---|---|
| D-1 clean bring-up from scratch | teardown with volumes -> build -> migrate -> `up -d`, all 5 services, following DEPLOYMENT.md section 2 verbatim | **PASS** | `01`-`04` |
| D-1 agent genuinely registers | worker registration seen on **both** agent and LiveKit sides | **PASS** | `04` |
| D-1 health / SPA / internal guard | `/api/health`, `/admin/`, `/c/`, deep link, `:8081` 401/401/404 | **PASS** | part 1 |
| D-1 k8s path | initContainer manifest review (no cluster) | **PASS (review only)** | part 1 |
| D-2 `mypy src` = 0 errors | fresh run | **PASS** | part 2 |
| D-2 override narrowly scoped | `pyproject.toml` review | **PASS** — 2 blocks, 4 named modules, 5 error codes | part 2 |
| D-3 both routes 404, both cases | live probe, tenant-A admin vs tenant B and random UUID | **PASS** | `05` |
| D-3 test no longer tolerates 403 | grep of the e2e spec | **PASS** | part 3 |
| D-4 original bug reproduced then gone | old vs new `tsBuildInfoFile` placement; real source change round-trip | **PASS** | part 4 |
| D-5 three files consistent | compose / deploy config / k8s + live server startup line | **PASS** | verdict table |
| D-6/D-7 policies internally consistent | manifest review + YAML parse (no cluster) | **PASS (review only)** | part 6 |
| D-9 clean exit, timed fresh | exit 0 in 20.0 s, no "did not exit" warning, no `--forceExit` | **PASS** | `07` |
| Doc-integrity contract test | file exists + appears in `jest --listTests` + CI/doc text corrected | **PASS** | part 7 |
| Full three-language regression | 14 suites/gates | **ALL PASS** | regression table |

---

## Defect list (this pass)

| ID | Severity | Summary | Originating phase |
|---|---|---|---|
| **D-9-R** | Low | e2e suite still hangs indefinitely when `beforeAll` throws (env-missing path); the shutdown provider never runs because the module never compiled | Phase 1 (e2e harness) |
| **D-10** | Low | k8s NetworkPolicies allow DB egress only to in-cluster `app: postgres` / `app: redis` pods, but DEPLOYMENT.md section 3 documents *managed* Postgres/Redis (out-of-cluster, ports 5432/6379 — matched by no rule) | deployment |
| **D-11** | Low (cosmetic) | `DEPLOYMENT.md` sections 7-8 still assert "aligned both to 50000-50100" and "Not validated live in this pass: `docker compose up` bringing up all five services", contradicting the now-correct section 2. They are the deploy pass historical record, but read as current status | deployment |

No blocking defects. **D-8** (misleading validation error codes) was outside this dispatch and remains
open at Low from the previous report.

---

## Open caveats for the project completion report

Re-checked this pass, not assumed:

1. **Invented Alibaba LiveAvatar wire protocol.** `alibaba_liveavatar.py` still assumes an unverified
   WebSocket contract (`<endpoint_url>/v1/render/stream`, bearer auth, JSON control + binary media).
   **STILL OPEN.** Disclosed in the adapter own docstring and correctly isolated to one file. Must
   be validated against the real vendor contract before any tenant uses it in production.
2. **UX_GUIDELINES vs LLD conflict on purged transcripts** (410 `TRANSCRIPT_PURGED` blocks the
   feedback form the guidelines say should still work). **STILL OPEN** — needs an architect/product
   decision, not a coding fix.
3. **No Playwright / axe-core e2e suite** for the 11 screens (HLD 8.3 step 5, NFR-4). **STILL OPEN**,
   honestly flagged with a `TODO` in the `ci-cd.yml` `e2e` job.
4. **The tenant-isolation e2e suite is not self-contained and covers one route pair.** Confirmed again
   this pass: without the CI env block it fails immediately with `LIVEKIT_URL is required` (and then
   hangs — D-9-R), so the documented local command still does not work on a clean checkout; and it is
   still **one test over `GET`/`PATCH /api/tenants/:id`**, while the CI comment describes it as
   covering "every tenant-scoped endpoint". Sessions, transcripts, config, credentials, alert-policy,
   GPU and residency have no automated cross-tenant regression test (verified manually last pass;
   nothing protects them from regressing).
5. **`k8s/` manifests have never been schema-validated against a real API server.** **STILL OPEN and
   now doubly important** — D-1/D-6/D-7/D-10 are all k8s defects found purely by reading YAML. No
   cluster was reachable in this sandbox (not even for `--dry-run=client`). A real
   `kubectl apply --dry-run=server` remains a hard prerequisite for a first deploy.
6. **LiveKit at real scale.** `k8s/livekit.yaml` is a single-replica Deployment; HLD 8.2 wants
   StatefulSet/operator-managed. Also note its `Service` exposes only TCP 7880/7881 — the
   `20000-20100/udp` media range is not published by any k8s object, so WebRTC media would need the
   environment-specific LoadBalancer/hostNetwork story the file own comment defers. **STILL OPEN**;
   use the upstream Helm chart for production.
7. **No `GET /internal/health` route**; container liveness is inferred from the entrypoint. **STILL
   OPEN**, disclosed in DEPLOYMENT.md section 7.
8. **`packages/contracts` has no tests** (its `test` script is a `console.log` stub and no CI job
   invokes it). **STILL OPEN** — but the *documentation falsehood* about where the cross-language
   contract test lives is now **fixed** (part 7).
9. **`docker-compose.yml` publishes `:8081` to the host.** Deliberate and disclosed in both the file
   and DEPLOYMENT.md section 2. Not a defect; worth a second look only because the file is titled
   "production-oriented".
10. **`settings.py` `gpt-4o-mini` env defaults** are vendor literals that the project own
    `registry/keys.py` docstring calls a defect. Either carve out settings defaults in the rule or
    make them required env vars. **STILL OPEN** (low).
11. **The composed stack has never carried real traffic.** The agent registers with LiveKit and the
    control-plane seam works, but no browser has joined a room served by this containerised agent
    with a real STT/LLM/TTS/avatar loop (no real provider keys in this sandbox).

---

## Test hygiene

Everything created this pass was disposable and has been removed: the `liveavatar-qa2` compose project
was torn down with its volumes and network; the freshly built `liveavatar/web:latest` and
`liveavatar/agent:latest` images were deleted, restoring the host pre-session image set; the root
`.env`, `./secrets/`, `.qa-tmp/` (QA override file, probe script, raw logs), `apps/api/dist`,
`apps/web/dist`, the temporary `src/qa-d4-marker.ts` and every scratch `.tsbuildinfo` are gone;
`git status` shows no QA artifacts. Test accounts (`qa-op@example.com`, `qa-a-admin@example.com`) and
tenants (`qa-a-r1`, `qa-b-r1`) existed only inside the destroyed compose Postgres volume. Three hung
Jest processes from the D-9-R failure path were killed. No production system was contacted. Two things
on the host were deliberately **not** touched: the pre-existing `testcontainers-ryuk-*` container
(predates this session) and the parallel agent `la-fr2-pg` / `la-fr2-redis` containers.
