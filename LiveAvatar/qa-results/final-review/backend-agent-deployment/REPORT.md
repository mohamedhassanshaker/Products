# Final Review — Deployment smoke test + backend/agent full regression

- **Agent:** `nexus-qa`  •  **Date:** 2026-08-20
- **Scope:** (1) deployment smoke test against `nexus-deploy`'s output; (2) full-regression
  re-confirmation of `apps/api` + `apps/agent`. Frontend and the whole-app golden-path/security
  walkthrough were covered by a parallel agent and are **not** in this report.
- **Evidence:** `qa-results/final-review/backend-agent-deployment/evidence/`

---

## Overall verdict

### PASS-WITH-CAVEATS — with one BLOCKING deployment defect that must be fixed before any first deploy.

The two questions this dispatch asks answer differently:

| Question | Result |
|---|---|
| **Deployment smoke test** | **FAIL as shipped.** `docker compose up` cannot bring up the stack by following `DEPLOYMENT.md` §2 verbatim — `livekit` crash-loops on an unsubstituted config placeholder, and because `agent` gates on `livekit: service_healthy`, the agent never starts. The identical defect exists in the Kubernetes path. After a one-line substitution, **all five services came up healthy together for the first time in this project's history** and the assembled stack genuinely works. The deployment is *fundamentally sound but not runnable as documented*. |
| **Backend + agent regression** | **PASS.** Every suite is green, and all four highest-stakes historical fixes were re-verified **live against the fully composed production stack**, not merely re-read or re-unit-tested. Two new non-blocking defects were found (a tenant-existence enumeration oracle; a broken CI `agent` job), plus several carried-forward caveats. |

**Recommended routing:** fix D-1 (blocking) before declaring the pipeline done. D-2, D-6, D-7 and D-9 are
blocking for CI and Kubernetes respectively. D-3 and D-4 are genuine defects that do not block a
deploy performed knowingly by a human operator. D-5 and D-8 are rough edges.

---

## Environment actually used

| Component | Value |
|---|---|
| Docker | Server 29.7.2 (Docker Desktop 4.86.0), reachable and used throughout |
| Compose project | `liveavatar-qa`, from the **production** `docker-compose.yml` (not `docker-compose.dev.yml`) |
| Public app | `http://localhost:18080` (see deviations) |
| Internal app | `http://localhost:8081` |
| Images built | `liveavatar/web:latest` (884 MB), `liveavatar/agent:latest` (1.62 GB) — both from `docker compose build` using the shipped Dockerfiles |
| DB | `postgres:16-alpine` started by compose; schema applied by the compose `migrate` service |

### Deviations from the shipped compose file (2, both forced by this shared Windows host)

1. `web` public host port `8080` -> `18080`. Port 8080 was held by an unrelated product's container.
   Container-internal ports untouched.
2. `livekit` RTC UDP range `50000-50100` -> `40000-40100` (and the matching
   `deploy/livekit/livekit.yaml` `port_range_*`). **This is itself a finding — see D-5.**

No other service, port, env var or wiring was altered. Both deviations are host-side publish mappings
only; all inter-service traffic used the real compose network and the real service names.

**Sandbox note:** Docker Desktop's WSL VM crashed once under the weight of the `agent` image build and
had to be restarted. A host resource event, not a project defect; the build was resumed successfully.

---

## PART 1 — Deployment smoke test

### What was achieved (more than any previous pass)

| Step | Result |
|---|---|
| `docker compose build` (web) | **PASS** |
| `docker compose build` (agent) | **PASS** |
| `docker compose run --rm migrate` | **PASS** — applied `20260819234327_init`, seeded 10 provider definitions |
| migrate idempotency (2nd run) | **PASS** — "No pending migrations to apply", seed re-upserted cleanly |
| Schema verified in Postgres | **PASS** — 21 tables; `provider_definition` holds the correct 10-row catalog (livekit / deepgram / faster-whisper / anthropic / google / openai / elevenlabs / fish-speech / alibaba-liveavatar / bithuman) |
| `docker compose up -d` — **all five services** | **PASS only after working around D-1.** Then all 5 healthy and stable for 45 minutes; 0 restarts on web/agent/postgres/redis |
| **`agent` registers with the real LiveKit** | **PASS** — `registered worker, agent_name=avatar-agent, url=ws://livekit:7880`. Never demonstrated before this pass. |
| `GET /api/health` on the composed stack | **PASS** — real `200 {"status":"ok"}` |
| SPA serving + deep link | **PASS** — `/admin/` 200, `/c/` 200, `/admin/tenants/abc` 200 via genuine SPA fallback |
| Real endpoint exercise | **PASS** — bootstrap -> login -> `/auth/me` -> provider catalog -> tenant create -> invite -> accept -> tenant-scoped reads, all against the composed stack |
| agent -> control-plane seam | **PASS** — from inside the `agent` container, `web-internal:8081` resolves, the shared `INTERNAL_TOKEN` matches, guard returns 401 without it |

### D-1 — BLOCKING — LiveKit crash-loops on an unsubstituted config placeholder

- **Originating phase:** deployment layer (`nexus-deploy`).
- **Expected:** `DEPLOYMENT.md` §2's runbook (`cp .env.example .env` -> `docker compose build` ->
  `docker compose run --rm migrate` -> `docker compose up -d`) brings up all five services.
- **Actual:** `livekit` exits immediately and restarts forever. Because `agent` declares
  `depends_on: livekit: {condition: service_healthy}`, **the agent container is created but never
  started**, and `docker compose up` aborts with
  `dependency failed to start: container liveavatar-qa-livekit-1 is unhealthy`.
- **Root cause:** `deploy/livekit/livekit.yaml` ships `webhook.api_key: __LIVEKIT_API_KEY__`. That
  placeholder is not a key present in `LIVEKIT_KEYS`, so LiveKit refuses to boot:

  ```
  api_key is required to use webhooks
  ```

  The file's own header says to "template it at deploy time (Kustomize/Helm values, `envsubst`, or
  your CI/CD's own secret-templating step)" — but **the compose path has no templating step at all**,
  and `DEPLOYMENT.md` §2 never mentions substituting it.
- **Also affects Kubernetes:** `k8s/livekit.yaml`'s `livekit-config` ConfigMap embeds the same
  `api_key: __LIVEKIT_API_KEY__`, and `DEPLOYMENT.md` §3's `kubectl apply` order applies it directly
  with no substitution step. The LiveKit pod would `CrashLoopBackOff` identically.
- **Repro:** `cp .env.example .env`, fill values, `docker compose build`,
  `docker compose run --rm migrate`, `docker compose up -d`.
- **Proof it is the sole cause:** substituting the real key into a QA copy made LiveKit go `healthy`
  immediately, and the full five-service stack then came up.
- **Evidence:** `evidence/03-livekit-crashloop-placeholder.txt`
- **Severity:** **Blocking.** No documented path — compose or Kubernetes — produces a running system.

### D-2 — BLOCKING for CI — the `agent` job fails, so the pipeline can never reach `deploy`

- **Originating phase:** cross-phase (Phase 4–7 Python work + the deployment layer's CI definition).
- **Expected:** `.github/workflows/ci-cd.yml`'s `agent` job passes; it gates `e2e` -> `images` -> `deploy`.
- **Actual:** two of its five steps fail on the current tree:
  - `ruff format --check .` -> **12 files would be reformatted** (`entrypoint.py`, `pipeline.py`,
    `summary/post_call.py`, `residency/filter.py`, `adapters/avatar/bithuman.py`,
    `adapters/avatar/alibaba_liveavatar.py`, `adapters/llm/anthropic.py`, and 5 test files).
  - `mypy src` -> **22 errors in 6 files**.
- **Why it was never caught:** every prior dev/QA pass ran `ruff check` (which passes) but never
  `ruff format --check`; and no prior decision-log entry ever reports a mypy result. Both are in CI.
- **Assessment of the mypy errors:** all are type-hygiene, **not** runtime defects. 13 are vendor-SDK
  signature mismatches in the three LLM adapters; 3 are `object`-typed attribute access in
  `pipeline.py`; 1 is `pipeline.py:342`'s `# type: LlmChunk` comment referencing a never-imported name
  (comment-only annotation, zero runtime effect); the rest are `structlog` / `pydantic-ai` generic-arity issues.
- **Severity:** Blocking **for CI/CD only** — the product runs fine, but the pipeline meant to build
  and push images can never get past its third job.

### D-5 — LiveKit's fixed UDP port range collides with the Windows ephemeral range

- **Originating phase:** deployment layer.
- **Actual:** `docker-compose.yml` publishes `50000-50100/udp`. Windows' default dynamic UDP range is
  **49152-65535** (`netsh int ipv4 show dynamicport udp`), which fully contains it. Any OS process can
  transiently hold a port in that window; here UDP 50072 was held and `up` failed with
  `bind: Only one usage of each socket address ... is normally permitted`.
- **This is the real explanation for the prior deploy pass's failure**, which was characterised as "an
  unrelated already-running LiveKit dev container". That container was *not* running during this pass
  and the collision still occurred. It is structural on Windows, not a one-off.
- **Fix direction:** move the range below 49152 in `docker-compose.yml` **and**
  `deploy/livekit/livekit.yaml` together (they already document that they must move together).
- **Severity:** Rough edge — non-deterministic local bring-up on Windows. Does not affect Linux/K8s.

### D-6 — NetworkPolicy blocks LiveKit -> `web-internal:8081`; session webhooks die in Kubernetes

- **Originating phase:** deployment layer.
- **Expected:** `deploy/livekit/livekit.yaml` and the k8s ConfigMap post webhooks to
  `http://web-internal:8081/internal/livekit/webhooks`. Per LLD §8.3, `room_finished` is the
  *authoritative* `ended` transition and the safety net when the browser's fast-path end call never
  arrives; `participant_joined` drives `pending`->`active`.
- **Actual:** `k8s/networkpolicy.yaml`'s `web-ingress` policy admits `:8081` **only** from
  `podSelector: {app: agent}` and the `gpu-workers` namespace. LiveKit pods carry `app: livekit` and
  are in neither set. Separately, `default-deny-all` (`podSelector: {}`,
  `policyTypes: [Ingress, Egress]`) applies to LiveKit pods and permits only DNS egress — there is no
  `livekit-egress` policy. The connection is blocked in **both** directions.
- **Consequence:** in any NetworkPolicy-enforcing cluster, sessions never receive their authoritative
  `ended` transition and never transition to `active`. It fails silently.
- **Note:** the file's own comment calls this split "the literal enforcement of NFR-3". The NFR-3
  intent is correct and well-built; this is a missing allow-rule, not a broken concept.
- **Severity:** Blocking **for a Kubernetes deploy**; invisible in compose. Found by manifest review —
  no cluster was reachable in this sandbox, so this is not a live repro.

### D-7 — the pre-deploy `migrate` Job is blocked by `default-deny-all` on every deploy after the first

- **Originating phase:** deployment layer.
- **Actual:** `k8s/migrate-job.yaml`'s pod template carries **no labels at all**. `default-deny-all`
  therefore applies to it and permits only DNS egress; `web-egress` (which allows Postgres:5432) is
  scoped to `podSelector: {app: web}` and does not match. The Job cannot reach Postgres.
- **Why deploy #1 survives:** `DEPLOYMENT.md` §3 applies `networkpolicy.yaml` **last**, after the
  migrate Job. So the first deploy works, and every subsequent upgrade — where the policies already
  exist — has its pre-deploy migration gate hang and fail.
- **Severity:** Blocking for K8s upgrades. Config-review finding (no cluster available).

### NFR-3 — internal `:8081` boundary

| Surface | Finding |
|---|---|
| **Kubernetes** | **Correct and genuinely structural.** `web-internal` is ClusterIP-only with no Ingress path; `web-ingress.yaml` references only `web-public:8080`; the NetworkPolicy splits `:8080` (ingress-nginx only) from `:8081` (agent + gpu-workers only). Verified by manifest review. |
| **Compose** | `docker-compose.yml` **does** publish `8081:8081` to the host. Deliberate and disclosed in both the compose file and `DEPLOYMENT.md` §2 ("exposed to the host here only for local debugging"). Confirmed live: `:8081` is reachable from the host. **Not a defect** given the disclosure — see caveat 9. |

Defence-in-depth on `:8081` was verified live and is solid regardless of network placement — every
agent-facing route is guarded (Part 2, spot-check (d)).

---

## PART 2 — Backend + Python agent full regression

### Suite results (all re-run this pass)

| Check | Result |
|---|---|
| `apps/api` — `jest --runInBand` | **PASS** — 128/128 suites, **715/715 tests** (unchanged from Phase 7 close) |
| `apps/api` — `eslint "src/**/*.ts" "test/**/*.ts"` | **PASS** — clean |
| `apps/api` — `tsc --noEmit` | **PASS** — clean |
| `apps/api` — `nest build` | **PASS**, but see D-4 |
| `packages/contracts` — build | **PASS** |
| `apps/api` — `test:e2e` (tenant isolation) | **PASS** — 1/1, against a real testcontainers Postgres 16. See caveat 4 for two qualifications. |
| `apps/agent` — `pytest` | **PASS** — **253/253** (up from 241 at Phase 7 close) |
| `apps/agent` — `ruff check .` | **PASS** — "All checks passed!" |
| `apps/agent` — `ruff format --check .` | **FAIL** — 12 files (D-2) |
| `apps/agent` — `mypy src` | **FAIL** — 22 errors (D-2) |
| `apps/agent` — `lint-imports` | **PASS** — **3/3 contracts kept** (Agent layering; Vendor SDKs only inside adapters; Only entrypoint/registry compose adapters directly) |

### The four highest-stakes historical fixes — all re-verified LIVE, together, on the composed stack

#### (a) `PrismaService.withBypass` tenant-scoping fix — HOLDS

Three distinct `withBypass` call sites exercised against the composed Postgres. Had the Prisma 7
lazy-thenable bug regressed, each would have thrown `TenantScopeViolationError`:

1. **Catalog seed** — `docker compose run --rm migrate` seeded 10 provider definitions; verified by a
   direct `psql` query.
2. **Tenant-create side effects** — `POST /api/tenants` returned 201 for three tenants; rows confirmed in `psql`.
3. **Idempotency store** — `POST /api/tenants` twice with the same `Idempotency-Key` UUID and body
   returned **the same tenant id** (`bb2f05c7-...`) with 201 both times, instead of a 409 slug
   conflict. That replay path only works if the bypass genuinely took effect.

**And the guard is still actually guarding** (not stuck permanently bypassed). Live cross-tenant
probes with a real tenant-A-scoped admin against the composed stack:

| Probe | Result |
|---|---|
| A reads own tenant A | 200 |
| A reads tenant B | **404 TENANT_NOT_FOUND** |
| A lists tenants | only `qa-tenant-a` |
| A reads B's config / credentials / alert-policy | **404 / 404 / 404** |
| B reads A's session by id | **404 SESSION_NOT_FOUND** |
| B reads A's transcript | **404** |

#### (b) LiveKit webhook signature verification (Phase 4's async/await bug) — HOLDS

Decisive negative *and* positive control against the composed `:8081`, using a real session row
(`room_name = qa-webhook-room-1`, `status = active`):

| Request | HTTP | Session status after |
|---|---|---|
| **Forged** `room_finished` (bogus JWT signature) | 204 | **still `active`** — correctly rejected, no state change |
| **Properly signed** `room_finished` (HMAC over the body's sha256, real API secret) | 204 | **`ended`, `ended_at` set** — correctly accepted |

The 204-on-forgery is intended behaviour (`internal.controller.ts` drops silently so an
unauthenticated caller cannot learn whether a room name exists). Crucially, **`web`'s restart count
stayed at 0** — the original failure mode (an unhandled promise rejection crashing the `:8081`
process) did not recur.

#### (c) Post-call summary 3-layer defence — teardown guard (layer 3) HOLDS

Verified **inside the actual shipped `liveavatar/agent:latest` image**, not the source tree:

```
docker exec liveavatar-qa-agent-1 python -c "... _guarded_teardown_step(boom(), step='generate_summary', ...) ..."
-> RuntimeError logged with full traceback, then:
   PASS: guard swallowed the exception; code after it ran = True
```

This is the layer QA's own retry proved would have caught the original D-5 defect alone. Confirmed
that `entrypoint.py`'s `finally` still calls `generate_summary` through the guard and *then* sends the
terminal `"ended"` event (`entrypoint.py:304-305`).

*Minor observation (not a defect):* the final `control_plane.send_event(..., "ended")` at line 305 is
itself outside any guard. Defensible (it is the terminal step), but if `send_event` raises the
exception still escapes `handle_job`.

#### (d) `InternalTokenGuard` on `/internal` routes — HOLDS

Live against the composed `:8081`:

| Route | No token | Wrong token | Correct token |
|---|---|---|---|
| `GET /internal/sessions/:id/runtime-config` | **401** | **401** | 404 `SESSION_NOT_FOUND` (guard passed) |
| `POST /internal/gpu-heartbeats` | **401** | — | — |
| `POST /internal/alerts` | **401** | — | — |

Also confirmed from inside the `agent` container over the real compose network: `web-internal:8081`
resolves, the shared `INTERNAL_TOKEN` matches on both sides, 401 without it. Source review confirms
the constant-time comparison (`timingSafeEqual`, equal-length padding on mismatch) is intact.

### D-3 — MODERATE — tenant-existence enumeration oracle (FR-TENANT-5 violation)

- **Originating phase:** Phase 1 (tenant CRUD / `TenantScopeGuard`).
- **Expected**, stated identically in three documents:
  - `FR-TENANT-5`: "Cross-tenant id access (guessing another tenant's UUID) -> `404` /
    `TENANT_NOT_FOUND` (**do not leak existence via 403**)."
  - `PRODUCT_SPECIFICATION.md`: "no cross-tenant enumeration (404, not 403)."
  - `HLD.md` §7 layer 3: "Cross-tenant id lookups return `404` ... **never `403`** — so existence is
    not leaked"; and "the membership check resolves to `404` for unknown-or-unassigned".
- **Actual:** a tenant-A-scoped admin can distinguish existing from non-existing tenant UUIDs:

  | Route | Existing *other* tenant | Non-existent id |
  |---|---|---|
  | `PATCH /api/tenants/:id` | **403 `TENANT_FORBIDDEN`** | 404 `TENANT_NOT_FOUND` |
  | `POST /api/tenants/:id/status` | **403 `TENANT_FORBIDDEN`** | 404 `TENANT_NOT_FOUND` |
  | all other tenant-scoped routes tested | 404 / 400 | 404 / 400 (identical — correct) |

- **Impact:** an authenticated tenant-scoped admin can enumerate which tenant UUIDs exist on the
  platform. The write itself is correctly blocked (tenant B's name verified unchanged in Postgres), so
  this is **information disclosure, not privilege escalation**.
- **Why it was never caught:** `apps/api/test/tenant-isolation.e2e-spec.ts:186` asserts
  `expect([403, 404]).toContain(res.status)` for exactly this PATCH — the suite was written to
  tolerate the behaviour, even though the same test's own title says "404 (never 403)".
- **Repro:** create tenants A and B; invite an `admin` scoped to A only; then `PATCH /api/tenants/{B}`
  (-> 403) vs `PATCH /api/tenants/{random-uuid}` (-> 404).
- **Evidence:** `evidence/05-tenant-enumeration-oracle.txt`
- **Severity:** Moderate — a real, spec-explicit multi-tenant boundary violation, bounded to existence
  disclosure by an already-authenticated admin.

### D-4 — MODERATE — `nest build` silently emits nothing with a stale `.tsbuildinfo` (recurrence)

- **Originating phase:** deployment layer (the pass that claimed to fix it).
- **Actual, reproduced deterministically this pass:**
  - With `apps/api/tsconfig.build.tsbuildinfo` present and `dist/` absent -> `nest build`
    **exits 0 and emits nothing**. `dist/` does not exist afterward.
  - After `rm -f tsconfig.build.tsbuildinfo` -> `nest build` exits 0 and emits `dist/main.js` and
    `dist/main-internal.js`.
- **Why this is still open:** `nexus-deploy` "fixed" this by deleting the file and adding
  `*.tsbuildinfo` to `.gitignore` / `.dockerignore`. That stops it inside Docker builds and on fresh CI
  checkouts, but **the root cause — TypeScript's incremental cache not being invalidated when `dist/`
  is removed — is untouched**, and the stale file had already regenerated in the working tree. Any
  developer running `nest build` then `node dist/main.js` gets a confusing module-not-found error.
- **Severity:** Moderate — local/dev-loop only (CI checkouts are clean), but this is the **second**
  occurrence of a bug class this project has already been burned by once.

### D-8 — LOW — validation failures surface semantically wrong domain error codes

| Request | Returned | Should be |
|---|---|---|
| `POST /api/tenants` with a non-UUID `Idempotency-Key` | `400 IDEMPOTENCY_KEY_REUSED` — *"This Idempotency-Key was already used with a different request body"*, with `details.fields` saying `"must be a UUID"` | a validation code; the key was never used before |
| `POST /api/auth/invites` with `roles: ["tenant_admin"]` (not a valid role) | `AUTH_INVITE_INVALID` — *"This invite link is invalid or has expired"* on a **create**-invite request where no link exists yet | a validation code naming the bad `roles` value |

The LLD's status mapping specifies `400` for validation. The status codes are right; the **codes and
messages** are misleading enough to send a developer down the wrong path.
**Severity:** Low. **Originating phase:** Phase 1/2.

---

## AI boundary compliance

| Check | Result |
|---|---|
| Provider SDK imports outside `adapters/` | **Clean** — grep found none; `import-linter`'s "Vendor SDKs only inside adapters" contract is KEPT |
| Agent-framework imports outside the registry | **Clean** |
| Registry module exists | **Yes** — `apps/agent/src/avatar_agent/registry/` (`registry.py`, `keys.py`, `errors.py`) |
| Hardcoded vendor model ids | **One low note**, below |
| Schema-validated structured output vs hand-parsed JSON | Not re-probed this pass (covered by Phase 6/7 QA); no regression indicators |
| ADR states the data-locality decision | **Yes, explicitly** — `ADR-001-stack.md` §6 "Data locality (explicit security decision, not left implicit)", with the per-hop table, the `send_to_remote_llm` / `prompt_text_only` enforcement mechanism, and an explicitly accepted residual risk for remote TTS/avatar |

**Low note:** `registry/keys.py`'s own docstring declares *"A vendor model literal (e.g. `"gpt-4o"`)
outside a test fixture is a defect (`nexus-qa` greps for this)."* — but `settings.py:19-20` contains
`ai_model_conversation: str = "gpt-4o-mini"` and `ai_model_summary: str = "gpt-4o-mini"`. These are
Pydantic-Settings **env defaults** for `AI_MODEL_*` (set explicitly in `.env.example` and
`docker-compose.yml`), so the provider-agnostic design is intact — but by the project's own stated
rule this is a literal in code. Either the rule should carve out settings defaults, or the defaults
should become required env vars.

---

## Traceability matrix

| Requirement / dispatch item | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| Docker reachable | `docker version` | PASS | Environment |
| `docker compose build` all services | web + agent from shipped Dockerfiles | PASS | image list |
| `docker compose up` all five together | full stack bring-up | **FAIL as documented** then PASS after D-1 workaround | D-1; `evidence/01` |
| `agent` registers with real LiveKit | live worker registration | PASS | `evidence/02` |
| Public health endpoint returns real 200 | `GET /api/health` | PASS | Part 1 |
| Internal `:8081` not externally routable | k8s manifests + live compose probe | PASS (k8s structural); compose publishes it by documented design | NFR-3 |
| `migrate` applies schema + seed | `compose run --rm migrate` x2 | PASS (incl. idempotency) | Part 1 |
| Real endpoints on composed stack | seed / login / me / catalog / tenant CRUD / invite | PASS | Part 1 |
| Backend jest | `jest --runInBand` | PASS 128 suites / 715 tests | Part 2 |
| Backend ESLint / tsc / nest build | all three | PASS (build caveat D-4) | Part 2 |
| Python pytest | `pytest` | PASS 253/253 | Part 2 |
| Python ruff / mypy / import-linter | all four CI steps | `ruff check` + `lint-imports` PASS; `ruff format --check` + `mypy` **FAIL** | D-2 |
| (a) `withBypass`, 3 call sites | seed, tenant-create, idempotency replay + 6 cross-tenant negatives | PASS | (a) |
| (b) LiveKit webhook forgery rejection | forged vs signed positive/negative control | PASS | (b) |
| (c) Post-call summary teardown guard | live exception injection in shipped image | PASS | (c) |
| (d) `InternalTokenGuard` on `/internal` | no / wrong / correct token x 3 routes + in-container | PASS | (d) |
| Phase 1 tenant-isolation e2e caveat | re-run against real testcontainers Postgres | **RESOLVED** (2 qualifications) | `evidence/04` |
| AI boundary compliance | SDK-import grep, model-literal grep, registry module, ADR data-locality | PASS (1 low note) | AI boundary |
| Secrets not committed | `git ls-files` for env / secrets / key files | PASS - none tracked | - |
| Cross-tenant isolation (live, composed stack) | 8 negative probes across 6 resources | PASS on reads; **FAIL on 2 mutating routes** | D-3 |

---

## Carried-forward caveats - the complete list of what remains genuinely open

Re-checked this pass rather than assumed. Ordered by significance.

**1. Invented Alibaba LiveAvatar wire protocol.** No public SDK/API reference was verifiable, so
`alibaba_liveavatar.py` assumes a WebSocket session at `<endpoint_url>/v1/render/stream` with bearer
auth, JSON control frames and binary media. **STILL OPEN.** Honestly and prominently disclosed in the
adapter's own module docstring, and correctly isolated (only this one file depends on the wire shape).
Needs validation against the real vendor contract before any tenant uses `alibaba-liveavatar` in
production.

**2. UX_GUIDELINES vs LLD conflict on purged transcripts.** UX_GUIDELINES says "a purged transcript
does not block feedback"; the LLD specifies a whole-response `410 TRANSCRIPT_PURGED` for
`GET /public/sessions/{id}/summary`, which necessarily blocks the feedback form. **STILL OPEN.**
Deliberately left unresolved by Phase 7 per instruction; still flagged in the plan doc. Needs an
architect/product decision, not a coding fix.

**3. No Playwright / axe-core e2e suite** for the 11 screens (HLD 8.3 step 5, NFR-4). **STILL OPEN.**
Grep-confirmed absent. CI's `e2e` job runs the backend integration suites instead and documents the
gap honestly.

**4. Phase 1 tenant-isolation e2e suite was "environment-blocked".** **RESOLVED - it runs and passes**
(1/1, real testcontainers Postgres 16). **But two new qualifications:**
(a) the suite is **not self-contained** - it sets `DATABASE_URL` itself but requires 8 more ambient env
vars (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `INTERNAL_TOKEN`, the JWT/bootstrap
secrets) that only CI's job-level `env` block supplies, so the documented
`pnpm --filter @liveavatar/api test:e2e` **fails on a clean local checkout**;
(b) it is **one test covering one route pair** (`GET`/`PATCH /api/tenants/:id`), while CI's own comment
and HLD 4.1 layer 5 describe it as covering "**every** tenant-scoped endpoint". Sessions, transcripts,
hops, config, credentials, alert-policy, dashboard, GPU and residency have **no** automated
cross-tenant regression test. I verified those six manually this pass and they behave correctly - but
nothing protects them from regressing.

**5. `k8s/` manifests never schema-validated against a real API server.** **STILL OPEN.** Docker
Desktop's Kubernetes is not enabled in this sandbox; no cluster was reachable. D-6 and D-7 were found
by manifest review and would very likely have been caught by an actual cluster deploy. A real
`kubectl apply --dry-run=server` remains a prerequisite for a first deploy.

**6. LiveKit at real scale.** `k8s/livekit.yaml` is a single-replica convenience manifest; HLD 8.2
wants StatefulSet/operator-managed. **STILL OPEN**, as DEPLOYMENT.md 6.4 already states. Use the
upstream Helm chart for production.

**7. No `GET /internal/health` route** on the `:8081` app; container liveness is inferred from the
entrypoint killing the container if either process dies. **STILL OPEN**, disclosed in DEPLOYMENT.md 7.
Reasonable as-is; finer-grained observability is a follow-up.

**8. `packages/contracts` has no tests.** Its `test` script is a stub
(`console.log('contracts: no unit tests in Phase 1')`) and CI's `contracts` job never invokes it.
**STILL OPEN, and mis-stated in two places.** `.github/workflows/ci-cd.yml:120` and DEPLOYMENT.md 4
both claim the Python-to-TypeScript agent-config contract test's "TypeScript sibling
(`packages/contracts/src/agent-config/schema.contract.spec.ts`)" runs in the `contracts` job.
**That file does not exist** - there are zero `.spec.ts` files anywhere in `packages/contracts`. Only
the Python half of the cross-language contract test actually runs.

**9. `docker-compose.yml` publishes `:8081` to the host.** Deliberate and disclosed; not a defect for a
local file. Worth a second look only because the file is titled "production-oriented" and an operator
could copy it toward a real host.

**10. Prior deploy pass's "the full 5-service up was blocked by a competing LiveKit container".**
**Superseded.** No competing container existed this pass; the real blockers were D-1 (config
placeholder) and D-5 (Windows UDP range).

---

## Defect list by severity

| ID | Severity | Summary | Originating phase |
|---|---|---|---|
| **D-1** | **Blocking** | LiveKit crash-loops on unsubstituted `__LIVEKIT_API_KEY__`; stack cannot start as documented (compose **and** k8s) | deployment |
| **D-2** | **Blocking (CI only)** | `agent` CI job fails `ruff format --check` (12 files) and `mypy src` (22 errors); gates e2e -> images -> deploy | cross-phase (Py 4-7 + deployment) |
| **D-6** | **Blocking (k8s only)** | NetworkPolicy blocks LiveKit to `web-internal:8081`; session-lifecycle webhooks silently die | deployment |
| **D-7** | **Blocking (k8s upgrades)** | Unlabeled `migrate` Job pod is denied Postgres egress by `default-deny-all` on every deploy after the first | deployment |
| **D-3** | Moderate | Tenant-existence enumeration oracle (403 vs 404) on `PATCH /tenants/:id` and `POST /tenants/:id/status` - explicit FR-TENANT-5 / HLD violation | Phase 1 |
| **D-4** | Moderate | `nest build` silently emits nothing with a stale `.tsbuildinfo`; root cause never fixed, only worked around for Docker | deployment |
| **D-5** | Rough edge | LiveKit's fixed 50000-50100/udp range overlaps Windows' ephemeral range, making `compose up` non-deterministic | deployment |
| **D-9** | **Blocking (CI only)** | `test:e2e` passes but never exits (open handle, no `forceExit`); both CI call sites would hang until job timeout | Phase 1 / deployment |
| **D-8** | Low | Validation failures return semantically wrong domain error codes (`IDEMPOTENCY_KEY_REUSED`, `AUTH_INVITE_INVALID`) | Phase 1/2 |

---

## Test hygiene

All QA-created artifacts were disposable and removed after the run: the `liveavatar-qa` compose
project (containers, volumes, network), the `.qa-tmp/` working directory (QA override file, adjusted
LiveKit config, webhook-signing script, e2e logs), and the root `.env` created for the compose run.
Dedicated test accounts (`qa-final@example.com`, `qa-tenant-a-admin@example.com`,
`qa-tenant-b-admin@example.com`) and tenants (`qa-tenant-a`, `qa-tenant-b`, `qa-idem-tenant`,
`qa-idem2`) existed only inside the disposable compose Postgres volume and were destroyed with it.
No production system was contacted at any point. `apps/api/.env` was deliberately not touched (it
belonged to a parallel QA agent's session). One host-level action was taken: Docker Desktop was
restarted after its WSL VM crashed under the agent image build.

### Post-run cleanup addendum (recorded after the hygiene note above)

Two items surfaced after the main teardown and are recorded here rather than left as an
overstated "everything was removed" claim:

1. **Orphaned testcontainers reaper.** My first tenant-isolation e2e attempt was killed mid-run
   (its output never flushed; it was superseded by the successful re-run that passed 1/1). It left a
   `testcontainers-ryuk-*` reaper container running. Confirmed it was mine (created 02:01:29, matching
   that run) and that **no** testcontainers-labelled data containers remained for it to reap, then
   removed it. No leftovers.
2. **A pre-existing container was collaterally stopped.** `liveavatar-livekit-1` (the
   `docker-compose.dev.yml` dev-mode LiveKit, which a prior QA pass explicitly reused read-only) was
   running at the start of this session and was stopped by the Docker Desktop restart I had to perform
   after its WSL VM crashed. It does not auto-restart. I **restarted it** once ports 7880/7881 were
   free again, restoring the host to its pre-session state. Flagged because a parallel agent may
   depend on it.

---

### D-9 — BLOCKING for CI (found post-run) — `test:e2e` never exits; both CI call sites would hang

- **Originating phase:** Phase 1 (the e2e harness) / deployment layer (which wired it into CI).
- **Expected:** `pnpm --filter @liveavatar/api test:e2e` runs the suite and the process exits.
- **Actual:** the suite runs, **passes**, prints its summary, then **hangs indefinitely**:

  ```
  Test Suites: 1 passed, 1 total
  Tests:       1 passed, 1 total
  Ran all test suites.
  Jest did not exit one second after the test run has completed.
  ```

  Every invocation in which the testcontainer actually started (3 of 4 this pass, including the
  passing run) had to be force-killed; it never self-terminated. The only run that exited cleanly was
  the one that failed *before* opening any handles ("Could not find a working container runtime").
- **Not a missing-teardown bug:** `tenant-isolation.e2e-spec.ts:92-95` does `await app?.close()` then
  `await container?.stop()`. The teardown code is present and looks correct — a residual handle
  (most likely the testcontainers/Ryuk control socket, and/or ioredis/BullMQ connections that
  `app.close()` does not drain) keeps the event loop alive. `test/jest-e2e.config.cjs` sets **no**
  `forceExit` and no `globalTeardown`, and `package.json`'s `test:e2e` script passes neither.
- **Corroborating symptom:** this same leak left an orphaned `testcontainers-ryuk-*` container running
  on the host after a killed run (see the cleanup addendum below).
- **CI impact:** `test:e2e` is invoked at **two** places — `.github/workflows/ci-cd.yml:87` (the `api`
  job) and `:168` (the `e2e` job's mandatory tenant-isolation negative suite). Both would hang after
  the tests pass, burning the runner until GitHub Actions' job timeout cancels them and marks the job
  failed. **This is a second, independent CI blocker alongside D-2.**
- **Fix direction:** find and close the residual handle (run with `--detectOpenHandles`); add
  `--forceExit` only as a stopgap, since it masks rather than fixes the leak.
- **Severity:** Blocking for CI. **No impact on product correctness** — the assertions genuinely run
  and pass, which is why every prior pass reported this suite as green without noticing it never exits.
