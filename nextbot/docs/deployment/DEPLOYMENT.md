# NextBot — Deployment Guide

This covers the local docker-compose stack (the priority deliverable for this
phase), the lighter-pass Kubernetes manifests, and CI/CD. Read alongside
`docs/architecture/HLD.md` §7 and `docs/architecture/adr/0002-*.md` for the topology
decisions this implements (four deployables: `nextbot-web`, `nextbot-gateway`,
`nextbot-worker`, `nextbot-widget-embed` — `nextbot-runtime` and
`nextbot-gateway-agent` are reserved-but-unpopulated app scaffolds per Phase 0/the
current backlog scope, see "Known gaps" below).

> **2026-09-01 — deployment-drift audit (pre-Final-Review), by the Deployment
> agent.** `docker-compose.yml` and this file had not been touched since before
> Target Architecture Blueprint Phase 7a (Knowledge/Graph RAG) introduced a hard
> dependency on Neo4j — every dev/QA dispatch across Phases 7a–21 tested against
> `compose.test.yml`'s ephemeral `neo4j-test` stack, never this production-shaped
> file, which had no `neo4j` service at all. This pass found and fixed that gap
> (see "Neo4j / graph store" below), found and fixed a second, independently
> real gap in the same audit (the knowledge-upload local-disk store not being
> shared between the two containers that need it — see "Shared knowledge-upload
> storage" below), confirmed migration/ClickHouse coverage is genuinely current,
> and corrected a stale HLD claim about a deployable that was never built (see
> "apps/worker vs. the planned apps/ingest" below). Full detail in
> `docs/NEXUS_STATE.md`'s decision log under this same date.

> **2026-09-01 — DEFECT-1 fix (Final Review), by the Deployment agent.** Final
> Review's QA reproduced a hard HTTP 500 on every `Upload`-kind knowledge source
> against the real running `docker-compose.yml` stack: the "Shared
> knowledge-upload storage" fix above got the *sharing* half right (one named
> volume, `nextbot-knowledge-uploads-data`, mounted at the same path in both
> `web` and `worker`) but left the *ownership* half undone — neither
> `apps/web/Dockerfile` nor `apps/worker/Dockerfile` created/chowned that mount
> path before switching to `USER nextbot` (uid 1001), so Docker materializes a
> brand-new named volume as `root:root 0755` and `putUpload()`'s first
> filesystem call (a recursive `mkdir`) failed with `EACCES`. Fixed by adding a
> `RUN mkdir -p /data/knowledge-uploads && chown -R nextbot:nextbot
> /data/knowledge-uploads` step to both Dockerfiles before their `USER nextbot`
> line — the same pre-creation + chown pattern `docker/tools.Dockerfile` already
> used for its own `/seed-output` mount, so this doesn't introduce a new
> convention. Audited the rest of `docker-compose.yml`'s volume list against both
> app Dockerfiles for the same class of bug: no other volume is shared across
> containers running as a non-root user (`postgres`/`redis`/`clickhouse`/`neo4j`
> own their single-container volumes directly as their images' own default user;
> `nextbot-seed-output` is single-container and already had this exact fix; `web`
> and `gateway` mount no other volumes) — this was the only instance. The k8s
> path was already unaffected (`fsGroup: 1001` on both `deployment-web.yaml`/
> `deployment-worker.yaml` makes their `emptyDir` writable). Re-verified with a
> genuinely fresh `down -v` → `--build up`: `/data/knowledge-uploads` now shows
> `nextbot:nextbot` ownership in both containers, a real logged-in
> `POST /api/v1/admin/knowledge/upload` (real browser, real multipart file)
> returned `201` (not `500`), and the exact file it wrote was read back
> byte-for-byte from inside the `worker` container. Full evidence in
> `docs/NEXUS_STATE.md`'s decision log under this same date.

## 1. Local stack (docker compose)

**Important:** the repo already has a `compose.yaml` (infra-only: Postgres + Redis,
used for `pnpm dev` against locally-run Next dev servers) and a `compose.test.yml`
(ephemeral CI/integration-test infra). This phase adds **`docker-compose.yml`** at
the repo root — the full, production-shaped local stack (Postgres + Redis +
ClickHouse + Neo4j + all four containerized apps + one-shot migrate/seed jobs).
Docker
Compose's default file-discovery prefers `compose.yaml` when both exist in the same
directory, so **you must pass `-f docker-compose.yml` explicitly** (or `docker
compose --file docker-compose.yml`) — a bare `docker compose up` will bring up the
older infra-only file instead.

### Quick start

```bash
cp .env.docker.example .env.docker   # optional — every var has a working default
docker compose -f docker-compose.yml --env-file .env.docker up --build
```

**`--env-file .env.docker` is required, not optional (QA Final Review fix —
verified against the real stack):** every var in `docker-compose.yml`'s
`x-db-env`/`x-shared-env` anchors (`AI_*`, `NEXTBOT_DB_*`,
`NEXTBOT_SESSION_SECRET`, etc.) is substituted via `${VAR:-default}` **at
compose-file-parse time**, from whatever Docker Compose treats as its "project
env file" — which defaults to a plain `.env` in the repo root, **not**
`.env.docker`, regardless of the `env_file:` directive each service also
declares (`env_file:` only ever applies to a variable the `environment:` block
doesn't already enumerate — and it enumerates all of the above). Without
`--env-file .env.docker`, every edit you make to `.env.docker` for these vars
is silently ignored and every container gets the compose file's own hardcoded
placeholder defaults instead — this was confirmed by inspecting a real running
`gateway` container's environment during this fix's own verification: editing
`.env.docker`'s `AI_BASE_URL` had zero effect until `--env-file .env.docker`
was added to the `docker compose` invocation. Every command in this guide that
brings the stack up or rebuilds a service should include `--env-file
.env.docker` for the same reason (a repo-root `.env`, if one happens to exist
from `pnpm dev`'s Postgres/Redis-only workflow, would otherwise silently win
instead).

This will, in order:
1. Start `postgres`, `redis`, `clickhouse`, and **`neo4j`** (each with a
   healthcheck — see "Neo4j / graph store" below for what this service is and the
   real production-license prerequisite it carries).
2. Run the `migrate` one-shot job (`packages/db`'s migration runner — applies every
   `packages/db/migrations/*.sql` file, then idempotently creates/reconciles the
   `app`/`platform`/`gateway` Postgres roles ADR-0001 depends on). ClickHouse has
   no equivalent migration step — see "ClickHouse schema" below.
3. Run the `seed` one-shot job (`scripts/seed.ts`) once `migrate` exits 0 — creates
   the default demo tenant and one login per system role, then writes
   `SEED_CREDENTIALS.md` into the `nextbot-seed-output` named volume.
4. Start `web` (:3000), `gateway` (:4001), `worker` (no exposed port), and
   `widget-embed` (:8080), each depending on `migrate` having completed
   successfully and `redis`/`neo4j` being healthy.

### Neo4j / graph store

Target Architecture Blueprint Phase 7a (ADR-0018) gave `@nextbot/graph-store` a
hard dependency on Neo4j — one database per tenant, reached only by an
impersonated per-tenant restricted role (ADR-0018 §2.2). `docker-compose.yml` now
has a real `neo4j` service (it did not, from Phase 7a until this 2026-09-01
audit — see this file's own top-of-document note). It mirrors `compose.yaml`'s
(local-dev) and `compose.test.yml`'s (ephemeral CI) own `neo4j`/`neo4j-test`
services on image/auth/health shape, but persists to a real named volume
(`nextbot-neo4j-data`/`nextbot-neo4j-logs`) rather than `tmpfs`, matching how
`nextbot-postgres-data`/`nextbot-clickhouse-data` already persist.

**Neo4j Enterprise licensing — read this before deploying anywhere but a local/
throwaway environment.** This platform's tenant-isolation design for the graph
store (ADR-0018 §2.2: one database per tenant, RBAC + user impersonation to reach
it) is genuinely impossible on Neo4j **Community** Edition — Community supports
exactly one database and no RBAC/impersonation at all, which was confirmed during
Phase 7a's own QA pass (`docs/NEXUS_STATE.md`'s Phase 7a decision-log entry) as a
hard capability gap, not a preference. `docker-compose.yml`'s `neo4j` service (like
`compose.yaml`'s and `compose.test.yml`'s) runs the `neo4j:5-enterprise` image
under `NEO4J_ACCEPT_LICENSE_AGREEMENT=yes` — Neo4j's own documented mechanism for
running that image under its **evaluation/development** licence terms. **This is
legitimate for local testing and CI, but it is NOT a production license.**
A real production deployment of this stack requires a genuinely purchased Neo4j
Enterprise commercial license (ADR-0018 §4's disclosed, budgeted cost) —
provision that license, and point `NEO4J_AUTH`/the `GRAPH_STORE_ADMIN_*` env vars
at a properly-licensed instance/cluster, before taking this compose file (or the
`k8s/` manifests) anywhere near real tenant data. This is a real, non-trivial
recurring cost an operator must budget for, not a checkbox to click past.

**New env vars** (see `.env.docker.example` for the full comments):
`GRAPH_STORE_PROVIDER`, `GRAPH_STORE_URL`, `GRAPH_STORE_ADMIN_USER`/
`GRAPH_STORE_ADMIN_CREDENTIAL_REF` (the Neo4j superuser — DBMS-admin operations
only), `GRAPH_STORE_SERVICE_USER`/`GRAPH_STORE_CREDENTIAL_REF` (the lower-
privilege credential the app actually queries as — auto-created on first tenant
provisioning, not a pre-existing Neo4j user), `GRAPH_STORE_DATABASE_PREFIX`.
`NEO4J_PASSWORD` sets the Neo4j superuser's password consistently between the
`neo4j` service's own `NEO4J_AUTH` and `GRAPH_STORE_ADMIN_CREDENTIAL_REF` — change
it in `.env.docker` for anything beyond a throwaway local run.

No separate bootstrap step is needed for the service user or any tenant's
database/role/user: `packages/graph-store/src/provisioning/
tenant-database-provisioner.ts`'s `ensureTenantGraphDatabase()` (called by
`apps/worker`'s `tenancy.graph-provisioning-reconcile` job, a 5-minute sweep) is
fully idempotent and creates everything — the shared service role/user on first
call, each tenant's database/role/user on that tenant's first knowledge
collection build.

### Shared knowledge-upload storage

A second, independently real gap found during this same audit: `packages/modules/
knowledge/src/infrastructure/upload-store.ts` (Phase 7b) is a minimal local-disk
upload store, and its root path (`KNOWLEDGE_UPLOAD_STORE_ROOT`) was previously
unset — every service defaulted to its own container-local `.data/
knowledge-uploads`. That's harmless for a single container, but `web`'s admin
upload route (`putUpload`) and `worker`'s ingestion-pump pipeline (`getUpload`, in
`stage-ingest-parse-chunk.ts`) run in **two separate containers** — without a
shared path, `worker` could never find a file `web` had just written, and every
`Upload`-kind knowledge source would fail ingestion with a spurious "file not
found". Fixed here by pointing `KNOWLEDGE_UPLOAD_STORE_ROOT` at a new shared named
volume (`nextbot-knowledge-uploads-data`), mounted at the same path in both `web`
and `worker`. This works cleanly in `docker-compose.yml` (single host, one Docker
volume, both containers can mount it) — see "Known gaps" below for why the
equivalent `k8s/` fix is only a partial one.

**DEFECT-1 (Final Review) — ownership, not sharing, was the remaining gap.** The
volume-sharing fix above is necessary but was not sufficient: Docker materializes
a brand-new named volume as `root:root 0755`, and both `apps/web/Dockerfile` and
`apps/worker/Dockerfile` run their app as `USER nextbot` (uid/gid 1001) — without
explicitly creating and chowning the mount path first, `putUpload()`'s very first
filesystem call (a recursive `mkdir` under `/data/knowledge-uploads/<tenantId>`)
failed with `EACCES`, a hard 500 on every `Upload`-kind knowledge source. Fixed by
adding `RUN mkdir -p /data/knowledge-uploads && chown -R nextbot:nextbot
/data/knowledge-uploads` to both Dockerfiles before their `USER nextbot` line
(matching the pre-creation + chown pattern `docker/tools.Dockerfile` already uses
for its own `/seed-output` mount). See the top-of-document 2026-09-01 DEFECT-1 note
for the real re-verification performed.

Bring it down (keeping data): `docker compose -f docker-compose.yml down`
Bring it down and wipe all state: `docker compose -f docker-compose.yml down -v`

### Seeded credentials

The `demo` tenant is created with one user per system role (see
`packages/modules/iam/src/domain/system-roles.ts`), all with the same password so
you only need to remember one thing:

| Role | Email | Password |
|---|---|---|
| Tenant Admin | admin@demo.nextbot.local | `NextbotDemo!2026` |
| Backend System Owner | backend-owner@demo.nextbot.local | `NextbotDemo!2026` |
| Designer | designer@demo.nextbot.local | `NextbotDemo!2026` |
| Platform Engineer | platform-engineer@demo.nextbot.local | `NextbotDemo!2026` |
| Escalation Agent | escalation-agent@demo.nextbot.local | `NextbotDemo!2026` |
| Read-Only | read-only@demo.nextbot.local | `NextbotDemo!2026` |

**Tenant slug (the login form's "Tenant" field): `demo`.**

The same table is written to `SEED_CREDENTIALS.md` inside the `nextbot-seed-output`
volume on every `docker compose up` (idempotent — re-running never duplicates data
or fails). To read it from the host:

```bash
docker compose -f docker-compose.yml run --rm --no-deps -v nextbot-seed-output:/seed-output --entrypoint cat tools /seed-output/SEED_CREDENTIALS.md
```

(or simpler: `docker run --rm -v nextbot_nextbot-seed-output:/d alpine cat /d/SEED_CREDENTIALS.md`
— the volume name is prefixed with the compose project name, `nextbot_` by default).

Re-running the seed job manually at any point (e.g. after a fresh `down -v`):

```bash
docker compose -f docker-compose.yml --env-file .env.docker run --rm seed
```

### Reaching each surface

| Surface | URL |
|---|---|
| Admin Console (all 5 portals — login first) | http://localhost:3000/login |
| Platform Manager console (NFR-11, cross-tenant operator surface — see below) | http://localhost:3000/internal/ops/login |
| Gateway Plane (widget/channel API, not meant for direct browsing) | http://localhost:4001/ |
| Widget test embed (iframe SPA directly) | http://localhost:8080/widget/index.html |
| Widget loader script (what a host page would `<script src=...>`) | http://localhost:8080/loader/nextbot.js |

Both `web` surfaces above (Admin Console and Platform Manager console) are now
reached through the `web-proxy` service, not `web` directly — `web` no longer
publishes a host port itself (see "Testing the Platform Manager console locally").

There is no separate Developer Portal deployable in this MVP scope (BL-level
Developer Portal is Phase 3-5/deferred per the backlog) — the Admin Console at
`/settings/integrations` etc. is the only portal surface today.

### AI provider configuration

The AI subsystem (ADR-0006) is fully env-driven (`AI_PROVIDER`, `AI_MODEL_*`,
`AI_BASE_URL`, `AI_API_KEY` — see `.env.docker.example`). Only **two** vars are
genuinely required for `@nextbot/ai-registry` to pass its own startup validation:
`AI_PROVIDER` and `AI_MODEL_CHAT_PRIMARY` — both of which `docker-compose.yml`
already defaults (`openai-compatible` / `local-placeholder-model`). Every other
`AI_*` var (`AI_BASE_URL`, `AI_API_KEY`, and the five non-primary
`AI_MODEL_CHAT_FAST`/`AI_MODEL_REASONING_PLANNER`/`AI_MODEL_CLASSIFY_GUARDRAIL`/
`AI_MODEL_SUMMARIZE`/`AI_MODEL_EMBED`) is genuinely optional — `docker-compose.yml`
defaults each of these to the empty string via `${VAR:-}` when you haven't set it
in `.env.docker`, and `@nextbot/ai-registry`'s config loader treats an empty
string identically to "unset" for every optional field, so this does not fail
startup validation. These placeholder defaults let **every non-AI flow work
fully** — login, all 5 Admin Console portals, connector/tool/channel
configuration, the widget's static assets — because env validation is lazy
(only enforced the first time an agent-run actually needs a model call), and
`AI_BASE_URL` defaults to a would-be local Ollama endpoint that simply won't be
reachable until you point it somewhere real.

To exercise a real conversation, set `AI_BASE_URL`/`AI_API_KEY`/
`AI_MODEL_CHAT_PRIMARY` (and optionally the other `AI_MODEL_*` vars, if you want
distinct models per logical name rather than every logical name falling back to
`AI_MODEL_CHAT_PRIMARY`) to a real OpenAI-compatible endpoint (a hosted provider,
or a local Ollama/vLLM/LM Studio instance) in `.env.docker`, then
`docker compose -f docker-compose.yml --env-file .env.docker up -d --force-recreate gateway` (the Model
Gateway/`mcp-egress` logic lives in `apps/gateway`).

### Logs / operational notes

- Tail one service: `docker compose -f docker-compose.yml logs -f web` (or
  `gateway`, `worker`, `widget-embed`, `web-proxy`, `postgres`, `redis`,
  `clickhouse`, `neo4j`).
- Re-run migrations only: `docker compose -f docker-compose.yml --env-file .env.docker run --rm migrate`.
- Full reset (wipes Postgres/Redis/ClickHouse/Neo4j volumes and the seed-output/
  knowledge-uploads volumes):
  `docker compose -f docker-compose.yml down -v && docker compose -f docker-compose.yml --env-file .env.docker up --build`.
- Rebuild a single app after a code change: `docker compose -f docker-compose.yml --env-file .env.docker up --build web`.

### Migration coverage

`packages/db/src/bootstrap/migrate.ts` → `run-sql-migrations.ts` is a genuinely
generic runner: it `readdir`s `packages/db/migrations/`, applies every `*.sql`
file found there in filename-sorted order, tracks each in a
`_migrations_applied` bookkeeping table, and skips anything already applied —
there is no hardcoded file list to fall out of sync. Confirmed current as of this
audit: 91 numbered migrations (`0001` through `0091`) on disk, matching the count
the `migrate` job actually applies (see "What was actually verified" below for the
real, fresh-database run). No action needed here beyond this confirmation.

### ClickHouse schema

ClickHouse (ADR-0008) has no separate migration set, and this is by design, not a
gap: its one table, `agent_run_span`, is provisioned by the application itself —
`packages/db/src/clickhouse.ts`'s `ensureSchema()` runs an idempotent
`CREATE TABLE IF NOT EXISTS` the first time any process writes or reads a span,
already disclosed in that file's own module doc comment as a deliberate bridge
(Phase 13) until a real OTel Collector is stood up. Nothing needs to be added to
the `migrate` job or a new ClickHouse-specific job for this to work — confirmed
by inspection of every ClickHouse-touching module in this codebase (only
`packages/db/src/clickhouse.ts` defines a table).

### apps/worker vs. the planned apps/ingest

The HLD (§15.3.2, §15.3.3, §15.8) and LLD (§2.7, §15.3.2, and several other
passages) both describe a fifth deployable, `nextbot-ingest`/`apps/ingest`, sized
for the knowledge ingestion pipeline's distinct resource profile (long,
CPU/memory-heavy, bursty jobs, vs. `apps/worker`'s short reconciliation sweeps).
**That deployable was never built.** `apps/ingest` does not exist as a directory
anywhere in this repository. Phase 7b's actual implementation ships the pipeline's
three scheduled jobs (`knowledge.ingestion-pump`, `knowledge.lease-reaper`,
`knowledge.source-sync`) inside `apps/worker` instead, registered in its existing
`ScheduledJob` scheduler (`apps/worker/src/index.ts`'s `startWorker()`) — this was
disclosed by the dev agent at the time, not discovered fresh by this audit
(`packages/modules/knowledge/README.md`'s "Disclosed scope decisions" §1,
`apps/worker/src/index.ts`'s own inline comment above the three `knowledge.*`
registrations). What this audit *did* newly do: confirm the HLD's own §15.3.2/
§15.3.3 text still asserted a fifth image as built (it did, uncorrected, across
21 phases) and add a dated correction there (see `docs/architecture/HLD.md`
§15.3.2's new correction block) so the next reader of the HLD isn't misled into
thinking a deployable exists that this deployment guide's own `docker-compose.yml`
and `k8s/base/` never had to (and don't) build.

**Is `apps/worker`'s current resource allocation adequate for its now much larger
job roster?** `apps/worker/src/index.ts`'s `startWorker()` currently registers 24
recurring jobs (up from the 5 Phase 18 originally sized `apps/worker`'s resources
for): `agent-platform.git-sweep`, `conversation.idle-sweep`, `audit.outbox-sync`,
`mcp.health-check`, `tenancy.retention-purge`, `mcp.manifest-reconcile`,
`model-gateway.provider-probe`, `model-gateway.catalog-sync`,
`tenancy.graph-provisioning-reconcile`, `knowledge.ingestion-pump`,
`knowledge.lease-reaper`, `knowledge.source-sync`, `knowledge.retention-purge`,
`eval.continuous-run`, `escalation.sla-sweep`, `approvals.expiry-sweep`,
`workflow.run-pump`, `workflow.lease-reaper`, `workflow.suspension-expiry-sweep`,
`deployment.shadow-run-pump`, `deployment.shadow-lease-reaper`,
`webhooks.dispatch`, `telemetry.otel-metrics-export`, `telemetry.siem-export` —
several of which are genuinely heavier than the original five (the knowledge
ingestion pipeline's parse/chunk/embed/community-detection stages; the workflow
and deployment-shadow pumps, which advance real durable state machines and make
real provider round-trips every 5 seconds; not just idempotent reconciliation
sweeps). `docker-compose.yml` itself sets no per-service resource limits for any
service (consistent with every other service in that file — not singled out), so
no change was made there. **`k8s/base/deployment-worker.yaml`'s resource
requests/limits were bumped** (250m/256Mi requests, 1/512Mi limits →
500m/512Mi requests, 2/1536Mi limits) as a reasoned-headroom adjustment — no load
test was run in this environment to derive an exact figure, so treat this as a
starting point to tune against real ingestion/workflow volume, not a measured
final answer. `apps/worker/Dockerfile` itself needed no change (still the same
`tsx src/main.ts` single-process convention, no HTTP surface, `pgrep`-based
liveness check — unaffected by which jobs are registered inside that one
process).

## 2. What was actually verified (not just "should work")

Performed directly in this environment, against real containers, not assumed:

1. `apps/web/next.config.mjs` and `apps/gateway/next.config.mjs` were updated to
   `output: "standalone"` (+ workspace-root `outputFileTracingRoot`) so the Docker
   runtime stage ships only the traced server bundle, never the full monorepo
   `node_modules`/source tree — verified by a real `docker build` of both images
   (see below), not just reading the config.
2. `docker build -f apps/web/Dockerfile .`, `apps/gateway/Dockerfile`,
   `apps/worker/Dockerfile`, and `apps/widget-embed/Dockerfile` — **all four built
   successfully** end-to-end (pnpm/turbo prune → install → build → slim runtime),
   including the Next.js production build actually compiling and type-checking
   every route (60 routes for `web`, 9 for `gateway`) and the Vite widget/loader
   builds producing real `dist-widget`/`dist-loader` output copied into the nginx
   image.
3. `docker compose -f docker-compose.yml config` validated the compose file
   (services, YAML anchors, env-var interpolation) with no errors.
4. Ran the real migration path against a live Postgres container
   (`pnpm --filter @nextbot/db run migrate`): **26/26 migrations applied**, and
   `ensure-roles.ts` created the `app`/`platform`/`gateway` Postgres roles.
5. Ran `scripts/seed.ts` (`pnpm run db:seed`) against that same live database:
   provisioned the `demo` tenant, seeded all 6 system roles, and registered all 6
   demo users — confirmed by real rows in Postgres, not a dry run.
6. **Re-ran the seed script a second time** against the already-seeded database to
   confirm idempotency: it correctly detected the existing tenant/roles/users and
   skipped re-creating them (no duplicate-row errors, no crash).
7. `kubectl kustomize k8s/overlays/dev` rendered the full manifest set with no
   errors (validates the kustomization/resource wiring is at least structurally
   correct); no live cluster was available in this environment to `kubectl apply`
   against, so the k8s path is verified only at the "renders correctly" level, not
   "runs correctly" — see "Known gaps".
8. **`docker compose -f docker-compose.yml up -d` was run for real**, end to end,
   against the actual compose network (not the host dev server): `postgres`,
   `redis`, `clickhouse` came up; `migrate` ran inside its own container and
   applied all 26 migrations against the compose-networked Postgres; `seed` ran
   after it and produced the same `demo` tenant + 6 role logins, writing
   `SEED_CREDENTIALS.md` into the `nextbot-seed-output` named volume (confirmed by
   reading the file back out of the volume with a throwaway container, not just
   trusting the log line); `web`, `gateway`, and `widget-embed` all reported
   Docker-healthy, and were confirmed reachable from the host over real HTTP:
   `GET /login` (web) → 200, `GET /` (gateway) → 200, and both widget static
   endpoints (`/loader/nextbot.js`, `/widget/index.html`) → 200. The rendered
   `/login` HTML was inspected directly and correctly contains the tenant/email/
   password fields and "Sign in to NextBot" heading.
9. Two real, container-specific bugs were caught and fixed by this process, not
   just written and assumed correct: (a) every Dockerfile's `pnpm add -g turbo`
   step failed with `ERR_PNPM_NO_GLOBAL_BIN_DIR` until `PNPM_HOME`/`PATH` were set
   before `corepack prepare`; (b) the non-root `worker`/`tools` containers crashed
   with `EACCES` the first time they invoked `pnpm` at runtime, because the
   non-root user had no writable `$HOME` for corepack's cache — fixed by creating
   a real home directory and scoping the ownership fix narrowly (a recursive
   `chown` over the full, unpruned `node_modules` was originally attempted and
   found to make every build/rebuild take several extra minutes; scoping it to
   just the working directory + home directory fixed both the permission error
   and the slow rebuild).

**Follow-up verification pass (closing the two gaps above) — both now genuinely
confirmed against the real running compose stack, not just claimed:**

10. **`apps/worker`'s image rebuilt and confirmed healthy.** The Dockerfile fix
    from point 9(b) (writable non-root `$HOME`) turned out to be necessary but not
    sufficient: `apps/worker/Dockerfile` still had `chown -R nextbot:nextbot /app
    /home/nextbot` — a *recursive* chown over the pruned monorepo's multi-GB
    `node_modules`, which on this Docker Desktop/Windows host made every
    build/rebuild hang for 15-20+ minutes on that single step (this is exactly
    the cost `docker/tools.Dockerfile`'s own doc comment already warned about,
    but the lesson hadn't been applied to `apps/worker/Dockerfile`). Removed the
    recursive chown entirely — `useradd --create-home` already makes
    `/home/nextbot` owned by `nextbot`, and pnpm-installed files under `/app` are
    already world-readable, so nothing else needed it. Rebuild after the fix
    completed in under 30 seconds. `docker compose -f docker-compose.yml up -d
    worker` now starts a container that reaches Docker `healthy` and stays there
    (no restart loop); its logs show `NextBot worker: scheduler started.`
    followed by all five Phase 18 recurring jobs actually registering and
    completing on their first tick: `agent-platform.git-sweep`,
    `conversation.idle-sweep`, `audit.outbox-sync`, `mcp.health-check`, and
    `tenancy.retention-purge` — confirmed via `docker compose logs worker`, not
    inferred from a healthy status alone.
11. **A real Playwright browser session against the actual running containers**
    confirmed the full login round-trip: `admin@demo.nextbot.local`,
    `designer@demo.nextbot.local`, and `read-only@demo.nextbot.local` (tenant
    slug `demo`, password `NextbotDemo!2026`) each land on a real authenticated
    `/dashboard` (not `/login`), with role-appropriate nav differences —
    Designer's sidebar shows only the Agent Platform section (Definitions,
    Evals, Model Gateway, Runtime Traces) plus the shared operational items,
    while Read-Only and Tenant Admin both see the full settings/admin section
    (Users & Roles, Branding, Audit Log, PII & Guardrails, Retention &
    Residency, Data Subject Requests) — i.e. RBAC-driven nav gating is real
    against the actual running containers, not just in dev-server testing (note:
    Read-Only seeing the same nav breadth as Tenant Admin is plausibly correct —
    "read-only" access to the full admin surface rather than a smaller surface —
    but wasn't independently verified at the per-action/write level here; flagged
    for the app team to confirm intent, not a deployment-layer concern).
    The **embeddable widget** was also spot-checked with a real seeded channel:
    created a live "Demo Web Widget" `WebWidget` channel via the Admin Console UI
    (Channels → Add Web Widget Channel) to get a real `channelId`
    (`publicKey`)/`tenantId` (slug) pair, then loaded
    `http://localhost:8080/widget/index.html?tenantId=demo&channelId=<publicKey>`
    in a real browser: the launcher button renders, calls the real gateway to
    create a widget session (brief loading spinner, no console errors), and
    clicking it opens a fully rendered chat window ("Welcome 👋", message input,
    "Powered by NextBot" footer) — the widget is not just serving a 200 on its
    static assets, it actually initializes end-to-end against the gateway
    container. (Loading the widget with no `tenantId`/`channelId` query params at
    all correctly renders nothing per `WidgetApp.tsx`'s fail-closed check,
    FR-OC-01 — that blank page is by design, not a bug; a real channel is
    required to see the rendered widget, which is why one didn't exist in the
    seed data and had to be created for this check.)
12. **A real, unrelated deployment bug found and fixed while verifying the
    above:** the `clickhouse` service had been reporting Docker `unhealthy` for
    the entire session, for two compounding reasons, both now fixed. First, the
    ClickHouse server's default config listens on the IPv6 wildcard (`::`); on
    this Docker network (IPv6 disabled/unsupported), that bind failed outright
    (`DNS error: EAI: Address family for hostname not supported`) and the server
    never listened on any port at all — fixed by mounting
    `docker/clickhouse/listen-ipv4.xml` (`<listen_host>0.0.0.0</listen_host>`,
    `replace="replace"`) into `/etc/clickhouse-server/config.d/`. Second, even
    after that fix the healthcheck itself (`wget http://localhost:8123/ping`)
    still failed, because the container's `/etc/hosts` resolves `localhost` to
    `::1` before `127.0.0.1` and ClickHouse (correctly, per fix one) no longer
    listens on IPv6 at all — fixed by pointing the healthcheck at `127.0.0.1`
    explicitly instead of `localhost`. `clickhouse` now reaches and stays at
    Docker `healthy` on a clean `docker compose up`. (This may be specific to
    this Docker Desktop/Windows host's IPv6 configuration rather than universal
    — but the fix is a strict improvement either way: IPv4 wildcard + explicit
    `127.0.0.1` healthcheck work regardless of host IPv6 support.)

Both gaps from the prior pass are now closed with real evidence (container logs,
screenshots), not assumption. No further known gaps remain for the docker-compose
path; the Kubernetes "renders but not applied to a live cluster" caveat from point
7 still stands (out of scope for this environment).

**Platform Manager console verification pass (this dispatch) — real HTTP/browser
verification, not assumed:**

13. **`docker compose -f docker-compose.yml down -v` then a genuinely fresh
    `--build up`** (empty volumes, rebuilt images): all 31 migrations applied
    (`0001`–`0031`, including the two added since this file was last touched —
    `0030_platform_audit_log.sql`/`0031_plan_tier_definition.sql`), `seed` created
    the `demo` tenant + all 6 role logins, and `plan_tier_definition` was queried
    directly in the running Postgres container — its three rows (`Starter`/
    `Growth`/`Enterprise`) match `PLAN_TIER_DEFAULTS`
    (`packages/modules/tenancy/src/domain/plan-tier-defaults.ts`) byte-for-byte, as
    the migration's own seed `INSERT` promises. `web`, `gateway`, `worker`,
    `widget-embed`, and the new `web-proxy` service all reached Docker `healthy`.
    Two build-time flakes were hit and self-resolved on retry (both external-network
    timeouts unrelated to this change: `sqlite3`'s `prebuild-install` timing out
    fetching a prebuilt binary — pre-existing in every image that transitively
    depends on it — and `apps/web`'s Next.js font-optimization step failing to
    reach `fonts.googleapis.com` mid-build); neither recurred on the next `--build`
    thanks to BuildKit layer caching. Approximate wall-clock for a fully fresh
    `down -v` → healthy stack in this environment: **~8 minutes**, dominated by
    `pnpm install`/Next.js build steps already present before this change, not by
    anything added here.
14. **Real HTTP via a Playwright browser session against the actual containers**
    (not the dev server): logged into the regular Admin Console
    (`admin@demo.nextbot.local` / `NextbotDemo!2026`, tenant `demo`) and landed on
    a real authenticated `/dashboard` — unchanged from the prior verification pass,
    now additionally proven to still work **through the new `web-proxy` hop**
    (previously `web` was reached directly).
15. **Real HTTP via the same technique against the Platform Manager console**:
    `GET /internal/ops/login` renders the operator-token form; submitting the
    default generated token (see below) redirects to `/internal/ops/tenants`,
    which renders the real seeded `demo` tenant row (not a fixture/mock). The
    Health screen (`/internal/ops/health`) and Plan Tiers screen
    (`/internal/ops/plan-tiers`, showing `Starter`/`Growth`/`Enterprise`) were both
    loaded and rendered real data in the same authenticated session.
16. **Negative/security checks, all confirmed rather than assumed:**
    - A wrong operator token submitted through the real login form is rejected
      (stays on the login form; no session cookie issued).
    - `GET` on the console's real internal route path directly
      (`/internal/ops/nb-c-4f21c8a7e3d9b605/login`) 404s **byte-identical** to a
      control nonexistent path (`/internal/ops/tenants` fetched with no session
      cookie from the console's own internal route directly, and an unrelated
      random path both compared: same status, same content length, same body) —
      confirmed with a raw `fetch` from inside another container, not just a
      browser, so no client-side redirect masked the real response.
    - **The header-spoofing bypass QA's retry 1 pass fixed once already does not
      regress**: sending `X-Forwarded-For`/a forged value through the real host
      entry point (`http://localhost:<port>/internal/ops/login`, i.e. through
      `web-proxy`) has **no effect** — `web-proxy` always overwrites (never
      appends to) that header from its own observed connection before forwarding,
      confirmed by sending several different forged values from `curl` on the
      host and observing identical behavior regardless of what was sent.
    - **Residual gap, disclosed rather than hidden** (see "Known gaps" below): a
      request sent directly to `web:3000` from *another container already inside
      this same compose network* (bypassing `web-proxy` entirely) can forge
      `X-Forwarded-For: 172.30.238.1` and pass the IP-allowlist check, reaching
      the login *page* — confirmed with a raw `fetch` from the `gateway`
      container. This does **not** grant access to any tenant data: the operator
      token (`verifyOperatorToken`, a 256-bit random secret, `crypto.timingSafeEqual`
      digest comparison) is a wholly independent check untouched by any of this
      networking, so this residual only reduces disclosure-control strength
      (revealing the login page's existence to a co-located container), never
      the actual access control. This exists because Docker's default bridge
      network has no way to restrict which containers may reach which — it is not
      something this local topology can close without adding real network
      segmentation, which is out of scope for a local-testing convenience.

**2026-09-01 deployment-drift audit — real verification, this pass's own gap fixes:**

17. **A genuinely fresh `docker compose -f docker-compose.yml down -v` →
    `--build up`, from an EMPTY database and empty volumes, run for real against
    this environment's actual Docker daemon** (not assumed): `postgres`, `redis`,
    `clickhouse`, and the new `neo4j` service all reached Docker `healthy`;
    `migrate` exited 0 having applied **all 91/91 migrations**
    (`@nextbot/db: applied 91 migration(s), roles ensured.` — the real log line,
    not a paraphrase); `seed` exited 0; `web`, `gateway`, `worker`,
    `widget-embed`, and `web-proxy` all reached Docker `healthy`. Real HTTP
    confirmed against the running containers: `GET /login` (through `web-proxy`)
    → 200 with "Sign in to NextBot" actually present in the rendered HTML,
    `GET /` (gateway) → 200, both widget static endpoints → 200.
18. **The Neo4j/graph-store wiring was confirmed working end to end, not just
    "container is healthy."** `docker logs worker` showed
    `tenancy.graph-provisioning-reconcile` completing with `strandedCount: 0` on
    its very first tick (no connection/auth error to the new `neo4j` service) —
    and querying Neo4j directly (`cypher-shell -u neo4j -p ... "SHOW DATABASES"`
    against the real running `neo4j` container) showed a real, distinct per-tenant
    database already created for the seeded `demo` tenant
    (`t-01a05a9273697b1f9700187160fc8243`, alongside the system `neo4j`/`system`
    databases) — i.e. `ensureTenantGraphDatabase()`'s full idempotent
    provisioning chain (service role/user bootstrap → per-tenant database/role/
    user → grants → indexes/constraints) ran for real against a real Neo4j 5
    Enterprise container, not mocked.
19. **A real, previously-latent bug was found and fixed by this exact
    verification process, not assumed away:** adding the `neo4j` service as an
    8th Compose-managed dynamically-addressed container shifted Docker Compose's
    sequential low-to-high IPAM allocation such that `web` (on the first fresh
    `up`) and then `gateway` (on a second fresh `up`, confirming the collision
    was non-deterministic across runs, not a one-off) were assigned
    `172.30.238.10` — an exact collision with `web-proxy`'s static IP pin, which
    made `web-proxy` fail to start outright (`Error response from daemon: failed
    to set up container networking: Address already in use`), silently breaking
    the ONLY published entry point to `web`/the Platform Manager console. Fixed
    by re-pinning `web-proxy` to `172.30.238.250` (near the top of the `/24`
    range, deliberately robust against future services being added the same way
    this one was, unlike a low pinned address) — re-verified with another
    genuinely fresh `down -v` → `up`: `web-proxy` started and reached `healthy`
    cleanly, `gateway` landed on the now-unclaimed `.10`, and a real `curl`
    against `http://localhost:3000/login` through `web-proxy` both returned 200
    with the correct page content AND logged the expected `172.30.238.1` source
    address (the pinned network's gateway address — confirming
    `NEXTBOT_OPS_IP_ALLOWLIST`'s default still matches reality after the
    re-pin).

**2026-09-01 Final Review DEFECT-1 fix — real verification:**

20. **A genuinely fresh `docker compose -f docker-compose.yml down -v` →
    `--build up` was run again for this fix specifically** (not a re-read of the
    prior pass's report): all named volumes were confirmed wiped (including
    `nextbot-knowledge-uploads-data`), then recreated; `migrate` again applied
    **91/91 migrations** from empty, and all 11 compose units reached their
    expected state (`postgres`/`redis`/`clickhouse`/`neo4j`/`web`/`gateway`/
    `worker`/`widget-embed`/`web-proxy` all Docker `healthy`, `migrate`/`seed`
    both `Exited (0)`).
21. **Ownership confirmed directly inside the running containers**: before this
    fix, `docker exec ... ls -la /data` would have shown `/data/knowledge-uploads`
    as `root:root`; after it, both `nextbot-web-1` and `nextbot-worker-1` show it
    as `nextbot:nextbot` (uid/gid 1001, matching each container's own `id` output).
22. **A real login + a real multipart upload, through the actual running stack**
    (Playwright, real Chromium, not curl-with-forged-cookies): logged in as
    `admin@demo.nextbot.local` / tenant `demo` via the real `/login` form,
    reached `/dashboard`, then issued a real `fetch(..., { method: "POST", body:
    FormData })` to `/api/v1/admin/knowledge/upload` with a real file from inside
    the authenticated page context. Result: **`201 Created`** (not `500`), with a
    real `{"locator":{"kind":"Upload","storageRef":"<uuid>",...}}` body — this is
    the exact scenario Final Review's QA reproduced as failing.
23. **Cross-container read confirmed on the exact file the real HTTP request
    wrote**, not a synthetic probe: resolved the real `demo` tenant id from
    Postgres and the real `storageRef` from the upload response above, then
    `docker exec nextbot-web-1 cat /data/knowledge-uploads/<tenantId>/<storageRef>`
    and `docker exec nextbot-worker-1 cat` the same path both returned the exact
    uploaded content, byte-for-byte — i.e. the real `web` process (uid 1001)
    genuinely wrote it and the real `worker` process (uid 1001) genuinely read it
    back, the precise `putUpload()`/`getUpload()` operation that used to fail.
24. **Disclosed, not fully exercised**: triggering the ingestion pump's actual
    parse/chunk stage on this uploaded file (rather than only proving the raw
    file read/write) requires creating a knowledge collection, which requires an
    embedding-capable model route — this environment has no reachable AI backend
    (`AI_BASE_URL`/`AI_MODEL_EMBED` are placeholders, same pre-existing,
    already-disclosed limitation as "AI provider configuration" above and
    `SEED_CREDENTIALS.md`'s own note) — creating a collection failed with
    `ROUTE_MODALITY_MISMATCH`, unrelated to DEFECT-1. Not attempted further since
    it is out of this fix's scope; the cross-container read/write proof in #23
    exercises the exact filesystem operation the ingestion pump's `getUpload()`
    call performs, which is what DEFECT-1 was actually about.
25. **Audited every other volume mount in `docker-compose.yml` for the same class
    of bug**: `nextbot-postgres-data`/`nextbot-redis-data`/`nextbot-clickhouse-data`/
    `nextbot-neo4j-data`/`nextbot-neo4j-logs` are each single-container (their own
    image's default user, not `nextbot`/uid 1001); `nextbot-seed-output` is
    single-container (`seed`, via `docker/tools.Dockerfile`) and already had this
    exact `mkdir`+`chown`-before-`USER` fix; `gateway`/`widget-embed` mount no
    volumes at all. `nextbot-knowledge-uploads-data` (shared between `web` and
    `worker`, both `USER nextbot`) was the only instance of this bug class.

### Testing the Platform Manager console locally

The Platform Manager console (NFR-11, `/internal/ops/**`) is reachable and
loggable-into **out of the box** with a bare `docker compose -f docker-compose.yml
--env-file .env.docker.example up --build` — no manual config required, the same
as the regular Admin Console — because of two additions made in this pass:

1. A new `web-proxy` service (`docker/web-proxy/nginx.conf`) — a small nginx
   reverse proxy that now sits in front of `web` and is the *only* thing that
   publishes a host port for it. It overwrites (never appends to)
   `X-Forwarded-For`/`X-Real-IP` with its own observed connection before
   forwarding to `web`, which is what lets the console's IP-allowlist check
   (`apps/web/src/lib/platform-ops-network.ts`) pass at all — Next.js's App
   Router has no way to read a caller's raw socket address itself, so without a
   proxy like this in front of it, the console is unreachable in *any*
   deployment of this compose file (confirmed: before this fix, it 404'd
   unconditionally).
2. A pinned `172.30.238.0/24` compose network (see `docker-compose.yml`'s
   `networks:` section) so the caller IP a host-machine browser resolves to
   (the network's gateway address, `172.30.238.1` — confirmed empirically
   against this exact Docker Desktop networking model with a throwaway raw-socket
   test container, not assumed) is deterministic across machines, and
   `NEXTBOT_OPS_IP_ALLOWLIST`/`NEXTBOT_OPS_TRUSTED_PROXY_CIDRS` default to that
   address and `web-proxy`'s own pinned address (`172.30.238.250` — moved from
   `.10` on 2026-09-01 after adding the `neo4j` service shifted Compose's
   sequential dynamic-IP allocation into a collision with the old pin; see
   `docker-compose.yml`'s `web-proxy` service comment for the full story)
   respectively.

**This is a local-testing convenience, not a production-safe default** — see
"Known gaps" below for what changes for a real deployment. Nothing about the
console's actual code-level security mechanism (the operator-token check, the
page-surface-indistinguishability middleware, the IP-allowlist matcher itself)
was weakened to make this work; only the local compose *topology* changed to
give those mechanisms a real proxy to trust, matching what the code's own
`getTrustedProxyCidrs` doc comment already said a real deployment would need.

**To log in:**

1. `docker compose -f docker-compose.yml --env-file .env.docker.example up --build`
2. Visit `http://localhost:3000/internal/ops/login` (same public-looking path
   whether you're allowed to see it or not — see `ops-console-route.ts`'s doc
   comment for why).
3. Enter the operator token. The default (used automatically unless you set
   `NEXTBOT_OPS_OPERATOR_TOKEN` in `.env.docker`) is documented the same place
   every other seeded credential is: `SEED_CREDENTIALS.md` (checked into the repo,
   and re-written into the `nextbot-seed-output` volume on every `docker compose
   up` by the `seed` job) — currently
   `632438c7ae617a5c6a22eaad8dfaf7452847c7c1798b724297bf2f9d32471d8c`.
4. You land on the Tenant List (`/internal/ops/tenants`), with Health and Plan
   Tiers reachable from the nav.

If you changed `WEB_HOST_PORT` away from its `3000` default, substitute that port
above — `web-proxy` (not `web`) is what actually publishes it.

If this 404s unexpectedly: check `docker compose logs web-proxy` and confirm the
`172.30.238.0/24` subnet didn't collide with another network already on your
machine (Docker would have failed the whole `up` with a subnet-overlap error in
that case, not a silent 404) — see the comment above `networks:` in
`docker-compose.yml` for the override.

## 3. Kubernetes (lighter pass, per this dispatch's own priority ordering)

`k8s/base/` (kustomize) covers, per the HLD's four deployables:
`Deployment` + `Service` for `web`/`gateway`/`worker`/`widget-embed`, a
`HorizontalPodAutoscaler` on `gateway` (NFR-3's connection-rate scaling driver —
approximated with CPU utilization here; a real connection-count custom metric needs
a Prometheus adapter this MVP pass doesn't stand up), one shared `Namespace`
(multi-tenant isolation here is data-level per ADR-0001, not namespace-per-tenant —
matching what the HLD actually specifies), `ConfigMap` for non-secret config, a
`secrets.yaml.example` documenting the required `Secret` keys (never a real
committed secret), least-privilege `ServiceAccount`s with no RBAC grants (none of
these planes call the Kubernetes API), `NetworkPolicy` enforcing default-deny
ingress plus explicit inter-plane/datastore allows and the Gateway-Plane-only
external-egress rule (ADR-0004), an `Ingress` routing widget/gateway/admin paths,
and `Job`s for the one-shot migrate/seed steps. `k8s/overlays/dev/` pins local image
tags.

**2026-09-01 update**: added the `GRAPH_STORE_*` `ConfigMap`/`Secret` keys and an
`allow-app-to-neo4j` `NetworkPolicy` (same "externally-provisioned, hostname-only"
convention already used for Postgres/Redis/ClickHouse — this base does not deploy
a Neo4j StatefulSet itself), added a `knowledge-uploads` `emptyDir` volume mount
to `web`/`worker` (prevents a crash under `readOnlyRootFilesystem: true`, but does
**not** provide cross-pod sharing — see "Known gaps" below), and bumped
`nextbot-worker`'s resource requests/limits for its now much larger job roster.
`kubectl kustomize k8s/overlays/dev` was re-rendered after these changes with no
errors — see "What was actually verified" below.

**Not produced / explicitly out of scope for this pass:**
- A production overlay (the dev overlay's `nextbot-seed` Job must never run against
  production — flagged inline in `k8s/base/jobs-init.yaml` and
  `k8s/overlays/dev/kustomization.yaml`).
- A real secret-management integration (Vault, External Secrets Operator, Sealed
  Secrets) — the HLD/ADRs name a "cloud KMS" for the credential-vault KEK (ADR-0007)
  but do not name a specific k8s-native secret-delivery mechanism, and no cloud
  provider/k8s distribution is named anywhere in the HLD/ADRs either. **This is a
  question for the user, not a decision made here** — see "Open decisions" below.
- Verifying these manifests against a live cluster (none was available in this
  environment) — only `kubectl kustomize` rendering was checked.

## 4. CI/CD

`.github/workflows/ci.yml` already existed with `lint-typecheck-unit` and
`integration` jobs (this repo's own dev-phase gate, run identically here — nothing
about that half changed). This phase adds:
- `build-images` (matrix over the 4 apps): builds each Dockerfile, runs a Trivy
  image scan that **fails the pipeline on any CRITICAL finding**, generates an SPDX
  SBOM per image, and — on `main` only — pushes to GHCR tagged with the commit SHA
  (plus `:latest`).
- `deploy-production`: gated behind a GitHub `environment: production` (configure
  required reviewers under repo Settings → Environments for a real manual-approval
  gate) — currently a placeholder that deploys nothing, because **no production
  target (cluster, registry beyond GHCR, cloud account) has been provisioned or
  named** — flagged rather than invented.

## 5. Known gaps (flagged, not silently worked around)

- **No `/api/health` (or equivalent) route exists yet** in `apps/web` or
  `apps/gateway` (`apps/web/app/api/internal/ops/` is an empty placeholder
  directory). Every `HEALTHCHECK`/probe in this deliverable instead checks a real
  existing route (`/login` for web, `/` for gateway) as a pragmatic stand-in —
  this is not a substitute for a real liveness/readiness endpoint (e.g. one that
  also confirms DB/Redis connectivity) and should be a near-term follow-up.
- `apps/runtime` (Data Plane / ADK executor, HLD §3.2) and `apps/gateway-agent`
  (on-prem tunnel binary, BL-22) are both still reserved, unpopulated app scaffolds
  (`export {}` only) — the backlog phases that populate them (multi-step tool
  workflows / Phase 3-5 roadmap) were explicitly deferred per this session's scope.
  No Dockerfile/manifest was produced for either, since there is no behavior yet to
  containerize; the four images here match the current, actually-implemented
  surface area exactly.
- `apps/worker`'s container runs `tsx src/main.ts` directly in production (no
  compiled/bundled output) — this mirrors the app's own existing `package.json`
  convention (there is no `"build"` script for this app anywhere, dev or CI), not
  an oversight; worth revisiting if/when a real build step is added.
- The worker's liveness probe is a `pgrep` process-alive check (no HTTP surface
  exists to probe) — a heartbeat file the scheduler touches per tick would be a
  materially better signal and isn't built yet.
- **`k8s/` has no Neo4j Deployment/StatefulSet, same convention already used for
  Postgres/Redis/ClickHouse** (`k8s/base/` assumes those are externally
  provisioned/managed and reachable at the hostnames its `ConfigMap` names —
  see `configmap.yaml`'s own header comment) — this pass added the
  `GRAPH_STORE_*` `ConfigMap`/`Secret` keys and the `allow-app-to-neo4j`
  `NetworkPolicy` so the app planes can reach a Neo4j instance once one is
  provisioned, but does not stand one up itself. A real Neo4j 5 **Enterprise**
  cluster (see "Neo4j Enterprise licensing" above — the requirement is identical
  for the k8s path) needs its own capacity/backup/upgrade plan, which is
  `nexus-deploy`/operator scope beyond this lighter k8s pass's priority.
- **The knowledge-upload local-disk store does not share correctly across
  multiple k8s replicas/pods.** `docker-compose.yml`'s fix (a shared named
  volume mounted into both `web` and `worker`) works because Compose runs both
  containers on one host; the k8s manifests only mount an `emptyDir` into
  `web`/`worker` (prevents a crash under `readOnlyRootFilesystem: true`, nothing
  more) — an `emptyDir` is per-pod, so a file `web` writes on one of its 2
  replicas is invisible to the *other* `web` replica and to `worker`'s own pod
  on a different node. Every `Upload`-kind knowledge source ingested through the
  k8s path is therefore unreliable today (works only if the same `web` pod that
  received the upload happens to still hold it, which nothing guarantees). Fixing
  this for real needs either a ReadWriteMany `PersistentVolumeClaim` (NFS/EFS/
  Azure Files — no storage class is named anywhere in the HLD/ADRs, see "Open
  decisions" below) or the object-storage extraction
  `packages/modules/knowledge/README.md` already flags as reasonable future work
  once a second real consumer needs one. Neither was picked here — this is a
  disclosed gap, not a silent workaround.
- **Platform Manager console (NFR-11, `/internal/ops/**`) — local-testing fix
  applied, production topology still open.** This used to read "no reverse proxy
  in front of `web` in this deployment, so the console's IP check is unusable" —
  that's now fixed **for local testing specifically**: `docker-compose.yml` adds a
  `web-proxy` service (nginx, `docker/web-proxy/nginx.conf`) that is now the only
  thing publishing `web`'s host port, overwrites (never appends to)
  `X-Forwarded-For`/`X-Real-IP` from its own observed connection, and a pinned
  `172.30.238.0/24` compose network makes the resulting caller IP deterministic —
  see "Testing the Platform Manager console locally" above for the full
  walkthrough and default operator token.

  **This does not close the gap for a real (non-local) deployment.** Two things
  are still needed together there (a code-level flag alone can't substitute for
  either, same as before): (1) a *production-grade* reverse proxy (nginx, Caddy, a
  cloud load balancer, …) — the local `web-proxy` here is deliberately the
  simplest thing that satisfies the header contract, not TLS-terminating,
  hardened, or otherwise production-shaped — and (2) real network-level isolation
  (firewall/security group/a non-default Docker network with `web` genuinely
  unreachable except through that proxy) guaranteeing the app is reachable *only*
  through it. This local docker-compose network does **not** provide (2) fully:
  any other container already inside this same compose project (`gateway`,
  `worker`, `migrate`, `seed`) can still reach `web:3000` directly and forge the
  trusted-proxy's address in `X-Forwarded-For`, bypassing the IP-allowlist check
  (though not the independent operator-token check — see point 16 in "What was
  actually verified" above for the exact scope of this residual and why it was
  judged acceptable for a local-testing default rather than fixed by weakening the
  console's own security code). Choosing and building the production reverse
  proxy + network isolation is a deployment-topology decision for the
  orchestrator/architect, not something this local-testing convenience should
  silently decide.

## 6. Open decisions (need the user, not a guess)

Per this pipeline stage's own escalation rule ("HLD/ADR silent on a required infra
decision → ask, don't guess"):
1. **Cloud provider / Kubernetes distribution** for a real (non-local) deployment —
   the HLD names regional cells and k8s-or-equivalent orchestration in the abstract
   (§7.3) but no concrete provider (AWS/GCP/Azure/on-prem) or k8s distribution
   (EKS/GKE/AKS/vanilla). `k8s/` above is provider-agnostic and will need
   provider-specific Ingress annotations, a real `IngressClass`, storage classes for
   Postgres/ClickHouse persistent volumes, etc. once one is chosen.
2. **Secret-management tool** for the k8s path specifically (Vault /
   External Secrets Operator / Sealed Secrets / cloud KMS-native) — ADR-0007 names a
   cloud KMS for the credential-vault key but doesn't extend that to "how does every
   other secret reach a pod." `k8s/base/secrets.yaml.example` documents the required
   keys either choice must populate.
3. **Production deploy target for CI/CD** — `deploy-production` in
   `.github/workflows/ci.yml` is a placeholder until (1) and (2) are answered.
4. **Neo4j Enterprise license procurement** — a real, budgeted commercial license
   (ADR-0018 §4) is required before any production deployment of this stack; no
   vendor/tier/seat count has been chosen (a purchasing decision, not a technical
   one this dispatch can make).
5. **A ReadWriteMany storage class (or the future `@nextbot/object-store`
   extraction)** for the k8s knowledge-upload path — see "Known gaps" above.
   Not needed for the docker-compose path (a single-host named volume already
   fixes it there).

## 7. File map

| Path | What |
|---|---|
| `apps/web/Dockerfile`, `apps/gateway/Dockerfile`, `apps/worker/Dockerfile`, `apps/widget-embed/Dockerfile` | Per-plane multi-stage builds |
| `docker/tools.Dockerfile` | Shared image for the one-shot `migrate`/`seed` compose jobs |
| `docker/web-proxy/nginx.conf` | Local-testing-only reverse proxy in front of `web` (Platform Manager console fix) |
| `.dockerignore` | Root build-context excludes |
| `docker-compose.yml` | Full local application stack (this phase's priority deliverable) — **now includes the `neo4j` service (ADR-0018)** |
| `.env.docker.example` | Every var the compose stack expects, with safe local defaults — **now includes `NEO4J_PASSWORD`/`GRAPH_STORE_*`** |
| `scripts/seed.ts` | Idempotent default-tenant + per-role-login seed script |
| `k8s/base/`, `k8s/overlays/dev/` | Kustomize manifests (lighter pass, see §3) — **now includes `GRAPH_STORE_*` config/secret keys and the `allow-app-to-neo4j` NetworkPolicy** |
| `.github/workflows/ci.yml` | Build/test/scan/push/deploy pipeline |
| `docs/deployment/DEPLOYMENT.md` | This file |
