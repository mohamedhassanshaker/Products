# ExamLand: Full Rewrite to Next.js + Chakra UI + In-Process ADK-TS Monolith

## Context

ExamLand is a mature, feature-complete, QA-verified multi-tenant SaaS exam platform currently
built as NestJS (`apps/api`, 831 files/~23.6k LOC) + Angular 20 (`apps/web`, ~490 files/~22.2k
LOC) + a standalone Python FastAPI AI microservice (`services/ai-engine`, real `google-adk`
Python + LiteLLM + OpenRouter, reached over mandatory mTLS). MySQL uses one schema per tenant on
a single server; Qdrant is the vector store; 5 background workers run in a separate `ROLE=worker`
process.

The user wants a full rewrite to a new target stack: **Next.js fullstack, Chakra UI, in-process
AI via Google's TypeScript ADK SDK (`@google/adk`) + OpenRouter, one Docker image for the whole
app**, migrated feature-by-feature with lightweight checks along the way and one comprehensive
end-to-end validation at the finish, plus a new docker-compose seeding demo users/tenants/the
package catalog.

**Important, user-confirmed trade-off**: this reverses two requirements the user themselves added
earlier in this same project — `FR-AI-1` ("AI subsystem is delivered and deployed as its own
independent service") and `NFR-10` (independent scaling + blast-radius isolation of the AI
subsystem). The user has explicitly confirmed proceeding in-process anyway, given `@google/adk`
is now GA/mature (v1.6.0, actively maintained) — this plan therefore includes a **formal spec
amendment** to `docs/PRODUCT_SPECIFICATION.md` recording that reversal as deliberate, not a silent
architecture change. Chakra UI **v3** is confirmed (its CSS-variable-first theming maps directly
onto the existing single-CSS-custom-property tenant branding mechanism).

## Key architecture decisions (from research)

- **Data layer**: keep TypeORM (user-confirmed) — port the existing per-tenant `DataSource`
  registry/migration/repository pattern into the new app largely as-is. Do not switch to
  Prisma/Drizzle.
- **AI**: real `@google/adk` package (not a hand-rolled fake), in-process. Write one
  `OpenRouterLlm extends BaseLlm` (`src/server/ai/adk/openrouter-llm.ts`, ~150-300 LOC, calls
  OpenRouter's OpenAI-compatible `chat/completions` endpoint directly — no LiteLLM needed in
  Node), registered via `LLMRegistry.register`. Use ADK's `InMemorySessionService` only — **do
  not** adopt ADK's MikroORM-backed persistent session store (would introduce a second ORM); all
  durable pipeline state (watermark/heartbeat/lease/budget/resume) stays owned by TypeORM tenant
  tables exactly as today. The existing `AiModelResolver` (tenant → allowlisted OpenRouter model
  id) ports unchanged. The old 5 REST operations (`classify-content`, `generate-lesson-batch`,
  `extract-exam-page`, `classify-subject`, `prompt-practice`) become 5 typed in-process functions,
  each still wrapped in the existing timeout/retry/circuit-breaker discipline (`BaseLlm`'s
  `abortSignal` param supports this directly).
- **Multi-tenancy in Next.js**: `middleware.ts` (Node runtime, not Edge) derives the tenant slug
  from `Host` and does the cached lookup exactly as `TenantResolutionMiddleware` does today, then
  passes `x-tenant-id`/`x-tenant-slug`/`x-tenant-schema` as trusted headers — it does **not** try
  to carry `AsyncLocalStorage` across the middleware→handler boundary (Next.js doesn't guarantee
  that continuation the way Nest's Express chain does). Every Route Handler/Server Action wraps
  its body in a shared `withTenantContext(request, handler)` that reads those headers, acquires
  the pooled `DataSource` (module-singleton registry cached on `globalThis` to survive Next.js
  dev-mode reloads), and runs the handler inside `als.run(ctx, handler)`. Server Components use
  `React.cache()` instead of ALS for tenant-context reads (officially guaranteed per-request
  memoization; ALS-through-RSC is not documented/guaranteed).
- **Background workers**: **not** merged into the web process. Same image, `ROLE` env var selects
  `node server.js` (web) vs `node worker.js` (the same 5 `setInterval`-based workers, same
  DB-lease-claim safety, ported near-verbatim from `apps/api/src/worker.ts`, just constructed
  without a DI container). "Single container **image**" (one Dockerfile/artifact) is satisfied;
  "single running **process**" is deliberately not attempted, to avoid heavy PDF/AI ticks
  head-of-line-blocking HTTP requests in the same event loop — this mirrors today's `docker-compose.yml`
  api/worker shape exactly.
- **Auth**: custom JWT via `jose` (not NextAuth.js) — reuses the exact existing dual-realm claim
  shapes verbatim (`typ='tenant-user'`/`aud='tenant'` vs `typ='platform-admin'`/`aud='platform'`,
  same secrets/expiry/replay checks). NextAuth is architected around one session strategy per app
  and has no primitive for ExamLand's two structurally-separate auth realms; forcing it through
  would fight the library for no benefit.
- **Branding/theming**: `color-contrast.ts` (`normalizeHex`/`relativeLuminance`/`contrastRatio`/
  `validateAccent`) ports verbatim — pure functions, zero framework dependency. `PATCH
  /api/tenant/branding` remains the only place `validateAccent` runs (client never validates).
  New `src/components/theme/accent-scale.ts` derives a Chakra-required 50-900 shade ramp from the
  single persisted accent hex at runtime (Chakra v3 `createSystem`/`defineConfig` tokens,
  `colors.accent.{50..900}`, base 500 = `var(--brand-accent)`). Server-render the CSS var on
  `<html>` in the root layout to eliminate the FOUC the Angular client-fetch pattern had to
  tolerate.
- **Files**: `POST /files/sign`/`GET /files/d/[...path]` port to Route Handlers; HMAC+expiry check
  stays the sole authorization gate on the public download route; Range-request handling
  (`parseRangeHeader`, 206/416) ports as a pure function; `Readable.toWeb()` bridges the storage
  stream to the Fetch `Response` Route Handlers require.
- **Docker/compose**: drop `docker/docker-compose.ai.yml` entirely (no more `ai-engine`,
  `certs-init`, `examland-certs` volume, or mTLS material) — the single biggest compose
  simplification. New compose: `web` (`ROLE=web`, port exposed), `worker` (`ROLE=worker`, no
  ports), `mysql` (unchanged, same tenant-schema-privilege init script), `qdrant` (unchanged),
  `mailhog` (unchanged). `OPENROUTER_API_KEY` now present on both `web` and `worker` — an accepted
  credential-scope trade, called out in the spec amendment.
- **"AI-less deployment" replacement**: HLD §8.4's old "don't deploy the second image" option
  becomes an `AI_ENABLED=false` in-app feature flag in the one image (small, derivative — build
  this as part of the AI phase, not a separate design pass).

## Old-stack disposition

**Keep `apps/api`, `apps/web`, `services/ai-engine` fully intact and running throughout the
migration** — do not delete per-module, do not delete immediately. Do one rename at the start of
Phase 0 (`apps/api`→`legacy/api`, `apps/web`→`legacy/web`, `services/ai-engine`→`legacy/ai-engine`,
their docker-compose files moved/kept alongside) as a soft freeze that also frees the directory
names. This preserves the old stack as a running reference (diff actual behavior/response shapes
against it, e.g. exact error-body formats) and a safety net (old code still runnable side-by-side
if the final e2e pass finds a regression introduced several phases earlier). Only delete `legacy/`
after the new docker-compose stack is up, seeded, and the final e2e checklist is fully green.

## New app structure

Build in a new top-level directory `apps/next`. `packages/contracts` is kept and consumed
directly by both server and client code (no second REST-contract layer needed). Top-level shape:

```
apps/next/
  src/
    app/
      (tenant)/…        dashboard, exam-types, curricula, attempts, practice,
                         pdf-processing, profile, settings/branding, users
      (platform)/…       tenants, billing, packages, ai-models, platform auth
      (public)/…         login/register/forgot-password
      api/                auth/…, tenant/…, platform/…, files/sign, files/d/[...path],
                          billing/webhook, health/…
    server/                framework-agnostic ported business logic
      config/, context/ (request-context.ts ALS + withTenantContext/withPlatformAuth),
      tenancy/, auth/, rbac/, users/, profile/, taxonomy/, curricula/, exam-authoring/,
      pdf-processing/, attempts/, practice/, files/, reliability/, vector/,
      ai/adk/{openrouter-llm.ts, agents/*}, ai/ai-runner.ts, ai/ai-model-resolver.ts,
      platform/{tenants, billing, provisioning, ai-models},
      infrastructure/{database/{migrations/platform,migrations/tenant,entities}, storage, mail, payments},
      workers/{outbox-publisher.ts, stale-session-recovery.worker.ts,
               attempt-timeout-sweeper.worker.ts, tenant-maintenance.worker.ts, worker-entrypoint.ts}
    components/ui/, components/theme/    Chakra v3 system + design system
  middleware.ts
  next.config.ts    output: 'standalone'
```

Every existing bounded-context boundary from HLD §3 (a module reachable only through its own
service interface; AI/vector/storage single-chokepoint rules) is preserved as a plain-TypeScript
module boundary + an ESLint import-restriction rule (no DI container to enforce it structurally
the way Nest's module system did — the lint rule is the replacement enforcement mechanism and must
be written, not assumed).

## Phase sequence (vertical slices — backend + Chakra UI together per phase)

0. **Bootstrap & shared infra** — app skeleton, Chakra v3 theme/shell, TypeORM per-tenant
   DataSource wiring, config/env (zod), pino logging, `/api/health`, base Dockerfile,
   `packages/contracts` wired in. Exit: boots, health green, one placeholder page renders.
1. **Identity & tenancy foundation** (largest, everything depends on it) — `platform/tenants`,
   `tenancy/provisioning` (all steps incl. create-subscription), `auth` (dual-realm JWT, password
   recovery, Google auth bridge), `rbac`, `users`, `profile`, **package/feature/subscription
   catalog migration+seed+read-path** (ported verbatim from
   `1730000000012-seed-feature-package-catalog.ts` — pulled forward here because
   `CreateSubscriptionStep` hard-depends on the `starter` package existing), `reliability`
   (outbox), `files` (signed delivery, needed as shared infra by later upload features). Exit:
   provision a tenant end-to-end via the real workflow, log in to both realms, RBAC-deny a route.
   **Heavier verification here** (see below) since a silent bug here poisons every later phase.
2. **Platform Admin console + tenant maintenance** — `platform/billing` (Stripe),
   `platform/ai-models` (allowlist admin), packages/features CRUD UI, `platform/audit`,
   `platform/reliability` dashboards, platform console UI, tenants CRUD UI, `TenantMaintenanceWorker`.
   Exit: a Platform Admin can fully operate the platform through the UI alone.
3. **Taxonomy & curricula** — pure content-model phase, no AI dependency yet.
4. **Exam authoring** — depends on Phase 3's classification.
5. **AI & vector platform layer** (infra-only, the actual pivot) — in-process ADK-TS +
   OpenRouter, `AI_ENABLED` flag, `ai-models` resolution wiring, embeddings provider, Qdrant
   single-chokepoint adapter + tenant-payload-filter isolation, AI cost accounting. Validate with
   **one small AI-backed smoke feature** (e.g. generate 1 practice question from a curriculum
   snippet) before the two heaviest AI consumers land on top. Exit: one round-trip LLM call + one
   vector upsert/query work end-to-end against real OpenRouter/Qdrant.
6. **PDF processing** (79 files — its own phase) — upload/extraction/finalize/dedup/
   stale-session-recovery/similar-questions, `StaleSessionRecoveryWorker`. Depends on 3/4/5.
7. **Attempts** (exam-taking + timeout sweeper) — depends on Phase 4's question bank + rbac.
8. **Practice** (prompt/lesson/full-bank) — depends on Phase 5 and 3/4/6's content.
9. **Settings & dashboard** — tenant branding/self-serve billing view (depends on Phase 2),
   dashboard (aggregates across 3-8, deliberately last).
10. **Final e2e validation + new docker-compose + legacy decommission.**

Rationale for anything non-obvious: package catalog is pulled into Phase 1 (not left with
billing) purely because of the `CreateSubscriptionStep` hard dependency proven in the existing
code, not a stylistic choice. AI/vector gets its own standalone phase specifically because it's
both a feature dependency *and* the one place the target architecture actually changed shape —
isolating it lets a bug surface against a tiny smoke feature instead of inside PDF-processing's
79-file surface.

## Per-phase verification (lightweight, not the old heavy QA-gate process)

After every phase, run the same fixed, cheap recipe (a few minutes, no new heavy test-writing):

1. `next build` (production build compiles every route/action/page — catches most cross-phase
   breakage: broken imports, contract type drift, missing env-schema entries).
2. `eslint --max-warnings=0` on the whole app.
3. Run accumulated TypeORM migrations against a throwaway MySQL schema (`docker-compose.dev.yml`'s
   `mysql` service) — catches entity/migration drift immediately.
4. Unit tests scoped to that phase's own new pure-logic code only (permission resolution,
   feature-usage default-deny, DTO validation) — not integration suites.
5. **A cumulative smoke script** (`smoke/*.ts`, run against the app booted with real deps): 2-5
   critical-path HTTP calls per phase, appended to the same growing script every phase (never
   delete/skip a prior phase's assertions) — by Phase 9 this is a real regression net covering
   every phase's happy path without ever writing a full per-phase e2e suite.
6. One rendered-page Playwright smoke check per new UI route (loads, no console error, key text
   present) — not a full user-journey test.

**Exception**: after Phase 1 specifically, additionally adapt and run the core assertions from
`auth.e2e-spec.ts`, `tenant-resolution.e2e-spec.ts`, `rbac.e2e-spec.ts`, and
`provisioning-workflow.e2e-spec.ts` — justified because a broken tenant-resolution/RBAC bug here
wouldn't necessarily fail a build/typecheck check.

When writing each phase's smoke assertions, pull the 2-4 highest-value business-rule assertions
from that phase's corresponding old `apps/api/test/*.e2e-spec.ts` file(s) rather than inventing
test cases from scratch — that suite (60 files) is the "goldmine" the user referenced.

## Final e2e validation (Phase 10)

Do not literally port all ~60 old spec files verbatim (that reconstructs the heavy process the
user is avoiding). Assemble **one** consolidated black-box Playwright e2e suite against the new
running `docker-compose` stack, organized by these functional clusters (assertion content adapted
from the old suite, not copy-pasted 1:1):

1. Identity/tenancy (auth, rbac, provisioning, tenant-resolution, tenant isolation)
2. Billing/catalog (billing, tenant-billing, package catalog, feature-usage incl. concurrency)
3. AI governance/quality (model governance, cost accounting, confidence calibration, generation
   evaluation, **AI-outage-isolation adapted** to "AI_ENABLED=false or misconfigured never breaks
   the rest of the app")
4. Content model (taxonomy, curricula ingestion)
5. Exam authoring
6. PDF processing (the largest cluster — pdf-processing, append, exam-extraction, image
   extraction/RAG/rendering, reference indexing, review/finalize, semantic dedup, generation
   budget, restart/resume, similar-questions)
7. Attempts/practice (attempts, full-bank-assessment restart, prompt/lesson practice, lesson
   generation restart)
8. Cross-cutting (files delivery, reliability workers, vector bootstrap + tenant isolation,
   general health, a new Next.js-appropriate module-boundary lint-rule test replacing the old
   NestJS-shaped `eslint-boundary.e2e-spec`)

Prioritize: multi-tenant isolation (schema-per-tenant + Qdrant payload-filter), fail-closed/
default-deny rules (RBAC, feature usage), full role-journeys end to end (Platform Admin: provision
tenant → assign package; Tenant Admin: invite user → author exam → upload PDF → finalize; Learner:
practice → attempt → results), concurrency correctness, and AI-disabled degraded mode. Also
validate the seed step itself (exact expected row counts/shape) and a cold `docker compose up` +
health check from a fresh volume.

## New docker-compose + seed (Phase 10)

New root compose (replaces the current one): `web` (the one image, `ROLE=web`, port exposed,
`/api/health` healthcheck), `worker` (same image, `ROLE=worker`, no ports), `mysql` (unchanged,
same `t\_%` grants init script), `qdrant` (unchanged), `mailhog` (kept, needed to verify
password-recovery/admin-invite emails in the final e2e pass). No `ai-engine`/`certs-init`/mTLS
material.

Seed script (`docker compose run --rm web npm run seed`, idempotent):
1. Run platform migrations.
2. Seed the package/feature catalog **verbatim from the existing approved dataset** (9 features,
   starter/pro/enterprise with their already-approved limits — do not reinvent tier numbers).
3. Seed one Platform Admin (`PLATFORM_ADMIN_BOOTSTRAP_EMAIL`/`_PASSWORD` convention, reused).
4. Provision 2-3 demo tenants **through the real provisioning workflow** (not raw inserts) — one
   per package tier (starter/pro/enterprise) — exercising real schema creation, RBAC seeding, and
   subscription creation.
5. For each tenant, seed a Tenant Admin with a **known password set directly** (documented,
   intentional deviation from production's invite-only flow — justified because this compose
   stack is for immediate local/e2e login, not modeling the production invite email).

## Spec amendment (do this before/alongside Phase 0)

Add a dated amendment to `docs/PRODUCT_SPECIFICATION.md` (mirroring the style of the existing
2026-08-08 HLD amendment) recording: FR-AI-1 changes from "delivered as its own independent
service" to "delivered in-process within the application, gated by an `AI_ENABLED` flag"; NFR-10's
independent-scaling/blast-radius-isolation language is superseded by an explicit accepted-risk
note (shared process/container, shared credential scope) — user-directed trade for deployment
simplicity. Update `docs/architecture/HLD.md`/`LLD.md` accordingly as part of Phase 0/5's own work
rather than as a separate pass.

## Verification

- Each phase's own lightweight recipe (build/lint/migration-check/unit/cumulative smoke/page
  smoke) run and green before moving to the next phase.
- Phase 1 gets the additional heavier adapted-e2e pass described above.
- Phase 10 runs the full consolidated Playwright e2e suite against a freshly-built, freshly-seeded
  `docker compose up` stack from a cold volume, plus confirms the seed step's exact expected data
  shape.
- Delete `legacy/` only after Phase 10's full suite is green.
