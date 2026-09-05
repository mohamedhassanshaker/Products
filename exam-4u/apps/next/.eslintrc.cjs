/**
 * `apps/next`'s own ESLint config (ESLint 8 legacy format, matching the rest of the repo's tooling
 * — see the root `.eslintrc.cjs` for the equivalent pattern applied to `apps/api`).
 *
 * `root: true` is deliberate: the repo-root `.eslintrc.cjs` is also `root: true` with no JSX-aware
 * parser options and `overrides` scoped only to `apps/api/src/**`, so it can't correctly lint this
 * app's `.tsx` files anyway. ESLint's legacy config cascade walks up from each linted file and stops
 * at the first `root: true` it finds — setting it here means every file under `apps/next` is linted
 * *only* by this config, never falling through to (or merging with) the repo-root one. This mirrors
 * how `legacy/web`/`legacy/api` each already own their own lint surface.
 *
 * Module-boundary enforcement (docs/plans/nextjs-rewrite-phase0-plan.md decision 5): this is the
 * plain-TypeScript replacement for NestJS's DI-container-enforced module boundaries (HLD §3 /
 * migration plan: "no DI container to enforce it structurally... the lint rule is the replacement
 * enforcement mechanism and must be written, not assumed"). Each `src/server/<module>` directory
 * gets its own `no-restricted-imports` override below, denying a glob-star deep import into that
 * module except its own barrel (index file) — this matches on the import specifier text as written
 * (works for both the `@/server/<module>` alias form and a bypassing relative-path form), and does
 * NOT match a module's own internal relative imports (e.g. `./env.schema` from inside
 * `server/config/index.ts`), since those never spell out the module's own directory name in the
 * specifier. Verbose (one override per module) rather than one clever recursive glob, deliberately
 * — see the root `.eslintrc.cjs`'s own header comment for the identical "verbose but correct"
 * judgment call this repo already established.
 *
 * **Phase 1 fix (docs/plans/nextjs-rewrite-phase1-plan.md "Decisions made")**: every `group` pattern
 * below now recurses into the module directory with a double-star segment (see the actual pattern
 * arrays further down this file), not Phase 0's single-star-segment form. Phase 0's `config`/
 * `logging` modules happened to have no nested subfolders yet, so a single-segment wildcard "worked"
 * there by accident — it would NOT have matched a deeper import like
 * `@/server/infrastructure/database/tenant/tenant-data-source-registry` (two path segments past the
 * module directory name), which this dispatch's new `tenant`/`migrations`/`platform/entities`
 * subfolders now make a real, exploitable gap. Fixed application-wide for consistency rather than
 * leaving Phase 0's three modules on the old (accidentally-correct) pattern
 * while only the new modules get the fixed one.
 */

/** `server/config` is reachable only via its barrel (`index.ts`) — `env.schema.ts` holds the only
 * `process.env` read in this app (LLD §2's "no other file may read `process.env`" rule, ported). */
const CONFIG_BARREL_ONLY = {
  group: ['**/config/**', '!**/config/index*'],
  message:
    'Import server/config only via its barrel (@/server/config) — do not reach into env.schema.ts ' +
    'or other internals directly (module-boundary rule, docs/plans/nextjs-rewrite-phase0-plan.md).',
};

/** `server/logging` is reachable only via its barrel — keeps the pino instance a true
 * process-wide singleton constructed in exactly one place. */
const LOGGING_BARREL_ONLY = {
  group: ['**/logging/**', '!**/logging/index*'],
  message:
    'Import server/logging only via its barrel (@/server/logging) — do not import the pino ' +
    'instance builder directly (module-boundary rule, docs/plans/nextjs-rewrite-phase0-plan.md).',
};

/** `server/infrastructure/database` is reachable only via its barrel — mirrors LLD §1.4's "modules
 * may not import platform infrastructure internals or PlatformDataSource" rule: nothing outside this
 * module may construct or reach into the platform/tenant DataSource internals directly. */
const DATABASE_BARREL_ONLY = {
  group: ['**/database/**', '!**/database/index*'],
  message:
    'Import server/infrastructure/database only via its barrel (@/server/infrastructure/database) ' +
    '— do not import platform-data-source.ts / tenant/** / migrations/** / platform/entities/** ' +
    'directly (module-boundary rule, docs/plans/nextjs-rewrite-phase0-plan.md).',
};

/** `server/tenancy` (added Phase 1 sub-slice 1a) is reachable only via its barrel — the shared
 * provisioning-domain vocabulary (`ProvisioningStep`/`ProvisioningContext`/`EmailPort`) every
 * provisioning step and the orchestrator depend on. */
const TENANCY_BARREL_ONLY = {
  group: ['**/tenancy/**', '!**/tenancy/index*'],
  message:
    'Import server/tenancy only via its barrel (@/server/tenancy) — do not import ' +
    'provisioning.types.ts / errors.ts / email.port.ts directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase1-plan.md).',
};

/** `server/infrastructure/mail` (added Phase 1 sub-slice 1a) is reachable only via its barrel —
 * mirrors `infrastructure/database`'s identical "third-party/concrete-adapter internals confined to
 * infrastructure/" rule. */
const MAIL_BARREL_ONLY = {
  group: ['**/infrastructure/mail/**', '!**/infrastructure/mail/index*'],
  message:
    'Import server/infrastructure/mail only via its barrel (@/server/infrastructure/mail) — do not ' +
    'import noop.adapter.ts / branded-email.template.ts directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase1-plan.md).',
};

/** `server/platform/tenants` (added Phase 1 sub-slice 1a) is reachable only via its barrel — tenant
 * CRUD domain/infrastructure/application internals.
 *
 * **Phase 2 fix** (found while adding `app/api/platform/tenants/**` Route Handlers this dispatch — the
 * exact same class of latent gap `PROFILE_BARREL_ONLY`'s own Phase 1 exception-closure fix already
 * documented): the `group` was a bare `**\/platform/tenants/**`, which — unlike `files`/`auth`/`users`/
 * `profile` (all correctly scoped to `**\/server/<module>/**`) — also matches this dispatch's own new
 * `app/api/platform/tenants/**` Route Handler files purely because their path contains the segment
 * sequence `platform/tenants/`. That would silently block a legitimate external caller (a test invoking
 * the real exported route handlers, exactly this dispatch's own verification need — see
 * `docs/plans/nextjs-rewrite-phase2-plan.md`) from importing `@/app/api/platform/tenants/route` /
 * `@/app/api/platform/tenants/[id]/suspend/route` etc., which are ordinary Next.js route modules, not
 * `server/platform/tenants`'s internals. Scoped to `**\/server/platform/tenants/**` to match the
 * `files`/`auth`/`users`/`profile` precedent exactly — this narrows, not loosens, what the rule blocks
 * (still fully denies any deep import of `server/platform/tenants`'s own `domain/**`/
 * `infrastructure/**`/`application/**`). */
const PLATFORM_TENANTS_BARREL_ONLY = {
  group: ['**/server/platform/tenants/**', '!**/server/platform/tenants/index*'],
  message:
    'Import server/platform/tenants only via its barrel (@/server/platform/tenants) — do not ' +
    'import domain/**, infrastructure/**, or application/** directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase1-plan.md).',
};

/** `server/platform/billing` (added Phase 1 sub-slice 1a) is reachable only via its barrel — the
 * package/feature/subscription catalog repositories plus (Phase 2 sub-slice "2c") the Stripe
 * checkout/webhook/subscription-reassignment application services.
 *
 * **Phase 2 sub-slice "2c" fix**: the `group` pattern was a bare `**\/platform/billing/**` since
 * Phase 1a — flagged as a still-latent, not-yet-triggered risk by sub-slice 2b's own "Explicitly out
 * of scope" note, which correctly predicted this dispatch (the first to add
 * `app/api/platform/billing/**` Route Handler files) would trip it: a bare pattern also matches this
 * dispatch's own `app/api/platform/billing/webhook/route.ts` purely because its path contains the
 * literal segment sequence `platform/billing`, incorrectly blocking a legitimate external caller (this
 * dispatch's own real-route integration test) from importing it. Fixed the same way
 * `PLATFORM_TENANTS_BARREL_ONLY`/`PROFILE_BARREL_ONLY` were already fixed for the identical class of
 * gap: narrowed (not loosened) to `**\/server/platform/billing/**`, which still fully denies any deep
 * import of `server/platform/billing`'s own `domain/**`/`infrastructure/**`/`application/**`. */
const PLATFORM_BILLING_BARREL_ONLY = {
  group: ['**/server/platform/billing/**', '!**/server/platform/billing/index*'],
  message:
    'Import server/platform/billing only via its barrel (@/server/platform/billing) — do not ' +
    'import domain/**, infrastructure/**, or application/** directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase1-plan.md).',
};

/** `server/infrastructure/payments` (added Phase 2 sub-slice "2c") is reachable only via its barrel —
 * the only module allowed to import the `stripe` SDK. Scoped to
 * `**\/server/infrastructure/payments/**` from the start (not a bare `**\/infrastructure/payments/**`
 * or `**\/payments/**`) — the exact lesson `PLATFORM_BILLING_BARREL_ONLY`'s own fix above documents,
 * applied here from the first commit rather than after the fact. */
const PAYMENTS_BARREL_ONLY = {
  group: ['**/server/infrastructure/payments/**', '!**/server/infrastructure/payments/index*'],
  message:
    'Import server/infrastructure/payments only via its barrel (@/server/infrastructure/payments) — ' +
    'do not import stripe.adapter.ts directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase2-plan.md).',
};

/** `server/platform/provisioning` (added Phase 1 sub-slice 1a) is reachable only via its barrel —
 * the tenant-provisioning orchestration workflow and its steps. */
const PLATFORM_PROVISIONING_BARREL_ONLY = {
  group: ['**/platform/provisioning/**', '!**/platform/provisioning/index*'],
  message:
    'Import server/platform/provisioning only via its barrel (@/server/platform/provisioning) — do ' +
    'not import tenant-provisioning.service.ts / steps/** / the lock/ledger internals directly ' +
    '(module-boundary rule, docs/plans/nextjs-rewrite-phase1-plan.md).',
};

/** `server/context` (added Phase 1 sub-slice 1b) is reachable only via its barrel — the ALS-backed
 * per-request context store plus `withTenantContext`/`withPlatformAuth`. */
const CONTEXT_BARREL_ONLY = {
  group: ['**/context/**', '!**/context/index*'],
  message:
    'Import server/context only via its barrel (@/server/context) — do not import ' +
    'request-context.ts / tenant-context.ts / with-tenant-context.ts / with-platform-auth.ts ' +
    'directly (module-boundary rule, docs/plans/nextjs-rewrite-phase1-plan.md).',
};

/** `server/infrastructure/security` (added Phase 1 sub-slice 1b) is reachable only via its barrel —
 * the `bcrypt`/`jose`/`google-auth-library` adapters both auth realms depend on; nothing outside this
 * module may import those third-party packages directly. */
const SECURITY_BARREL_ONLY = {
  group: ['**/infrastructure/security/**', '!**/infrastructure/security/index*'],
  message:
    'Import server/infrastructure/security only via its barrel (@/server/infrastructure/security) — ' +
    'do not import the bcrypt/jose/google-auth-library adapter files directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase1-plan.md).',
};

/** `server/auth` (added Phase 1 sub-slice 1b) is reachable only via its barrel — tenant-realm
 * (dual-realm JWT) authentication domain/infrastructure/application/api internals. */
const AUTH_BARREL_ONLY = {
  group: ['**/server/auth/**', '!**/server/auth/index*'],
  message:
    'Import server/auth only via its barrel (@/server/auth) — do not import domain/**, ' +
    'infrastructure/**, application/**, or api/** directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase1-plan.md).',
};

/** `server/rbac` (added Phase 1 sub-slice 1b) is reachable only via its barrel — role/permission
 * CRUD, permission resolution, and the `requirePermission` guard-equivalent helper. */
const RBAC_BARREL_ONLY = {
  group: ['**/rbac/**', '!**/rbac/index*'],
  message:
    'Import server/rbac only via its barrel (@/server/rbac) — do not import domain/**, ' +
    'infrastructure/**, application/**, or api/** directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase1-plan.md).',
};

/** `server/platform/auth` (added Phase 1 sub-slice 1b) is reachable only via its barrel —
 * platform-admin-realm (dual-realm JWT) authentication internals. */
const PLATFORM_AUTH_BARREL_ONLY = {
  group: ['**/platform/auth/**', '!**/platform/auth/index*'],
  message:
    'Import server/platform/auth only via its barrel (@/server/platform/auth) — do not import ' +
    'domain/**, infrastructure/**, or application/** directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase1-plan.md).',
};

/** `server/reliability` (added Phase 1 sub-slice 1c) is reachable only via its barrel — the
 * transactional-outbox pattern (`OutboxRepository`/`OutboxPublisherService`) plus the file-cleanup
 * deferred-delete queue.
 *
 * **Phase 2 sub-slice "2d" fix**: the `group` was a bare `**\/reliability/**` since Phase 1c — the
 * exact same class of latent gap `PLATFORM_TENANTS_BARREL_ONLY`/`PLATFORM_BILLING_BARREL_ONLY` were
 * already fixed for, found this dispatch while adding the new `server/platform/reliability` module
 * (FR-REL-1's platform-schema `tenant_work_hint` read side + the Reliability dashboard aggregation):
 * a bare pattern also matches `server/platform/reliability/**` purely because its path contains the
 * literal segment "reliability", which would incorrectly block that brand-new module's own internal
 * relative imports (e.g. `application/work-hints.service.ts` importing
 * `../infrastructure/work-hint.repository`) even though neither file is any part of *this* module's
 * internals. Fixed the same way precedent established: narrowed (not loosened) to
 * `**\/server/reliability/**`, confirmed via a deliberately-added-then-reverted violation. */
const RELIABILITY_BARREL_ONLY = {
  group: ['**/server/reliability/**', '!**/server/reliability/index*'],
  message:
    'Import server/reliability only via its barrel (@/server/reliability) — do not import ' +
    'domain/**, infrastructure/**, or application/** directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase1-plan.md).',
};

/** `server/platform/audit` (added Phase 2 sub-slice "2d") is reachable only via its barrel — the
 * sole write path for `platform.audit_log` (HLD §5.3). Scoped to `**\/server/platform/audit/**` from
 * the start (not a bare `**\/platform/audit/**`) — the exact lesson `PLATFORM_TENANTS_BARREL_ONLY`'s
 * own Phase 2 fix already documents: a bare pattern would also match a hypothetical
 * `app/api/platform/audit-log/**` Route Handler tree purely because its path could contain the
 * segment sequence `platform/audit`, incorrectly blocking a legitimate external caller. */
const PLATFORM_AUDIT_BARREL_ONLY = {
  group: ['**/server/platform/audit/**', '!**/server/platform/audit/index*'],
  message:
    'Import server/platform/audit only via its barrel (@/server/platform/audit) — do not import ' +
    'domain/**, infrastructure/**, or application/** directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase2-plan.md).',
};

/** `server/platform/reliability` (added Phase 2 sub-slice "2d") is reachable only via its barrel —
 * the platform-schema `tenant_work_hint` read side (`WorkHintsService`) plus the Reliability
 * dashboard's cross-tenant outbox/file-cleanup aggregation. Scoped to
 * `**\/server/platform/reliability/**` from the first commit (not a bare `**\/platform/reliability/**`
 * or `**\/reliability/**`, which would collide with the pre-existing `server/reliability` module — see
 * that module's own Phase 2 sub-slice "2d" fix above for the identical lesson applied in reverse). */
const PLATFORM_RELIABILITY_BARREL_ONLY = {
  group: ['**/server/platform/reliability/**', '!**/server/platform/reliability/index*'],
  message:
    'Import server/platform/reliability only via its barrel (@/server/platform/reliability) — do ' +
    'not import domain/**, infrastructure/**, or application/** directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase2-plan.md).',
};

/** `server/infrastructure/storage` (added Phase 1 sub-slice 1c) is reachable only via its barrel —
 * the concrete `node:fs`-based local-disk adapter; nothing outside this module may import it
 * directly (every consumer depends on `StoragePort` from `server/common/ports` instead). */
const STORAGE_BARREL_ONLY = {
  group: ['**/infrastructure/storage/**', '!**/infrastructure/storage/index*'],
  message:
    'Import server/infrastructure/storage only via its barrel (@/server/infrastructure/storage) — ' +
    'do not import local-disk.adapter.ts directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase1-plan.md).',
};

/** `server/files` (added Phase 1 sub-slice 1c) is reachable only via its barrel — HMAC-signed,
 * expiry-bounded file delivery (`FileSigningService`, `parseRangeHeader`). */
const FILES_BARREL_ONLY = {
  group: ['**/server/files/**', '!**/server/files/index*'],
  message:
    'Import server/files only via its barrel (@/server/files) — do not import domain/** or ' +
    'application/** directly (module-boundary rule, docs/plans/nextjs-rewrite-phase1-plan.md).',
};

/** `server/profile` (added Phase 1 sub-slice 1c) is reachable only via its barrel — authenticated
 * self-service "my profile" read/update/avatar-upload (FR-IAM-4), distinct from `users`' admin
 * surface.
 *
 * **Phase 1 exception-closure fix** (found while adding real-route-level regression tests for
 * `legacy/api/test/profile.e2e-spec.ts`'s adapted assertions): the `group` pattern was originally a
 * bare `**\/profile/**`, which — unlike every sibling module added the same dispatch (`files`/`auth`/
 * `users` all correctly scope to `**\/server/<module>/**`) — also matched `app/api/profile/**`'s own
 * Route Handler files purely because their path happens to contain the word "profile". That silently
 * blocked any legitimate external caller (e.g. a test invoking the real exported route handlers) from
 * importing `@/app/api/profile/route` / `@/app/api/profile/picture/route`, which are ordinary Next.js
 * route modules, not `server/profile`'s internals — the boundary this rule exists to protect. Scoped
 * to `**\/server/profile/**` to match the `files`/`auth`/`users` precedent exactly; this narrows, not
 * loosens, what the rule blocks (it still fully denies any deep import of `server/profile`'s own
 * `domain/**`/`infrastructure/**`/`application/**`). */
const PROFILE_BARREL_ONLY = {
  group: ['**/server/profile/**', '!**/server/profile/index*'],
  message:
    'Import server/profile only via its barrel (@/server/profile) — do not import domain/**, ' +
    'infrastructure/**, or application/** directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase1-plan.md).',
};

/** `server/users` (added Phase 1 sub-slice 1c) is reachable only via its barrel — admin CRUD over
 * other tenant-realm users (FR-IAM-7), distinct from `profile`'s self-service surface. */
const USERS_BARREL_ONLY = {
  group: ['**/server/users/**', '!**/server/users/index*'],
  message:
    'Import server/users only via its barrel (@/server/users) — do not import domain/**, ' +
    'infrastructure/**, or application/** directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase1-plan.md).',
};

/** `server/platform/ai-models` (added Phase 2 sub-slice 2b) is reachable only via its barrel — the
 * OpenRouter model allowlist CRUD + per-tenant assignment (FR-AI-2/FR-AI-3). Scoped to
 * `**\/server/platform/ai-models/**` from the start (not a bare `**\/platform/ai-models/**`) — the
 * exact lesson `PLATFORM_TENANTS_BARREL_ONLY`'s own Phase 2 fix already documents: a bare pattern
 * would also match this dispatch's own `app/api/platform/ai-models/**` Route Handler files purely
 * because their path contains the segment sequence `platform/ai-models/`, incorrectly blocking a
 * legitimate external caller (a test invoking the real exported route handlers) from importing them. */
const PLATFORM_AI_MODELS_BARREL_ONLY = {
  group: ['**/server/platform/ai-models/**', '!**/server/platform/ai-models/index*'],
  message:
    'Import server/platform/ai-models only via its barrel (@/server/platform/ai-models) — do not ' +
    'import domain/**, infrastructure/**, or application/** directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase2-plan.md).',
};

/** `server/taxonomy` (added Phase 3) is reachable only via its barrel — the Education Level → Stage →
 * Subject hierarchy (FR-TAX-1..4). Scoped to `**\/server/taxonomy/**` from the start (not a bare
 * `**\/taxonomy/**`) — the exact lesson `PLATFORM_TENANTS_BARREL_ONLY`'s own Phase 2 fix already
 * documents: a bare pattern would also match this dispatch's own `app/api/taxonomy/**` Route Handler
 * files purely because their path contains the segment "taxonomy", incorrectly blocking a legitimate
 * external caller (a test invoking the real exported route handlers) from importing them. */
const TAXONOMY_BARREL_ONLY = {
  group: ['**/server/taxonomy/**', '!**/server/taxonomy/index*'],
  message:
    'Import server/taxonomy only via its barrel (@/server/taxonomy) — do not import domain/**, ' +
    'infrastructure/**, or application/** directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase3-plan.md).',
};

/** `server/curricula` (added Phase 3) is reachable only via its barrel — Curriculum ownership/metadata
 * (FR-CUR-1/FR-CUR-1a; document management/search is deliberately deferred, see that plan doc). Scoped
 * to `**\/server/curricula/**` from the start for the identical reason `TAXONOMY_BARREL_ONLY` is. */
const CURRICULA_BARREL_ONLY = {
  group: ['**/server/curricula/**', '!**/server/curricula/index*'],
  message:
    'Import server/curricula only via its barrel (@/server/curricula) — do not import domain/**, ' +
    'infrastructure/**, or application/** directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase3-plan.md).',
};

/** `server/exam-authoring` (added Phase 4) is reachable only via its barrel — the manual-ZIP Exam Type
 * authoring flow (FR-AUTH-1/FR-AUTH-3/FR-AUTH-5). Scoped to `**\/server/exam-authoring/**` from the
 * start (not a bare `**\/exam-authoring/**`) — the exact lesson `PLATFORM_TENANTS_BARREL_ONLY`'s own
 * Phase 2 fix already documents: a bare pattern would also match this dispatch's own
 * `app/api/exam-types/**` Route Handler files purely because their path could be construed to relate to
 * exam authoring, incorrectly blocking a legitimate external caller (a test invoking the real exported
 * route handlers) from importing them. */
const EXAM_AUTHORING_BARREL_ONLY = {
  group: ['**/server/exam-authoring/**', '!**/server/exam-authoring/index*'],
  message:
    'Import server/exam-authoring only via its barrel (@/server/exam-authoring) — do not import ' +
    'domain/**, infrastructure/**, or application/** directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase4-plan.md).',
};

/** `server/infrastructure/zip` (added Phase 4) is reachable only via its barrel — exam-authoring ZIP
 * archive parsing/validation (FR-AUTH-1), fully self-contained (no dependency on `server/exam-
 * authoring` — see that module's own doc comment for why these two modules deliberately have a
 * one-way, not circular, dependency). Scoped to `**\/server/infrastructure/zip/**` from the start,
 * matching `STORAGE_BARREL_ONLY`'s own precedent. */
const INFRASTRUCTURE_ZIP_BARREL_ONLY = {
  group: ['**/server/infrastructure/zip/**', '!**/server/infrastructure/zip/index*'],
  message:
    'Import server/infrastructure/zip only via its barrel (@/server/infrastructure/zip) — do not ' +
    'import exam-zip-parser.ts / errors.ts directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase4-plan.md).',
};

/** `server/vector` (added Phase 5) is reachable only via its barrel — `VectorStorePort`/
 * `EmbeddingsPort` (the two ports) plus `VectorBootstrapService`. Scoped to `**\/server/vector/**`
 * from the start (not a bare `**\/vector/**`) — the exact lesson `PLATFORM_TENANTS_BARREL_ONLY`'s
 * own Phase 2 fix already documents: a bare pattern would also match `server/infrastructure/vector/**`
 * (this dispatch's own sibling module, the concrete Qdrant adapter), incorrectly blocking that
 * module's own internal relative imports. */
const VECTOR_BARREL_ONLY = {
  group: ['**/server/vector/**', '!**/server/vector/index*'],
  message:
    'Import server/vector only via its barrel (@/server/vector) — do not import domain/**, ' +
    'application/**, or infrastructure/** directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase5-plan.md).',
};

/** `server/infrastructure/vector` (added Phase 5) is reachable only via its barrel — the sole module
 * allowed to import `@qdrant/js-client-rest`. Scoped to `**\/server/infrastructure/vector/**` from
 * the start, matching `STORAGE_BARREL_ONLY`'s/`PAYMENTS_BARREL_ONLY`'s own precedent (a bare
 * `**\/infrastructure/vector/**` or `**\/vector/**` would collide with the pre-existing `server/
 * vector` module — see that module's own doc comment above for the identical lesson applied in
 * reverse). */
const INFRASTRUCTURE_VECTOR_BARREL_ONLY = {
  group: ['**/server/infrastructure/vector/**', '!**/server/infrastructure/vector/index*'],
  message:
    'Import server/infrastructure/vector only via its barrel (@/server/infrastructure/vector) — do ' +
    'not import qdrant.adapter.ts directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase5-plan.md).',
};

/** `server/infrastructure/embeddings` (added Phase 5) is reachable only via its barrel — the two
 * `EmbeddingsPort` implementations (`null`/`openai-compatible`). Scoped to
 * `**\/server/infrastructure/embeddings/**` from the start, matching `STORAGE_BARREL_ONLY`'s own
 * precedent. */
const INFRASTRUCTURE_EMBEDDINGS_BARREL_ONLY = {
  group: ['**/server/infrastructure/embeddings/**', '!**/server/infrastructure/embeddings/index*'],
  message:
    'Import server/infrastructure/embeddings only via its barrel (@/server/infrastructure/embeddings) ' +
    '— do not import null-embeddings.adapter.ts / openai-compatible-embeddings.adapter.ts directly ' +
    '(module-boundary rule, docs/plans/nextjs-rewrite-phase5-plan.md).',
};

/** `server/ai` (added Phase 5) is reachable only via its barrel — the actual pivot: `AiServicePort`'s
 * real in-process ADK-TS/OpenRouter implementation, `RetrievalService`, `AiUsageRecorderPort`'s
 * persistence-backed implementation. Scoped to `**\/server/ai/**` from the start (not a bare
 * `**\/ai/**`) — matching every sibling module's own established precedent (`VECTOR_BARREL_ONLY`/
 * `INFRASTRUCTURE_VECTOR_BARREL_ONLY` above) of always scoping under the full `server/<module>`
 * prefix rather than a bare directory-name glob, so a future sibling directory that happens to share
 * a short name segment can never silently collide with this rule. */
const AI_BARREL_ONLY = {
  group: ['**/server/ai/**', '!**/server/ai/index*'],
  message:
    'Import server/ai only via its barrel (@/server/ai) — do not import domain/**, application/**, ' +
    'adk/**, or infrastructure/** directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase5-plan.md).',
};

/** `server/infrastructure/text-extraction` (added Phase 6, sub-slice "6a") is reachable only via its
 * barrel — the sole module allowed to import `pdf-parse`. Scoped to
 * `**\/server/infrastructure/text-extraction/**` from the start, matching `STORAGE_BARREL_ONLY`'s/
 * `INFRASTRUCTURE_VECTOR_BARREL_ONLY`'s own precedent. */
const INFRASTRUCTURE_TEXT_EXTRACTION_BARREL_ONLY = {
  group: ['**/server/infrastructure/text-extraction/**', '!**/server/infrastructure/text-extraction/index*'],
  message:
    'Import server/infrastructure/text-extraction only via its barrel ' +
    '(@/server/infrastructure/text-extraction) — do not import pdf-text-extractor.ts directly ' +
    '(module-boundary rule, docs/plans/nextjs-rewrite-phase6-plan.md).',
};

/** `server/pdf-processing` (added Phase 6, sub-slice "6a") is reachable only via its barrel — upload/
 * dedup/extraction/classification/exam-question-extraction (FR-PDF-1/2/3/5) and
 * `StaleSessionRecoveryWorker`. Scoped to `**\/server/pdf-processing/**` from the start (not a bare
 * `**\/pdf-processing/**`) — matching every sibling module's own established precedent of always
 * scoping under the full `server/<module>` prefix, so a future sibling directory/route path segment
 * sharing a short name can never silently collide with this rule (the exact
 * `EXAM_AUTHORING_BARREL_ONLY`/`PLATFORM_TENANTS_BARREL_ONLY` lesson applied again here — this
 * dispatch's own `app/api/pdf-processing/**`/`app/(tenant)/(shell)/pdf-processing/**` routes and pages
 * must remain importable by tests without tripping this rule). */
const PDF_PROCESSING_BARREL_ONLY = {
  group: ['**/server/pdf-processing/**', '!**/server/pdf-processing/index*'],
  message:
    'Import server/pdf-processing only via its barrel (@/server/pdf-processing) — do not import ' +
    'domain/**, infrastructure/**, or application/** directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase6-plan.md).',
};


/** `server/media` (added Phase 6, sub-slice "6b") is reachable only via its barrel — FR-PDF-11/
 * FR-FILE-3's content-hash-deduped, reference-counted image storage/association
 * (`ImageAssociationService`) and vision captioning + retrieval indexing (`ImageCaptioningService`).
 * A NEW module rather than an extension of `server/files` — see that module's own barrel doc comment
 * for the full judgment-call write-up (these two services depend on `server/ai`/`server/vector`, which
 * this app's deliberately-low-level `server/files` shared-infra module must not). Scoped to
 * `**\/server/media/**` from the start (not a bare `**\/media/**`) — matching every sibling module's
 * own established precedent of always scoping under the full `server/<module>` prefix, so a future
 * `app`-side `media` route path segment can never silently collide with this rule. */
const MEDIA_BARREL_ONLY = {
  group: ['**/server/media/**', '!**/server/media/index*'],
  message:
    'Import server/media only via its barrel (@/server/media) — do not import domain/**, ' +
    'application/**, or infrastructure/** directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase6-plan.md).',
};

/** `server/attempts` (added Phase 7) is reachable only via its barrel — exam-taking + adaptive
 * selection (FR-TAKE-1..9) and `AttemptTimeoutSweeper`. Scoped to `**\/server/attempts/**` from the
 * start (not a bare `**\/attempts/**`) — matching every sibling module's own established precedent of
 * always scoping under the full `server/<module>` prefix, so this dispatch's own
 * `app/api/attempts/**`/`app/api/admin/attempts/**`/`app/(tenant)/(shell)/attempts/**` routes/pages
 * remain importable by tests without tripping this rule (the exact `PDF_PROCESSING_BARREL_ONLY`/
 * `EXAM_AUTHORING_BARREL_ONLY` lesson applied again here). */
const ATTEMPTS_BARREL_ONLY = {
  group: ['**/server/attempts/**', '!**/server/attempts/index*'],
  message:
    'Import server/attempts only via its barrel (@/server/attempts) — do not import domain/**, ' +
    'infrastructure/**, or application/** directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase7-plan.md).',
};

/** `server/practice` (added Phase 8) is reachable only via its barrel — live Prompt Practice
 * (FR-CUR-5), bank-first Adaptive Lesson Practice (FR-CUR-6), and the full-bank-assessment feature
 * (FR-PDF-13). Scoped to `**\/server/practice/**` from the start (not a bare `**\/practice/**`) —
 * matching every sibling module's own established precedent of always scoping under the full
 * `server/<module>` prefix, so this dispatch's own `app/api/practice/**`/
 * `app/(tenant)/(shell)/practice/**` routes/pages remain importable by tests without tripping this
 * rule (the exact `ATTEMPTS_BARREL_ONLY`/`PDF_PROCESSING_BARREL_ONLY` lesson applied again here). */
const PRACTICE_BARREL_ONLY = {
  group: ['**/server/practice/**', '!**/server/practice/index*'],
  message:
    'Import server/practice only via its barrel (@/server/practice) — do not import domain/**, ' +
    'infrastructure/**, or application/** directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase8-plan.md).',
};

/** `server/dashboard` (added Phase 9 sub-slice "9c") is reachable only via its barrel — the read-only
 * tenant dashboard aggregating Phases 3-8's own data (curricula/exam types/attempts/practice) through
 * their existing repositories/services, never a second copy of their query logic. Scoped to
 * `**\/server/dashboard/**` from the start, matching every sibling module's own established
 * `server/<module>` prefix convention. */
const DASHBOARD_BARREL_ONLY = {
  group: ['**/server/dashboard/**', '!**/server/dashboard/index*'],
  message:
    'Import server/dashboard only via its barrel (@/server/dashboard) — do not import domain/**, ' +
    'or application/** directly (module-boundary rule, docs/plans/nextjs-rewrite-phase9-plan.md).',
};

/** `server/platform/usage` (added by the post-Phase-10-e2e closure dispatch) is reachable only via its
 * barrel — FR-PKG-5's feature-usage-limit enforcement engine (`FeatureUsageService`,
 * `TenantFeatureUsageRepository`, `requireFeatureLimit`). Scoped to `**\/server/platform/usage/**` from
 * the start (not a bare `**\/platform/usage/**`) — the exact `PLATFORM_TENANTS_BARREL_ONLY`/
 * `PLATFORM_BILLING_BARREL_ONLY` lesson applied from the first commit rather than after the fact, since
 * this dispatch also adds `app/api/tenant/usage/**`, whose path contains the literal segment sequence
 * `tenant/usage` (not `platform/usage`, but still worth the same narrow-scoping discipline). */
const PLATFORM_USAGE_BARREL_ONLY = {
  group: ['**/server/platform/usage/**', '!**/server/platform/usage/index*'],
  message:
    'Import server/platform/usage only via its barrel (@/server/platform/usage) — do not import ' +
    'domain/**, infrastructure/**, application/**, or api/** directly (module-boundary rule, ' +
    'docs/plans/nextjs-rewrite-phase10-plan.md "Post-e2e closure" section).',
};

/** Every module-boundary pattern, keyed by the glob path segment (after `src/server/`) that
 * identifies files belonging to that module — used below to build each override's "every other
 * module's barrel rule, minus my own" rule set without hand-duplicating the list thirteen times.
 * NOTE: `auth`'s `group` uses the `server/auth` prefix (not a bare `**\/auth/**`) since a bare
 * pattern would also match `platform/auth/**` — the two are deliberately distinct modules with
 * distinct barrels. */
const MODULES = [
  { dir: 'config', pattern: CONFIG_BARREL_ONLY },
  { dir: 'logging', pattern: LOGGING_BARREL_ONLY },
  { dir: 'infrastructure/database', pattern: DATABASE_BARREL_ONLY },
  { dir: 'tenancy', pattern: TENANCY_BARREL_ONLY },
  { dir: 'infrastructure/mail', pattern: MAIL_BARREL_ONLY },
  { dir: 'platform/tenants', pattern: PLATFORM_TENANTS_BARREL_ONLY },
  { dir: 'platform/billing', pattern: PLATFORM_BILLING_BARREL_ONLY },
  { dir: 'platform/provisioning', pattern: PLATFORM_PROVISIONING_BARREL_ONLY },
  { dir: 'context', pattern: CONTEXT_BARREL_ONLY },
  { dir: 'infrastructure/security', pattern: SECURITY_BARREL_ONLY },
  { dir: 'auth', pattern: AUTH_BARREL_ONLY },
  { dir: 'rbac', pattern: RBAC_BARREL_ONLY },
  { dir: 'reliability', pattern: RELIABILITY_BARREL_ONLY },
  { dir: 'infrastructure/storage', pattern: STORAGE_BARREL_ONLY },
  { dir: 'files', pattern: FILES_BARREL_ONLY },
  { dir: 'profile', pattern: PROFILE_BARREL_ONLY },
  { dir: 'users', pattern: USERS_BARREL_ONLY },
  { dir: 'platform/auth', pattern: PLATFORM_AUTH_BARREL_ONLY },
  { dir: 'platform/ai-models', pattern: PLATFORM_AI_MODELS_BARREL_ONLY },
  { dir: 'infrastructure/payments', pattern: PAYMENTS_BARREL_ONLY },
  { dir: 'platform/audit', pattern: PLATFORM_AUDIT_BARREL_ONLY },
  { dir: 'platform/reliability', pattern: PLATFORM_RELIABILITY_BARREL_ONLY },
  { dir: 'taxonomy', pattern: TAXONOMY_BARREL_ONLY },
  { dir: 'curricula', pattern: CURRICULA_BARREL_ONLY },
  { dir: 'exam-authoring', pattern: EXAM_AUTHORING_BARREL_ONLY },
  { dir: 'infrastructure/zip', pattern: INFRASTRUCTURE_ZIP_BARREL_ONLY },
  { dir: 'vector', pattern: VECTOR_BARREL_ONLY },
  { dir: 'infrastructure/vector', pattern: INFRASTRUCTURE_VECTOR_BARREL_ONLY },
  { dir: 'infrastructure/embeddings', pattern: INFRASTRUCTURE_EMBEDDINGS_BARREL_ONLY },
  { dir: 'ai', pattern: AI_BARREL_ONLY },
  { dir: 'infrastructure/text-extraction', pattern: INFRASTRUCTURE_TEXT_EXTRACTION_BARREL_ONLY },
  { dir: 'pdf-processing', pattern: PDF_PROCESSING_BARREL_ONLY },
  { dir: 'media', pattern: MEDIA_BARREL_ONLY },
  { dir: 'attempts', pattern: ATTEMPTS_BARREL_ONLY },
  { dir: 'practice', pattern: PRACTICE_BARREL_ONLY },
  { dir: 'dashboard', pattern: DASHBOARD_BARREL_ONLY },
  { dir: 'platform/usage', pattern: PLATFORM_USAGE_BARREL_ONLY },
];

const ALL_PATTERNS = MODULES.map((m) => m.pattern);

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'next/core-web-vitals'],
  env: { node: true, browser: true, es2022: true },
  ignorePatterns: ['.next/', 'node_modules/', 'next-env.d.ts'],
  settings: {
    react: { version: '19' },
  },
  rules: {
    'no-console': ['error', { allow: ['error', 'warn'] }],
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
    ],
  },
  // NOTE (see root .eslintrc.cjs's own header comment for the identical caveat): ESLint 8's legacy
  // overrides cascade *per rule name*, not per option — the most-specific/last-matching override
  // for a given file completely REPLACES any earlier override's options for the same rule name,
  // they do not merge. Every override below therefore re-states the *full* set of barrel-only
  // restrictions that should apply to that directory (every module's rule, minus whichever module
  // the file itself belongs to), rather than only its own incremental addition.
  overrides: [
    // Every file NOT inside any of MODULES.length modules must respect every barrel-only boundary
    // (was "eight" through Phase 1 sub-slice 1b; Phase 1 sub-slice 1c added five more — `reliability`,
    // `infrastructure/storage`, `files`, `profile`, `users` — see MODULES above for the current list).
    {
      files: ['src/**/*.{ts,tsx}'],
      excludedFiles: MODULES.map((m) => `src/server/${m.dir}/**/*.{ts,tsx}`),
      rules: {
        'no-restricted-imports': ['error', { patterns: ALL_PATTERNS }],
      },
    },
    // One override per module: exempt from its own barrel rule, but still must not deep-import any
    // other module's internals.
    ...MODULES.map(({ dir, pattern }) => ({
      files: [`src/server/${dir}/**/*.{ts,tsx}`],
      rules: {
        'no-restricted-imports': ['error', { patterns: ALL_PATTERNS.filter((p) => p !== pattern) }],
      },
    })),
  ],
};
