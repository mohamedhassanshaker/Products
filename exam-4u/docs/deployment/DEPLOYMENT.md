# ExamLand — Deployment Runbook (local / self-hosted docker-compose)

This is the runbook for the full-stack `docker-compose.yml` at the repo root, produced to close
Final Review defect **D3** ("nothing composes the application itself — only
`docker/docker-compose.dev.yml` and `docker/docker-compose.ai.yml` exist"). It covers: what's
actually being run, first-time setup, day-to-day start/stop, health verification, running the
mTLS smoke test against this stack, and troubleshooting. Kubernetes/Helm manifests and a CI/CD
pipeline are **out of scope for this pass** — this document is the docker-compose runbook only;
those are a separate deployment deliverable.

## 0. What this stack is (read this before anything else)

Per `docs/architecture/HLD.md` §13.1, ExamLand is **one application image, two runtime roles, no
separate frontend container**:

- `api` — `ROLE=api`, `node dist/api/main.js`. Serves `/api/**` (NestJS) **and** the built
  Angular SPA (everything else, SPA-fallback to `index.html`) on the **same port**. There is no
  nginx/frontend container and no reverse proxy in front of it in this local/self-hosted shape —
  `apps/web`'s own `HttpClient` calls use relative `/api/...` paths (same-origin), so this is not
  a simplification, it's the actual designed shape.
- `worker` — `ROLE=worker`, `node dist/api/worker.js`. The same image, no HTTP listener at all —
  runs the four background workers (`PdfPipelineWorker`, `OutboxPublisher`,
  `AttemptTimeoutSweeper`, `TenantMaintenanceWorker`) on their own ticks.
- `services/ai-engine` — a **second, independent, optional** image (Python/FastAPI). Only
  required if you want AI-powered features (PDF question generation, prompt practice, etc.).
  Everything else in the product works without it (HLD §8.4 — "AI-optional production deployment,
  no override flag needed").

Dependencies (MySQL 8.4, Qdrant, MailHog) come from the existing
`docker/docker-compose.dev.yml`, and the AI engine + its dev-only mTLS certificate authority come
from the existing `docker/docker-compose.ai.yml`. The root `docker-compose.yml` **includes both
of those files** (Compose's `include:` mechanism) and adds exactly the two services that were
missing: `api` and `worker`. Neither existing file was rewritten — only `docker-compose.ai.yml`
had two small, additive, non-behavioral changes (a `profiles: [smoke-test]` tag on
`mtls-smoke-test` so it doesn't auto-run as part of a normal `docker compose up`, and a corrected
usage comment — see that file's header for the D3-item-4 exit-code fix).

## 1. Prerequisites

- Docker Engine + Docker Compose v2 (`docker compose version` ≥ v2.20 — this repo was verified
  against Compose v5.3.1, which supports the `include:` top-level key used here).
- Nothing else needs to be installed locally — everything (Node, npm, the Angular CLI, Python)
  runs inside the containers.

## 2. First-time setup

```sh
# 1. Copy and fill in the environment file. At minimum set JWT_TENANT_SECRET,
#    JWT_PLATFORM_SECRET (must differ from each other), and FILE_SIGNING_SECRET — see the
#    generation hints inside .env.example. Everything else has a working default for a
#    fully-local, AI-disabled run.
cp .env.example .env
# edit .env now

# 2. Build the application image (api + worker share it) and, if you use --profile ai, the
#    AI engine image too.
docker compose build

# 3. Bring up just the stateful dependencies first (optional — `docker compose up` in step 5
#    brings everything up together with correct health-gated ordering anyway; this step is only
#    useful if you want to watch MySQL/Qdrant come up in isolation).
docker compose up -d mysql qdrant mailhog

# 4. Initialize the platform schema — REQUIRED, one-time (or after a fresh `docker compose down
#    -v`). This is a deliberate, explicit, operator-run step, not something that happens on
#    container boot: HLD §4.5 requires platform/tenant migrations to be applied "on API boot
#    (guarded by an advisory lock row) and via CLI" for the platform set specifically, and
#    tenant migrations are "CLI/ops endpoint only — never implicitly on boot" (this is what
#    Final Review's D1 finding was about — auto-migrating on every replica's boot would race
#    concurrent replicas against each other). Do not remove this step or fold it into the
#    container's own startup command.
docker compose run --rm api node dist/api/migrate-platform.js

# 5. Bring up the full stack.
docker compose up -d

# 6. Wait for readiness, then verify.
curl -s http://localhost:${API_HTTP_PORT:-3000}/api/health/ready | jq .
# Expect: {"status":"ok","checks":[{"name":"mysql","ok":true,...},{"name":"qdrant","ok":true,...},
#          {"name":"storage","ok":true,...},{"name":"worker","ok":true,...}],"ai":{"state":"disabled"},...}
# `ai.state` will be "disabled" unless you ran with --profile ai (see §5) — this is expected and
# never affects the overall `status` (HLD §8.4/NFR-10: an absent/dead AI engine must never pull an
# otherwise-healthy instance out of rotation).

# 7. Tenant schemas: there are none yet on a fresh platform (no tenants have been provisioned).
#    `migrate:tenants` is a no-op until you create your first tenant through the Platform Admin
#    API/console; run it again after provisioning a tenant, and again after every future release
#    that ships a tenant-schema migration:
docker compose run --rm api node dist/api/migrate-tenants.js --mode=halt-on-error
# Add --dry-run first in any environment you care about, per HLD §13.3's deploy sequence:
docker compose run --rm api node dist/api/migrate-tenants.js --dry-run

# 8. Seed a demo tenant so there's something to actually browse to (see "Why am I getting
#    TENANT_NOT_FOUND" below for why this step exists at all). Idempotent — safe to re-run, and
#    safe to leave out entirely if you're going to provision your own tenant via the Platform Admin
#    console instead.
docker compose run --rm api node dist/api/seed-demo-tenant.js
```

### Why am I getting `TENANT_NOT_FOUND` browsing to `http://localhost:3000`?

This is expected, not a bug, on a freshly-migrated platform with no tenants yet. Per HLD §4.2,
`TenantResolutionMiddleware` derives the tenant from the request's Host header whenever
`NODE_ENV=production`/`staging` (this compose stack's default) — exactly like a real deployment
would — so a request needs a subdomain label to resolve to anything. Step 8 above provisions a
convenience tenant at subdomain `demo` (override via `DEMO_TENANT_NAME`/`DEMO_TENANT_SUBDOMAIN`/
`DEMO_TENANT_ADMIN_EMAIL` in `.env` if you want a different name/slug/admin email — all optional,
see `.env.example`) through the real provisioning workflow
(`TenantProvisioningService.provisionNewTenant`, the same path `POST /api/platform/tenants` uses),
including seeding an invited Tenant Admin and sending them a real invite email via the bundled
MailHog service.

Once seeded, browse to **`http://demo.localhost:${API_HTTP_PORT:-3000}`** — not plain
`http://localhost:${API_HTTP_PORT:-3000}`, which has no subdomain label and will keep 404ing
`TENANT_NOT_FOUND` even after seeding. Every major browser resolves any `*.localhost` hostname
straight to loopback with zero hosts-file edits, so this works without any extra local DNS setup.
The seeded admin has no password yet — check **MailHog at `http://localhost:8025`** for the invite
email, then use "forgot password" on the tenant login page to finish setting up the account.

**Why `node dist/api/migrate-platform.js`, not `npm run migrate:platform`:** the runtime image
(`docker/Dockerfile`'s `runtime` stage) ships only the compiled `dist/` output and
production-only `node_modules` (no `ts-node`, no `src/`, no dev dependencies — see the `prod-deps`
stage). `npm run migrate:platform` shells out to `ts-node -T src/migrate-platform.ts`, which
cannot run inside this image. `nest build` already compiles `src/migrate-platform.ts` and
`src/migrate-tenants.ts` to `dist/migrate-platform.js`/`dist/migrate-tenants.js` (verified: they
exist in a real `npm run build:api` output), so invoking them directly with `node` is the correct
in-container equivalent and takes the identical CLI flags (`--mode=`, `--dry-run`, `--tenant=`).

## 3. First Platform Admin login

Two ways to get your first Platform Admin:

- **Bootstrap on boot (recommended for local use):** set `PLATFORM_ADMIN_BOOTSTRAP_EMAIL` and
  `PLATFORM_ADMIN_BOOTSTRAP_PASSWORD` in `.env` before step 5 above. This is idempotent (only
  inserts when the `platform_admin` table is empty), so it's safe to leave set across every
  restart. Then:
  ```sh
  curl -s -X POST http://localhost:${API_HTTP_PORT:-3000}/api/platform/auth/login \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$PLATFORM_ADMIN_BOOTSTRAP_EMAIL\",\"password\":\"$PLATFORM_ADMIN_BOOTSTRAP_PASSWORD\"}"
  ```
  A `200` with an access token confirms platform auth is fully working end to end (schema
  migrated, RBAC seeded, password hashing/verification correct).
- Leave the bootstrap vars blank and provision your first Platform Admin another way (out of
  scope here — no self-service Platform Admin registration endpoint exists by design, HLD §5.2).

From there, create your first tenant via the Platform Admin console (served at
`http://localhost:${API_HTTP_PORT:-3000}/` — same origin, no separate admin host locally since no
wildcard DNS is in play; `DEFAULT_TENANT_SUBDOMAIN` is what routes tenant-realm requests locally,
per HLD §13.2), then re-run `migrate:tenants` (step 7 above) to apply the tenant migration set to
the new schema.

## 4. Day-to-day operation

```sh
docker compose up -d          # start everything (idempotent)
docker compose logs -f api    # tail API logs (structured pino JSON)
docker compose logs -f worker # tail worker logs — look for worker.started, then periodic tick logs
docker compose ps             # container status + healthcheck state
docker compose down           # stop everything, keep volumes (DB data, Qdrant data, storage, logs)
docker compose down -v        # stop AND delete all volumes — full reset, next boot needs migrate:platform again
```

Rebuilding after a code change:

```sh
docker compose build api worker   # both share the same image/tag, one build covers both
docker compose up -d api worker
```

## 5. Running with the AI engine enabled

The AI engine (`services/ai-engine`) and its one-shot mTLS certificate generator (`certs-init`)
carry the Compose `ai` profile in this stack, so they are **not** started by a plain
`docker compose up`. To include them:

```sh
# In .env: AI_ENGINE=enabled, AI_SERVICE_TOKEN=<32+ random chars>, OPENROUTER_API_KEY=<your key>
docker compose --profile ai up -d --build
curl -s http://localhost:${API_HTTP_PORT:-3000}/api/health/ready | jq .ai
# Expect {"state":"ok"} (or "degraded" if the engine is still starting/unreachable — never
# affects overall readiness `status`)
```

`certs-init` generates a dev-only internal CA + two leaf certificates (engine server cert,
`examland-api` client cert) into the shared `examland_certs` volume on first run, and is
idempotent (skips regeneration if certs already exist — see
`docker/certs-init/generate-certs.sh`). The `api`/`worker` containers mount that same volume
read-only at `/etc/examland/tls`.

**This dev-CA/certs-init mechanism is explicitly local/CI-only** (per that script's own header
comment) — it is not how certificates should be provisioned in a real staging/production
Kubernetes deployment (that's cert-manager's job, HLD §8.3.1, and is a separate, not-yet-built
deliverable — see §7 below).

### Running the mTLS smoke test against this stack

`docker/docker-compose.ai.yml`'s `mtls-smoke-test` service (real TLS handshakes against the
containerized engine — no stubbing) carries the `smoke-test` profile. Run it standalone (its
original purpose, independent of whether the rest of the app stack is up) with the **canonical,
documented gate command** (Final Review D9 fix):

```sh
docker compose -f docker/docker-compose.ai.yml --profile smoke-test run --rm mtls-smoke-test
echo "exit code: $?"   # 0 = every mTLS invariant held, non-zero = a regression
```

`run --rm` automatically starts `mtls-smoke-test`'s own dependency chain (`certs-init`, then
`ai-engine`) and propagates the smoke-test container's own exit code directly as the command's
exit code — no `--exit-code-from` flag needed for this form. QA confirmed this deterministic
(6/6 passes, no false-fails) across repeated runs.

**Known-race alternative — do not use as the primary gate.** The previously-documented form,

```sh
docker compose -f docker/docker-compose.ai.yml --profile smoke-test up --build \
  --abort-on-container-exit --exit-code-from mtls-smoke-test
```

is timing-dependent: `--abort-on-container-exit` can trip on `certs-init`'s own *intentional*
successful exit (`certs-init-1 exited with code 0`) and abort the whole compose run before
`mtls-smoke-test` even starts, returning exit `127` with **zero checks executed** — QA reproduced
this at least once, with other runs of the identical command completing correctly, confirming the
race is real but not deterministic. Only use this form if you specifically need `up`'s
log-streaming behavior across multiple services at once, and never treat its exit code as
equivalent in reliability to `run --rm`'s.

**Final Review D3 item 4 fix, restated (applies to the `up` fallback form above):**
`--exit-code-from <service>` is required whenever a `docker compose up --abort-on-container-exit`
invocation is meant to gate a CI pipeline or any other automated check. Without it, `docker
compose up`'s own exit code is unrelated to which container failed — verified in this pass: a run
where `mtls-smoke-test-1 exited with code 1` still returned overall exit code `0` without the
flag, and correctly returned `1` with it. This convention applies equally to any future
smoke-test-shaped compose invocation in this repo, but does not fix the separate
`--abort-on-container-exit` race described above.

## 6. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `GET /api/tenant/public-config` (or any tenant-realm API call) returns `404 TENANT_NOT_FOUND` right after first boot, browser shows a blank/error page | Expected on a fresh platform with zero tenants — see §2 step 8 and "Why am I getting `TENANT_NOT_FOUND`" above. Run `docker compose run --rm api node dist/api/seed-demo-tenant.js`, then browse to `http://demo.localhost:${API_HTTP_PORT:-3000}` (not plain `localhost`). |
| `seed-demo-tenant.js` (or `POST /api/platform/tenants`) fails with `500 TENANT_PROVISIONING_FAILED`, step `create_schema`, reason `Access denied for user 'examland'@'%' to database 't_<slug>_...'` | **Fixed for fresh setups** via `docker/mysql-init/01-grant-tenant-schema-privileges.sql`, mounted into the `mysql` service as an additive `docker-entrypoint-initdb.d` script (see `docker-compose.yml`'s `mysql:` override block). **If you still hit this**, your `examland_mysql_data` volume was already initialized *before* this fix existed (init scripts only ever run once, on a container's first boot against a completely empty data directory — they never retroactively re-run against an existing volume). Fix without wiping any data: `docker compose exec mysql mysql -uroot -pexamland_dev_root -e "GRANT ALL PRIVILEGES ON \`t\_%\`.* TO 'examland'@'%'; FLUSH PRIVILEGES;"` — safe to run any number of times. (Wiping the volume with `docker compose down -v` also fixes it, but destroys all existing platform/tenant data — prefer the manual `GRANT` above.) |
| `docker compose run --rm api node dist/api/migrate-platform.js` fails to connect | MySQL not yet healthy — run `docker compose up -d mysql` first and wait for `docker compose ps` to show it `healthy`. |
| `/api/health/ready` returns `503` with `checks[].name=mysql,ok:false` | MySQL container not running/not reachable — check `docker compose logs mysql`. |
| `/api/health/ready` returns `503` with `checks[].name=worker,ok:false` (`"no worker heartbeat has ever been recorded"`) | The `worker` service isn't running, or hasn't started yet (`start_period`) — check `docker compose ps worker` and `docker compose logs worker` for `worker.started`. |
| `POST /api/platform/auth/login` returns `500` right after first boot | The platform schema hasn't been migrated yet — run step 4 in §2 (`migrate-platform.js`). This was Final Review's D1 finding; confirm you're on a build that includes `apps/api/src/migrate-platform.ts`. |
| `api`/`worker` container exits immediately with a zod "Invalid environment configuration" error | Check the message — it names every missing/invalid var. Most commonly `JWT_TENANT_SECRET`/`JWT_PLATFORM_SECRET`/`FILE_SIGNING_SECRET` not set in `.env`, or the two JWT secrets are identical (forbidden, HLD §5.1). |
| `docker compose --profile ai up` — `ai-engine` container exits immediately | Missing/invalid `OPENROUTER_API_KEY` (the engine fails closed at import per HLD §8.6) or `AI_SERVICE_TOKEN` shorter than 32 chars. Check `docker compose logs ai-engine`. |
| Image build fails while installing `bcrypt` | Should not happen with the current Dockerfile — `python3 make g++` are installed in the `deps`/`prod-deps` stages specifically so `bcrypt`'s native module compiles from source on `node:24-alpine` (musl has no prebuilt binary — this was Final Review D3 item 5). If you still see this, check `docker compose build --no-cache api` output for the actual compiler error. |
| Port already in use (3000/3306/6333/6334/1025/8025) | Something else on the host (or another compose project) is already bound to that port. Set `API_HTTP_PORT` in `.env` for the app's own port; the MySQL/Qdrant/MailHog ports are fixed in `docker/docker-compose.dev.yml` (not parameterized in that file) — stop the conflicting process, or run this stack under a different Compose project name (`docker compose -p <name> ...`) with your own port-remapping override file. |

## 7. What's intentionally NOT in this pass

- **Kubernetes/Helm manifests** for staging/production, and **cert-manager**-based mTLS
  provisioning (HLD §8.3.1/§13.1's "two images" Kubernetes shape). This runbook covers
  local/self-hosted `docker compose` only, per this pass's scope.
- **CI/CD pipeline wiring** (build/test/scan/push/deploy stages, registry, environment gating).
- **A production TLS-terminating edge/load balancer.** The app itself never terminates TLS (HLD
  §5.3 "Transport" — `trust proxy` + `X-Forwarded-Proto`); this compose stack is HTTP-only,
  suitable for localhost or a deployment where TLS is terminated by something in front of it
  (out of scope here).
- **Metrics/alerting for `outbox_dead_letters`** — pre-existing gap flagged by Dev-22/Final
  Review, unrelated to this deployment pass.

These remain open items for a later `nexus-deploy` pass (Kubernetes/Helm + CI/CD) and/or
`nexus-dev` (metrics surface), not silently resolved here.

## 8. Full environment variable reference

See `.env.example` at the repo root (every variable annotated) and, for the exhaustive
authoritative list with defaults and validation rules, `apps/api/src/config/env.schema.ts`. The
AI engine has its own separate variable set — see `services/ai-engine/.env.example`; the values
that must match between the two containers (`AI_SERVICE_TOKEN`, the mTLS CN) are wired directly in
`docker-compose.yml`'s `api`/`worker`/`ai-engine` service blocks, not left for the operator to keep
in sync by hand.
