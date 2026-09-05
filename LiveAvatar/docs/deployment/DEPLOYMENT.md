# Deployment guide

Deployment model: **SaaS (Multi-Tenant)**, row-level `tenant_id` isolation
enforced entirely at the application layer (`docs/architecture/HLD.md` §4.1).
There is deliberately **no per-tenant infrastructure** below — one shared
namespace/cluster serves every tenant; the isolation boundary this layer
*does* own is the public/internal split described in §3.

Topology, images, and CI/CD shape all follow `docs/architecture/HLD.md` §8
and `docs/architecture/adr/ADR-001-stack.md` §4 — this document is the
runbook for what `nexus-deploy` built to implement that decision, not a
re-decision of it.

---

## 1. What gets built

Two images, per ADR-001 §4 ("Two images. Not one... not seven"):

| Image | Dockerfile | Contains |
|---|---|---|
| `web` | `apps/api/Dockerfile` | NestJS control plane (public `:8080` + cluster-only `:8081`) + both compiled Angular SPAs, served by `@nestjs/serve-static` |
| `agent` | `apps/agent/Dockerfile` | Python LiveKit Agents worker (STT → LLM → TTS → avatar loop) |

Build context for `web` is the **repo root** (it's a pnpm workspace —
`packages/contracts` + `apps/api` + `apps/web` all get built in one
multi-stage build):

```bash
docker build -f apps/api/Dockerfile -t liveavatar/web:<tag> .
docker build -f apps/agent/Dockerfile -t liveavatar/agent:<tag> apps/agent
```

Both Dockerfiles were built and run locally against this repo as part of
this deploy pass (see §7 "What was actually validated").

GPU workers (Deepgram self-hosted, faster-whisper, Fish Speech, bitHuman) are
**not** built or deployed by this repo — they are operator-provisioned per
ADR-001 §4, reached by the agent via `ProviderCredential.endpoint_url`.
GPU autoscaling is explicitly out of scope (BL-028, P2 non-goal).

---

## 2. Local: `docker compose up`

```bash
cp .env.example .env               # fill in real values; .env is gitignored, never commit it
```

`.env.example`'s top comment says "copy to `apps/api/.env` for local
development" — that's for the non-Docker dev loop (`pnpm start:dev`), where
`LIVEKIT_URL=ws://localhost:7880` is correct because LiveKit runs on the
host network via `docker-compose.dev.yml`. For the **root** `.env` this
section is about (`docker compose up`, every service in its own container),
edit these values after copying — every service here reaches every other
one by its compose service name, never `localhost`:

- `LIVEKIT_URL=ws://livekit:7880` (not `ws://localhost:7880` — the
  container-to-container DNS name)
- Real (not `devkey`/`devsecretdevsecretdevsecret`) `LIVEKIT_API_KEY` /
  `LIVEKIT_API_SECRET`, and real values for every other `change-me-*`
  placeholder (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `BOOTSTRAP_SECRET`,
  `INTERNAL_TOKEN`, `POSTGRES_PASSWORD`) — `docker-compose.yml` deliberately
  hard-fails at container start (`${VAR:?... is required}`) rather than
  silently booting on an example value for any of these.
- `DATABASE_URL`'s embedded password must equal whatever you set
  `POSTGRES_PASSWORD` to, and its host must be `postgres` (the compose
  service name), never `localhost` — these are two independently-set
  values in `.env.example` and nothing keeps them in sync automatically;
  leaving them mismatched fails the `migrate` step with Prisma P1000
  ("Authentication failed"), found live during this fix pass's own clean
  `docker compose up` verification.

```bash
mkdir -p secrets
echo -n "<deepgram key>" > secrets/deepgram
echo -n "<elevenlabs key>" > secrets/elevenlabs          # only if that tenant/provider is used
echo -n "<alibaba token>" > secrets/alibaba-liveavatar   # only if that tenant/provider is used

docker compose build
docker compose run --rm migrate      # prisma migrate deploy + the ProviderDefinition catalog seed
docker compose up -d
```

This brings up `postgres`, `redis`, `livekit` (real config, not `--dev`
mode), `web`, and `agent` — the same five services HLD §8.1 names, using the
images this repo builds. `docker-compose.dev.yml` is a separate, lighter
file (Postgres/Redis/LiveKit `--dev` only, no application images) kept for
the existing local dev-loop; `docker-compose.yml` is the new
production-oriented file this deploy pass adds.

Admin SPA: `http://localhost:8080/admin/`. Conversation SPA:
`http://localhost:8080/c/`. `:8081` is exposed to the host only for local
debugging — a real deployment must never route external traffic to it (§4).

**Final Review fix (D-1)**: `deploy/livekit/livekit.yaml` ships with a
deliberately-unsubstituted `__LIVEKIT_API_KEY__` placeholder in its
`webhook.api_key` field (see that file's own header). Earlier revisions of
this runbook mounted it straight into the `livekit` container with no
substitution step at all, which made LiveKit refuse to boot
("`api_key is required to use webhooks`") and, because `agent` depends on
`livekit: {condition: service_healthy}`, silently prevented **the entire
stack** from ever coming up as documented — the steps above never actually
worked end to end until this fix. Nothing extra is required of you now: the
`livekit` service's `entrypoint`/`command` in `docker-compose.yml` renders
the template with `sed` (substituting `$LIVEKIT_API_KEY`, read from the
container's own runtime environment) into a writable path before starting
the real server, so a plain `docker compose up -d` following the four
commands above is genuinely sufficient — no separate `envsubst` pass to
remember or forget.

**Final Review fix (D-5)**: LiveKit's RTC UDP port range is `20000-20100`,
not `50000-50100` — the latter sits inside Windows' default
dynamic/ephemeral port range (`49152-65535`), which made `docker compose up`
fail non-deterministically ("bind: Only one usage of each socket address is
normally permitted") whenever the host had transiently allocated a port in
that window, independent of any other running container. If you widen this
range for production, keep it below 49152 on any Windows host in the mix.

---

## 3. Kubernetes (staging/production)

Manifests under `k8s/` (`k8s/README.md` has the full apply order). Highlights:

- `web-deployment.yaml` — one Deployment, one container running both Nest
  processes (`apps/api/deploy/docker-entrypoint.sh`), exposed through two
  Services (`web-service.yaml`): `web-public` (behind `web-ingress.yaml`) and
  `web-internal` (ClusterIP only, **no** Ingress path — this is the literal
  enforcement of NFR-3, not just a convention).
- `agent-deployment.yaml` — replica count is a manual capacity-planning
  knob (`ceil(target_concurrent_sessions / MAX_CONCURRENT_JOBS)` with
  headroom, HLD §9), not an HPA — see the file's own comment for why an
  automatic scaler isn't wired up.
- `web-hpa.yaml` — CPU-based HPA for `web` only, per HLD §9.
- `networkpolicy.yaml` — default-deny plus explicit allows; the one that
  matters most is `web-ingress`'s split between `:8080` (from the ingress
  controller) and `:8081` (from `agent` pods + a `gpu-workers` namespace
  selector — confirmed as the real in-cluster topology by §6.3, not a
  placeholder for an external path).
- `migrate-job.yaml` — pre-deploy Job (migrate + seed), applied and awaited
  before rolling `web`/`agent` (HLD §8.3 step 7 ordering).
- `livekit.yaml` — a minimal Deployment/Service for small deployments; **use
  the upstream `livekit/livekit-server` Helm chart instead** for real
  multi-node/production scale (the file says why).
- `pdb.yaml` — PodDisruptionBudgets so a voluntary node drain can't take
  every `web` or every `agent` replica down at once (NFR-2).
- `secret-web.yaml` / `secret-agent.yaml` — **placeholders**, populated
  out-of-band by ops. Confirmed as plain Kubernetes Secrets, no external
  secret-management tool (see §6.2).

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/serviceaccount.yaml
kubectl apply -f k8s/configmap-web.yaml -f k8s/configmap-agent.yaml
kubectl apply -f k8s/secret-web.yaml -f k8s/secret-agent.yaml   # after replacing placeholders
kubectl apply -f k8s/livekit.yaml
kubectl apply -f k8s/migrate-job.yaml
kubectl wait --for=condition=complete job/liveavatar-migrate -n liveavatar --timeout=300s
kubectl apply -f k8s/web-deployment.yaml -f k8s/web-service.yaml -f k8s/web-hpa.yaml -f k8s/web-ingress.yaml
kubectl apply -f k8s/agent-deployment.yaml
kubectl apply -f k8s/networkpolicy.yaml -f k8s/pdb.yaml
```

Managed Postgres/Redis are assumed (HLD §8.2) — this repo does not ship
StatefulSets for them. `k8s/networkpolicy.yaml`'s `web-egress`/`migrate-egress`
policies allow egress to any external IP on ports 5432/6379 (alongside the
in-cluster `app: postgres`/`app: redis` pod-selector rules) specifically so a
managed-DB deployment isn't silently network-blocked by `default-deny-all` —
no manual NetworkPolicy edit is required to reach a managed instance. Narrow
those `ipBlock: 0.0.0.0/0` rules to your managed instances' real CIDRs if your
environment can enumerate them.

**Final Review fixes (D-1, D-6, D-7)**: three defects that would have made
a real Kubernetes deploy non-functional (found and fixed after all prior
verification only ever `kubectl apply --dry-run=client`d these manifests,
which parses YAML but does not catch behavioral/networking defects like
these):

- **D-1** — `k8s/livekit.yaml`'s ConfigMap carried the same unsubstituted
  `__LIVEKIT_API_KEY__` placeholder as the compose path, with no templating
  step in the `kubectl apply` order above. Fixed with a real `initContainer`
  on the `livekit` Deployment that renders the ConfigMap's template into a
  shared `emptyDir`, substituting the real key from
  `liveavatar-web-secrets`' `LIVEKIT_API_KEY` field before the main
  container ever starts — so the `kubectl apply -f k8s/livekit.yaml` step
  above is correct as written, no extra `envsubst`/Kustomize/Helm-values
  step needed.
- **D-6** — `networkpolicy.yaml`'s `web-ingress` policy only admitted `:8081`
  from `app: agent` and the `gpu-workers` namespace; LiveKit pods (`app:
  livekit`) were in neither set, and `default-deny-all` also left LiveKit
  with no egress rule of its own. Both directions silently blocked LiveKit's
  session-lifecycle webhooks (`room_finished` is the authoritative `ended`
  transition, LLD §8.3/Phase 3-4) in any NetworkPolicy-enforcing cluster.
  Fixed: `web-ingress` now also admits `app: livekit`, and a new
  `livekit-egress` policy allows LiveKit pods to reach `web-internal:8081`.
- **D-7** — `migrate-job.yaml`'s pod template carried no labels at all, so
  `default-deny-all` left it with DNS-only egress and no path to Postgres.
  The very first deploy happened to work only because the apply order above
  applies `networkpolicy.yaml` *after* the migrate Job — every subsequent
  upgrade's migration would hang against `postgres:5432` and fail. Fixed:
  the Job's pod template now carries `app: migrate`, `postgres-ingress` now
  also admits that label, and a new `migrate-egress` policy grants it
  Postgres reachability — this holds regardless of apply order now.

A real `kubectl apply --dry-run=server` (or a genuine cluster deploy) against
these updated manifests is still recommended before a first production
rollout — no Kubernetes cluster was reachable in this environment either, so
only manifest review/structural validation was possible for D-6/D-7 (D-1's
`sed` substitution logic was smoke-tested standalone, see §7).

---

## 4. CI/CD

`.github/workflows/ci-cd.yml` — GitHub Actions (no existing CI platform was
found in this repo, and HLD §8.3 already names GitHub Actions as the
intended platform, so this isn't a fresh unilateral choice). Jobs:
`contracts` → `api` / `web` / `agent` (parallel) → `e2e` → `images` (build,
Trivy scan, `pnpm audit`/`pip-audit`, push to GHCR) → `deploy` (gated behind
a GitHub Environment named `production` requiring manual approval).

**Known gap, not invented around**: HLD §8.3's `e2e` step describes a
Playwright suite across the 11 admin/conversation screens plus an
`@axe-core/playwright` accessibility pass (NFR-4). No such suite exists in
this repo yet (grep-confirmed) — the `e2e` job instead runs the real,
existing integration tests (backend Jest+Supertest against ephemeral
Postgres/Redis, the mandatory cross-tenant isolation negative suite, the
Python↔TypeScript agent-config contract test). Adding the Playwright/axe
layer is a `nexus-dev` task, not something this pass fabricates.

**Correction (Final Review)**: this section and `ci-cd.yml`'s own comment
previously claimed the TypeScript half of the Python↔TypeScript
agent-config contract test lived at
`packages/contracts/src/agent-config/schema.contract.spec.ts` and ran
inside the `contracts` CI job. That file never existed — QA confirmed zero
`.spec.ts` files anywhere under `packages/contracts`. The real file is
`apps/api/src/modules/deployment-config/domain/agent-config-cross-language.contract.spec.ts`,
and it already runs today, just inside the `api` job's `pnpm --filter
@liveavatar/api test:cov` step (it matches that package's own Jest
`testRegex`), not the `contracts` job. The test itself was never missing or
broken — only this doc's and `ci-cd.yml`'s claim of where it lives/runs
was wrong, and both are now corrected to match reality.

---

## 5. Environment variables and secrets

Cross-reference `.env.example` (root) for the full list with comments. Summary:

**`web` (apps/api/src/modules/platform/domain/env-schema.ts` is the source of truth):**
`DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`BOOTSTRAP_SECRET`, `PORT`, `INTERNAL_PORT`, `NODE_ENV`, `LIVEKIT_URL`,
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `AGENT_NAME`, `INTERNAL_TOKEN`,
`ADMIN_ORIGIN`.

**`agent` (`apps/agent/src/avatar_agent/settings.py` is the source of
truth):** `AI_PROVIDER`, `AI_MODEL_CONVERSATION`, `AI_MODEL_SUMMARY`,
`AI_BASE_URL`, `AI_API_KEY`, `AI_REQUEST_TIMEOUT_MS`, `AI_CONNECT_TIMEOUT_MS`,
`CONTROL_PLANE_INTERNAL_URL`, `INTERNAL_TOKEN`, `SECRETS_DIR`, `LIVEKIT_URL`,
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `AGENT_NAME`, `MAX_CONCURRENT_JOBS`.

`INTERNAL_TOKEN` **must be identical** on both `web` and `agent` — it's the
shared bearer secret `InternalTokenGuard` checks on every agent-facing
`/internal/*` route (LiveKit webhooks authenticate separately, via LiveKit's
own HMAC signature, unaffected by this token).

**Never as env vars**: per-provider vendor credentials
(`ProviderCredential.credential_ref`). These are files under `SECRETS_DIR`
(`DirectorySecretStore`, `apps/agent/src/avatar_agent/secrets/directory_store.py`)
— one file per `credential_ref`, bind-mounted (compose) or Secret-volume
-projected (Kubernetes, `k8s/secret-agent.yaml`'s
`liveavatar-provider-credentials` Secret). Populate one key per
`credential_ref` actually referenced by a tenant's published Agent Builder
config before that tenant can go live.

The AI subsystem is fully env-driven and provider-agnostic (ADR-001 §3):
`AI_PROVIDER`/`AI_MODEL_*`/`AI_BASE_URL`/`AI_API_KEY` are never baked into
an image layer, surfaced in `.env.example`, the `agent` ConfigMap/Secret,
and `docker-compose.yml`. `AI_BASE_URL` is how an on-prem OpenAI-compatible
endpoint (Ollama/vLLM/an internal gateway) is used instead of a remote
vendor — set it and leave `AI_API_KEY` per that endpoint's own auth
requirement.

---

## 6. Infra decisions confirmed by the user (previously open questions)

The prior deploy pass flagged three infra questions the HLD/ADR were silent
on. The orchestrator relayed them to the user, who confirmed the
recommended defaults below (2026-08-20). Recorded here so a future reader
doesn't have to re-derive the reasoning; nothing in `k8s/` changed as a
result except §6.3's scheduling hint.

### 6.1 Cloud provider / Kubernetes distribution: kept generic

**Decision**: no specific cloud provider (AWS/Azure/GCP) or managed K8s
distribution is assumed. The manifests stay cloud-agnostic: a generic
`ingressClassName: nginx` assumption (`k8s/web-ingress.yaml`), a plain
`type: LoadBalancer` Service for LiveKit with no cloud-specific
annotations (`k8s/livekit.yaml`), no storage class pinned anywhere (this
repo doesn't ship StatefulSets for Postgres/Redis — managed instances are
assumed per HLD §8.2, so no storage class was ever needed). Confirmed:
nothing in `k8s/` had baked in a cloud-specific annotation or storage class
that needed genericizing — the manifests were already generic; this
decision just ratifies that as intentional rather than an oversight to
revisit.

**Why it matters**: whoever operates this deploys onto whatever cluster
they have (on-prem, any cloud, any distribution) without the manifests
assuming infrastructure that isn't there. The operator still needs to set
the real `ingressClassName`, cert-manager issuer (or drop TLS if
terminating elsewhere), and — if they want a cloud LB in front of
LiveKit's UDP range — whatever provider-specific Service annotations their
LB controller needs (not added here, since that would re-introduce the
exact cloud coupling this decision avoids).

### 6.2 Secrets: plain Kubernetes Secret objects

**Decision**: no external-secrets-operator, Vault, or cloud secrets-manager
integration. `k8s/secret-web.yaml` / `k8s/secret-agent.yaml` remain plain
`Secret` manifests with `REPLACE_ME_*` placeholder values, populated
out-of-band by ops before first deploy (never committed with real values).

**Why it matters**: this is the smallest-footprint option and matches
what's already shipped — no new tooling to stand up before a first
deploy. If a future phase needs centralized secret rotation/audit across
multiple clusters, that's a deliberate follow-on decision, not something
to back into here.

### 6.3 GPU-worker network topology: same cluster, separate node pool

**Decision**: GPU-accelerated workers run in the **same Kubernetes
cluster** as the rest of the stack, on a separate GPU-labeled/tainted node
pool — not over an external network/VPN path. This confirms the existing
design (GPU workers are operator-provisioned; the `agent` image itself
stays CPU-only per ADR-001 §4) and resolves the network-reachability
question left open in the prior pass: the `gpu-workers` namespace selector
already in `k8s/networkpolicy.yaml`'s `web-ingress` policy is correct as
the in-cluster model this decision confirms, not a placeholder for an
external path.

**Scheduling hint added this pass**: `k8s/agent-deployment.yaml` now has a
commented-out `nodeSelector`/`tolerations` block matching a standard
`workload-type: gpu` label / `nvidia.com/gpu` taint convention. It's
inactive by default (this Deployment stays CPU-only and correctly
schedules onto general-purpose nodes as-is) — it exists so that when the
operator deploys a GPU-accelerated variant of this workload into this same
cluster, there's a documented, correct place to add the scheduling
constraint (adapted to their node pool's actual label/taint) instead of it
landing on a general-purpose node by accident.

### 6.4 Still open: LiveKit at real scale

Unrelated to the three decisions above, this one from the prior pass
remains open (not part of this follow-up): `k8s/livekit.yaml` is a minimal
single-replica convenience manifest; HLD §8.2 itself says "StatefulSet or
operator-managed." Real production LiveKit (multi-node SFU, TURN, a UDP
port range a cloud LB can actually front) should use the upstream Helm
chart, not this file.

---

## 7. Known implementation gaps found and fixed during this pass

Several gaps between the HLD/LLD's stated design (or plain build hygiene)
and the actual shipped code would have made this deployment non-functional
as designed; all were fixed as part of making the containers actually boot
and serve traffic, not left as documentation TODOs:

- **Static SPA serving was never wired up.** LLD §5.1 says
  `dist/admin`/`dist/conversation` are served by `@nestjs/serve-static` at
  `/admin`/`/c` with SPA fallback; `@nestjs/serve-static` was already a
  listed dependency but `AppModule` never actually imported
  `ServeStaticModule` — the package sat unused. Added the wiring (see
  `apps/api/src/app.module.ts`; also fixed a duplicate
  `@nestjs/serve-static` entry found in `apps/api/package.json` while
  touching that file). Verified live end-to-end: ran the built `web` image
  against real disposable Postgres/Redis and confirmed `GET /admin/`,
  `GET /c/`, and — the specific bug class flagged in this dispatch's own
  instructions (Phase 1's `servePath`/base-href history) — a client-side
  deep link (`GET /admin/tenants/abc`) all return `200` via genuine SPA
  fallback, not a 404.
- **No initial Prisma migration existed.** All prior dev/QA verification
  used `prisma db push` against disposable containers; `prisma/migrations`
  was empty. HLD §6/§8.3 requires `prisma migrate deploy` as the pre-deploy
  Job — against zero migrations that would silently succeed and create no
  schema. Generated `apps/api/prisma/migrations/20260819234327_init` from
  the current schema against a real disposable Postgres, applied it, and
  confirmed `prisma migrate status` reports "up to date" with no drift.
- **Angular production builds required outbound internet for Google Fonts
  inlining** (`fonts.googleapis.com`), which is not guaranteed at Docker
  build time and shouldn't be a build-time dependency in the first place.
  Disabled font inlining (`optimization.fonts: false`) in both SPAs'
  production configuration in `apps/web/angular.json`; local `ng build`
  and the Docker build were re-verified afterward.
- **`prisma:seed` (`tsx prisma/seed.ts`) had no runtime path in the
  production image** — `tsx` was a devDependency, stripped by `pnpm prune
  --prod`. Moved to a regular dependency so the pre-deploy migrate/seed step
  (`docker-compose.yml`'s `migrate` service, `k8s/migrate-job.yaml`) can run
  it in the slim runtime image without shipping the rest of the dev
  toolchain.
- **The internal (`:8081`) app has no health-check route of its own.**
  Rather than inventing one, the container's own entrypoint
  (`apps/api/deploy/docker-entrypoint.sh`) treats the whole container as
  failed if either the public or internal Nest process exits, so the
  existing `GET /api/health` liveness/readiness probe on `:8080` is still an
  accurate signal for the container as a whole. A dedicated
  `GET /internal/health` route would give finer-grained observability and
  is a reasonable follow-up for `nexus-dev`, not something added here.
- **A stale, gitignore-missing `apps/api/tsconfig.build.tsbuildinfo`
  silently broke `nest build` inside a clean container.** TypeScript's
  incremental build cache saw a `.tsbuildinfo` left over from prior local
  builds, concluded nothing had changed, and skipped emitting `dist/`
  entirely — `nest build` exited `0` with no output, and the very first
  container run failed with `Cannot find module './app-error'` (a real file
  that simply hadn't been compiled). Deleted the stale file, added
  `*.tsbuildinfo` to both `.gitignore` and `.dockerignore`. This was a
  genuine, pre-existing latent risk for **any** clean-checkout build (CI
  included), not something introduced by this pass — it just hadn't been
  hit yet because no prior verification had built from a truly clean tree.
- **The runtime image was missing two `node_modules` copies pnpm's
  per-package symlink layout actually needs.** `pnpm prune --prod` (tried
  first) turned out to delete every per-package `node_modules` entirely,
  not just devDependencies (`reflect-metadata` and other real runtime deps
  went missing) — replaced with a clean `rm -rf .../node_modules && pnpm
  install --frozen-lockfile --prod` reinstall. Separately,
  `packages/contracts/node_modules` (holding its own `@sinclair/typebox`
  dependency) was never copied into the runtime stage at all, so
  `packages/contracts/dist/common/envelope.js` failed with `Cannot find
  module '@sinclair/typebox'`.
- **The pre-deploy migrate/seed step needed three more things than the
  compiled app does**, each found by actually running
  `docker-compose.yml`'s `migrate` service against a real disposable
  Postgres, not just building the image: (1) `apps/api/prisma.config.ts`
  (Prisma 7's datasource-URL config file, at the `apps/api` root, not under
  `prisma/`) was never copied into the runtime image, so `prisma migrate
  deploy` failed with "the datasource.url property is required"; (2)
  `prisma` itself was a devDependency, so `npx prisma` fell back to an
  on-the-fly `npm install` at container-run time (fragile, and hit this
  sandbox's own binaries.prisma.sh network flake) — moved to a regular
  dependency, same reasoning as `tsx`; (3) `prisma/seed.ts` imports the
  generated Prisma client by its raw `src/generated/prisma` path (run
  directly via `tsx`, not through compiled `dist/`) — added a `COPY` for
  `apps/api/src/generated` alongside `dist/`. All three are now in
  `apps/api/Dockerfile` with comments explaining why, since a future edit to
  the COPY list is exactly where this class of bug reappears. After all
  three fixes, `docker compose run --rm migrate` against a real disposable
  Postgres genuinely applied the migration, then genuinely seeded "10
  provider definitions" — and re-running it a second time correctly reported
  "No pending migrations to apply" (idempotency confirmed, not just
  claimed).
- Fixed a real config mismatch while validating, unrelated to the above:
  `deploy/livekit/livekit.yaml`'s RTC UDP port range didn't match
  `docker-compose.yml`'s own published port range — aligned both to
  `20000-20100` (see the D-5 note in §2 above for why 50000-50100 is unsafe
  on Windows hosts) and documented why they must move together.

## 8. What was actually validated live (Docker was reachable this session)

Both images were built successfully and **run end-to-end**, not just built:

- `apps/agent/Dockerfile`: built, then ran with
  `--entrypoint python -c "import avatar_agent, bithuman, faster_whisper, livekit.agents, openai, anthropic, google.genai, deepgram, elevenlabs, langgraph, pydantic_ai, websockets"` —
  every real import succeeds in the slim runtime image (no missing shared
  library at runtime).
- `apps/api/Dockerfile`: built end-to-end (contracts → api → both Angular
  SPAs → reinstalled-prod-deps runtime image) after fixing the real bugs
  listed in §7 that blocked it, plus two build-tooling workarounds hit
  live (corepack's pnpm signature verification failing against the current
  npm registry key — switched to a direct `npm install -g pnpm@11.20.0`;
  and pnpm 11.20 requiring Node ≥22.13 — bumped the pinned base image tag
  from `22.11-alpine` to `22.16-alpine`) and a retry loop added around
  `prisma generate`'s engine-binary download (hit transient DNS failures
  live during validation).
- **Ran the built `web` image as a real container** against disposable
  Postgres 16 + Redis 7 containers on a Docker network, and confirmed live:
  both Nest processes boot cleanly and log their full route tables; `GET
  /api/health` returns a real `200`; `GET /admin/` and `GET /c/` both serve
  the compiled SPA `index.html`; **a client-side deep link
  (`GET /admin/tenants/abc`) also returns `200` via the SPA fallback**, not
  a 404 — the exact behaviour LLD §5.1 requires and the exact bug class
  (`servePath`/base-href mismatches) flagged as a past Phase-1 risk in this
  dispatch's own instructions; the internal listener answered on `:8081`;
  and Docker's own `HEALTHCHECK` reported `healthy`.
- The generated Prisma migration was applied to a real disposable Postgres
  16 container and `prisma migrate status` confirmed no drift.
- **`docker compose build` (both `web` and `agent`) and `docker compose run
  --rm migrate` were run for real** against `docker-compose.yml` itself
  (not just the raw `docker run` above): the `migrate` service genuinely
  applied the Prisma migration and seeded "10 provider definitions" against
  a real disposable Postgres 16 started by compose, and re-running the same
  `migrate` service a second time correctly reported "No pending migrations
  to apply" — this is what surfaced the three `migrate`/seed-path bugs fixed
  in §7 (`prisma.config.ts` missing, `prisma` CLI missing at runtime,
  `src/generated/prisma` missing).
- All test containers, images, networks, and the temporary `.env` file
  created for this validation were removed afterward (`la-web`, `la-pg`,
  `la-redis`, the `liveavatar-test` network, `liveavatar-e2e-*` compose
  project containers/volumes/network, and the `liveavatar/web:test` /
  `liveavatar/agent:test` / `liveavatar/web:e2etest` /
  `liveavatar/agent:e2etest` image tags).

Also attempted: `kubectl --dry-run=client -o yaml apply -f k8s/` against
this sandbox's `kubectl` — no cluster was reachable (Docker Desktop's
Kubernetes was not enabled in this session), so full schema validation
against a real API server did not happen; the attempt did at least parse
every manifest and enumerate the expected document count per file (e.g. 7
`NetworkPolicy` documents, 3 `ServiceAccount`s, 2 `Service`s in
`web-service.yaml`), confirming no YAML/structural errors. Recommend the
orchestrator/QA run a real `kubectl apply --dry-run=server` (or
`kubectl apply -f k8s/ --dry-run=client` against an actual cluster) before
a first real deploy.

**Update — validated live in the Final Review re-verification pass**: the
gap noted above (`docker compose up` bringing up all five services
*simultaneously*, and a live LiveKit room/agent job end-to-end) has since
been closed. Starting from zero `liveavatar/*` images and a full
`docker compose down -v`, a clean `docker compose build` → `run --rm
migrate` → `up -d` following this doc verbatim brought up all five services
healthy with 0 restarts each, stable for ~20 minutes with zero error lines
in any service's logs. The RTC UDP range fix (`20000-20100`, D-5 above)
resolved the earlier Windows ephemeral-port collision. `agent` genuinely
registered with the real `livekit` service (`registered worker,
agent_name=avatar-agent, url=ws://livekit:7880`), confirmed from both
sides — the agent's own log and LiveKit's `worker registered` log entry.
`GET /api/health` returned 200, both SPAs and the client-side deep-link
fallback served correctly, `/internal` correctly rejected unauthenticated
requests both from the host and from inside the `agent` container, and a
forged LiveKit webhook was correctly dropped with `web`'s restart count
still at 0.
