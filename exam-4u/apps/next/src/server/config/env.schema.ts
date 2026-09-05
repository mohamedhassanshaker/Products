import { z } from 'zod';

/**
 * Single source of truth for every environment variable this app reads (ported pattern from
 * `legacy/api/src/config/env.schema.ts` — LLD §2: "no other file may read `process.env`"). Only
 * `src/server/config/index.ts` (this module's barrel) may import this file directly; every other
 * consumer gets typed, validated values through {@link loadEnv}/{@link getEnv} instead (enforced by
 * `apps/next/.eslintrc.cjs`'s `config` module-boundary rule).
 *
 * Unlike the legacy schema — which pre-declares every var for the whole, already-built product up
 * front — this schema deliberately only declares what Phase 0 actually consumes (app/db/logging).
 * Later phases append their own vars here as each feature needs them (docs/plans/
 * nextjs-rewrite-phase0-plan.md decision log). Notably, the legacy `AI_SERVICE_*`/mTLS variables are
 * NOT ported at all: the migration plan moves AI in-process (OpenRouter called directly, no
 * `AiServicePort`/mTLS hop), so that entire variable family is obsolete shape, not merely deferred.
 */
export const envSchema = z.object({
  // ── App ──────────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  /** FR-MT-1/HLD §4.1: the apex domain every tenant's subdomain is a label of
   * (`{slug}.{PUBLIC_APEX_DOMAIN}`) — ported verbatim from `legacy/api/src/config/env.schema.ts`.
   * Not yet consumed by any HTTP-facing code this phase (no `middleware.ts` yet — Phase 1's next
   * sub-dispatch), but `InviteAdminStep` already needs it to build the invited admin's login URL. */
  PUBLIC_APEX_DOMAIN: z.string().default('examland.app'),
  /** FR-MT-1: comma-separated reserved subdomains a tenant may never claim (`admin`, `www`, ...).
   * Parsed straight into a `string[]` here (rather than legacy's separate `configuration.ts`
   * namespacing layer — this app's flatter `EnvVars`-is-the-config-surface convention, Phase 0
   * decision 1-ish) so every consumer gets an already-split array with no repeated parsing. */
  RESERVED_SUBDOMAINS: z
    .string()
    .default('admin,www,api,app,auth,static,mail,status')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  // ── Database (platform DataSource only this phase — LLD §2 field names/defaults ported
  //    verbatim so a later phase's tenant-registry port can reuse the same names unchanged) ──────
  DB_HOST: z.string().min(1).optional(),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1).optional(),
  DB_PASSWORD: z.string().optional(),
  DB_PLATFORM_SCHEMA: z.string().default('examland_platform'),
  DB_PLATFORM_POOL_MAX: z.coerce.number().int().positive().default(10),
  /** LLD §9.1 tenant `DataSource` registry knobs — ported verbatim (names/defaults) from
   * `legacy/api/src/config/env.schema.ts`'s identical fields. */
  TENANT_POOL_MAX: z.coerce.number().int().positive().default(3),
  TENANT_REGISTRY_MAX: z.coerce.number().int().positive().default(30),
  TENANT_IDLE_TTL_MS: z.coerce.number().int().positive().default(900_000),
  /** FR-MT-1: soft-delete retention window (days) before a tenant becomes purge-eligible. */
  TENANT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  /**
   * TypeORM `synchronize` is architecturally forbidden in every environment, ported verbatim from
   * the legacy schema's identical field/comment (HLD §9 equivalent for the new stack: schema drift
   * must only ever happen through reviewed migrations). Modeled as an env var — always defaulting to
   * and required to equal `false` — so config validation itself is the enforcement mechanism.
   */
  DB_SYNCHRONIZE: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
    .default(false),

  // ── Billing/catalog (FR-PKG-6) ───────────────────────────────────────────
  /** The package key `CreateSubscriptionStep` subscribes every newly-provisioned tenant to, and the
   * same key a `CANCELED` subscription falls back to — ported verbatim from legacy's
   * `FALLBACK_PACKAGE_KEY` (there `config.stripe.fallbackPackageKey`; no `stripe`/billing-provider
   * concept exists yet in this app, so it is a plain top-level var here, not nested under a
   * not-yet-built `billing` namespace). */
  FALLBACK_PACKAGE_KEY: z.string().default('starter'),

  // ── Auth — dual-realm JWT (Phase 1 sub-slice 1b, ported verbatim from legacy's env.schema.ts) ────
  /** Tenant-realm JWT signing secret (`typ='tenant-user'`/`aud='tenant'`). Deliberately a DIFFERENT
   * secret from `JWT_PLATFORM_SECRET` (see the cross-check below) — one of the "three independent
   * barriers" (HLD §5.1) preventing a token minted for one realm from being replayed against the
   * other even if a later bug ever skipped the `aud`/`typ` checks. */
  JWT_TENANT_SECRET: z.string().min(1).optional(),
  /** Platform-realm JWT signing secret (`typ='platform-admin'`/`aud='platform'`). */
  JWT_PLATFORM_SECRET: z.string().min(1).optional(),
  /** Tenant-user token TTL, `(\d+)(s|m|h|d)?` shape (e.g. `'60m'`); unit defaults to seconds if
   * omitted; falls back to 3600s if unparseable — ported verbatim from legacy's `parseTtlToSeconds`. */
  JWT_TENANT_TTL: z.string().default('60m'),
  /** Platform-admin token TTL, same shape/parsing as {@link JWT_TENANT_TTL}. */
  JWT_PLATFORM_TTL: z.string().default('60m'),
  /** bcrypt work factor for both realms' password hashing — ported verbatim (`BCRYPT_COST`,
   * default 12). Test suites may lower this (legacy's own e2e spec overrides to 4) for speed. */
  BCRYPT_COST: z.coerce.number().int().min(4).max(31).default(12),
  /** Idempotent platform-admin bootstrap credentials (ported verbatim) — both must be set together;
   * the bootstrap step no-ops unless `platform_admin` is completely empty (see
   * `PlatformAdminBootstrapService`'s own doc comment). No safe default ships — required only when
   * an operator actually wants a bootstrap admin created. */
  PLATFORM_ADMIN_BOOTSTRAP_EMAIL: z.string().optional(),
  PLATFORM_ADMIN_BOOTSTRAP_PASSWORD: z.string().optional(),

  // ── Auth — tenant-user password policy / reset tokens (ported verbatim) ─────────────────────────
  PASSWORD_MIN_LENGTH: z.coerce.number().int().positive().default(8),
  PASSWORD_REQUIRE_UPPER: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
    .default(true),
  PASSWORD_REQUIRE_LOWER: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
    .default(true),
  PASSWORD_REQUIRE_DIGIT: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
    .default(true),
  PASSWORD_REQUIRE_SYMBOL: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
    .default(false),
  /** Password-reset token validity window, in minutes — ported verbatim (`RESET_TOKEN_TTL_MIN`). */
  RESET_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(60),

  // ── Auth — Google sign-in bridge (FR-MT-6, optional — ported verbatim) ──────────────────────────
  /** The platform-wide Google OAuth client id `GoogleIdTokenVerifierAdapter` verifies ID tokens
   * against. Blank (the default) means Google sign-in is never configured server-side, regardless of
   * any individual tenant's `allowGoogleSignIn` toggle — `signInWithGoogle` throws
   * `GoogleNotConfiguredError` in that case. Not set in this environment (no real Google Cloud OAuth
   * client provisioned) — see docs/plans/nextjs-rewrite-phase1-plan.md's "Decisions made" for the
   * resulting test-seam approach (a fake `GoogleTokenVerifierPort` stands in for real Google
   * verification in this dispatch's own tests). */
  GOOGLE_CLIENT_ID: z.string().default(''),
  /** The fixed non-wildcard origin a frontend Google-sign-in bridge page would run on before handing
   * a verified ID token back to the tenant subdomain (HLD §14 item 3) — a frontend-only concern (no
   * UI exists this dispatch, Phase 1's exit gate is HTTP-only); consumed by no server code path in
   * this dispatch, kept only so the env schema matches legacy's documented full var list. */
  GOOGLE_AUTH_BRIDGE_ORIGIN: z.string().default(''),

  // ── Tenant resolution (Phase 1 sub-slice 1b, ported verbatim from legacy's TenantResolutionMiddleware
  //    /TenantResolutionCache) ─────────────────────────────────────────────────────────────────────
  /** The fixed subdomain slug `middleware.ts` resolves to whenever `NODE_ENV` is NOT `production`/
   * `staging` (i.e. every local dev/test run) — the `Host` header is ignored entirely in that case,
   * exactly matching `TenantResolutionMiddleware.deriveSlug`'s documented dev-convenience bypass. */
  DEFAULT_TENANT_SUBDOMAIN: z.string().default('default'),
  /** Positive-lookup cache TTL (ms) — ported verbatim (`TENANT_CACHE_TTL_MS`, default 60000). */
  TENANT_CACHE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  /** Negative ("no such tenant") cache TTL (ms) — ported verbatim (`TENANT_CACHE_NEG_TTL_MS`, default
   * 15000) — deliberately caches misses too, to blunt subdomain-enumeration DB hammering. */
  TENANT_CACHE_NEG_TTL_MS: z.coerce.number().int().positive().default(15_000),

  // ── Transactional email (FR-MT-7, minimal — full branding-aware SMTP delivery is a later phase's
  //    job; this phase only needs enough to satisfy InviteAdminStep's branded-email render) ───────
  /** The accent color `renderBrandedEmail` highlights the tenant name with when no per-tenant
   * override exists yet (branding read/write itself — `color-contrast.ts`, `PATCH
   * /api/tenant/branding` — is Phase 9 scope per the migration plan, not this dispatch). Matches
   * `branded-email.template.ts`'s own hardcoded fallback so this default is a no-op until Phase 9
   * introduces a real per-tenant override. */
  THEME_DEFAULT_ACCENT_COLOR: z.string().default('5C6BC0'),

  // ── Tenant branding (FR-MT-10, Phase 9 sub-slice "9a") — `nexus-ux`-published WCAG 2.2 AA contrast
  //    anchors `color-contrast.ts`'s `validateAccent` checks every candidate accent override against.
  //    Ported verbatim from legacy's `ThemeConfig` (`config/configuration.ts`: `surfaceLight`/
  //    `surfaceDark`/`accentContrastMinRatio`). ────────────────────────────────────────────────────
  /** The light-mode surface anchor (a 6-digit hex, no `#`) a candidate accent's contrast is checked
   * against. Legacy's default is pure white — this app's UI has no dark-mode surface built yet, but the
   * dark anchor below is still validated against so a color that would fail once dark mode ships is
   * rejected up front, matching legacy's own forward-looking validation. */
  THEME_SURFACE_LIGHT: z.string().default('FFFFFF'),
  /** The dark-mode surface anchor (a 6-digit hex, no `#`). */
  THEME_SURFACE_DARK: z.string().default('121212'),
  /** WCAG 2.2 AA non-text/large-scale UI component minimum contrast ratio (`>= 3.0`). */
  ACCENT_CONTRAST_MIN_RATIO: z.coerce.number().positive().default(3.0),

  // ── Storage / signed file delivery (Phase 1 sub-slice 1c, ported verbatim from legacy's
  //    env.schema.ts) — FR-FILE-1/FR-FILE-2, FR-IAM-4's avatar upload ────────────────────────────
  /** Only `'local'` has a real adapter this dispatch (`LocalDiskStorageAdapter`) — `'s3'` is kept as
   * an enum option (matching legacy's forward-looking shape) but `createStoragePort()` throws if it
   * is ever selected, since no s3 adapter exists yet. */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  /** Filesystem root every `LocalDiskStorageAdapter` object key resolves under. */
  STORAGE_ROOT: z.string().default('/app/storage'),
  /** HMAC secret `FileSigningService` signs/verifies every `POST /files/sign`-issued URL with.
   * `optional()` only so local dev without it doesn't fail zod validation outright — unconditionally
   * required in every deployed environment (`REQUIRED_IN_DEPLOYED_ENVS`) and unconditionally required
   * by `FileSigningService` itself regardless of environment (ported verbatim from legacy's identical
   * `requireSigningSecret()` guard). */
  FILE_SIGNING_SECRET: z.string().optional(),
  /** How long a signed download URL stays valid, in seconds (FR-FILE-1). */
  SIGNED_URL_TTL_SEC: z.coerce.number().int().positive().default(900),
  /** Defense-in-depth re-check in `ProfileService.uploadPicture` (FR-IAM-4) — this app has no
   * `multer`-equivalent request-body size limiter ahead of `request.formData()`, so this is the
   * *only* size enforcement point (a documented gap from legacy's two-layer defense — see
   * `docs/plans/nextjs-rewrite-phase1-plan.md`'s Sub-slice 1c "Decisions made"). */
  MAX_AVATAR_SIZE_BYTES: z.coerce.number().int().positive().default(5_242_880),
  /** Phase 4 (`exam-authoring`) — the `Content-Length`-based pre-check `POST /api/exam-types/zip` runs
   * before ever calling `request.formData()`, same defense-in-depth rationale as
   * `MAX_AVATAR_SIZE_BYTES` (this app has no `multer`-equivalent body-size limiter ahead of the parser).
   * Default matches legacy's own `MAX_ZIP_SIZE_BYTES` (100 MiB). */
  MAX_ZIP_SIZE_BYTES: z.coerce.number().int().positive().default(104_857_600),

  // ── AI model allowlist (Phase 2 sub-slice 2b, ported verbatim from legacy's env.schema.ts) ────────
  /** `AiModelResolver`'s per-tenant resolution cache TTL (ms) — ported verbatim
   * (`AI_MODEL_CACHE_TTL_MS`, default 60000). Same accepted-staleness trade-off as
   * `TENANT_CACHE_TTL_MS` above: a fresh allowlist/assignment mutation calls `invalidate()`
   * synchronously, so this TTL only bounds staleness for a resolution that was already cached before
   * the mutation happened. */
  AI_MODEL_CACHE_TTL_MS: z.coerce.number().int().positive().default(60_000),

  // ── Billing (Stripe) — Phase 2 sub-slice "2c", FR-PKG-6 — ported verbatim (names/defaults) from
  //    legacy's env.schema.ts. Both empty (the default) is a fully supported, intentional deployment
  //    shape — `BillingCheckoutService`/the webhook route return `BILLING_NOT_CONFIGURED` 503 rather
  //    than the app failing to boot, so a deployment with billing disabled never needs a real Stripe
  //    account. `loadAndValidateEnv`'s cross-field check below still requires the pair to be set or
  //    empty *together* (a half-configured pair is a deployment mistake, not a valid disabled state). ──
  /** Empty ⇒ billing is not configured for this deployment (`BILLING_NOT_CONFIGURED` 503 on the
   * checkout/webhook surfaces, never a boot-time failure). */
  STRIPE_SECRET_KEY: z.string().default(''),
  /** The webhook endpoint's signing secret (`whsec_...`) `stripe.webhooks.constructEvent` verifies
   * every inbound `POST /api/platform/billing/webhook` request against. */
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  /** `{tenantId}`-templated Checkout Session redirect target on success. Empty (the default) derives
   * `https://{PUBLIC_APEX_DOMAIN}/platform/tenants/{tenantId}?checkout=success` at call time — this
   * app's platform console lives at a real `/platform/**` URL path on the same origin (UX_GUIDELINES
   * §18.1a), not a separate `admin.{PUBLIC_APEX_DOMAIN}` subdomain the way legacy's own default
   * assumed, so the derived default is intentionally shaped differently from legacy's identical-named
   * var (see `docs/plans/nextjs-rewrite-phase2-plan.md`'s Sub-slice 2c "Decisions made"). */
  STRIPE_CHECKOUT_SUCCESS_URL: z.string().default(''),
  /** Same shape/derivation as {@link STRIPE_CHECKOUT_SUCCESS_URL}, for a canceled/abandoned checkout. */
  STRIPE_CHECKOUT_CANCEL_URL: z.string().default(''),

  // ── Reliability / background workers (Phase 1 sub-slice 1c) — FR-REL-1 ──────────────────────────
  /** `ROLE=worker`'s single outbox-sweep tick (ms). Unlike legacy's two-speed hinted/full-sweep
   * split, this dispatch builds only the full-sweep safety net (see the reliability module's own
   * doc comment for why the hinted sweep + `tenant_work_hint` table are deferred) — so this is the
   * *only* sweep interval, and is therefore deliberately kept at the fast (hinted-sweep-equivalent)
   * cadence rather than legacy's slow full-sweep-only cadence, so pending work is still discovered
   * promptly with no hinting mechanism to shortcut the scan. */
  WORKER_OUTBOX_TICK_MS: z.coerce.number().int().positive().default(10_000),

  // ── Tenant maintenance (Phase 2 sub-slice "2d") — HLD §10.1, ported verbatim (names/defaults) from
  //    legacy's env.schema.ts ──────────────────────────────────────────────────────────────────────
  /** How stale a `Provisioning`/`Failed` tenant's `provisioning_heartbeat_at` must be before
   * `TenantMaintenanceWorker.sweepStuckProvisioning` treats it as stuck and retries it — ported
   * verbatim (`PROVISIONING_HEARTBEAT_STALE_MS`, default 300000 = 5 minutes). */
  PROVISIONING_HEARTBEAT_STALE_MS: z.coerce.number().int().positive().default(300_000),
  /** `ROLE=worker`'s `TenantMaintenanceWorker` tick (ms) — both `sweepStuckProvisioning` and
   * `sweepTenantHygiene` share this one "low-frequency, whole-tenant-set sweep" cadence (HLD §10.1's
   * own table: "a single 300s-class tick shared by all of its duties"). Legacy reuses its own
   * `WORKER_FULL_SWEEP_INTERVAL_MS` for this same purpose; this app has no equivalent var yet (no
   * other worker needs a slow full-sweep cadence), so a dedicated var is introduced instead of
   * repurposing `WORKER_OUTBOX_TICK_MS` (a materially faster cadence meant for a different concern) —
   * a documented judgment call, not a conflation of two different config knobs. */
  WORKER_TENANT_MAINTENANCE_TICK_MS: z.coerce.number().int().positive().default(300_000),
  /** HLD §9: "Automatic purge is off by default... the maintenance worker only lists purge-eligible
   * tenants for a Platform Admin to confirm." Ported verbatim (`TENANT_PURGE_ENABLED`, default
   * `false`) — no code path in this app ever executes a purge regardless of this flag's value this
   * dispatch; it exists so a later phase's actual purge-execution feature has a ready, already-named
   * kill switch rather than inventing one then. */
  TENANT_PURGE_ENABLED: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
    .default(false),

  // ── AI (Phase 5 — the migration plan's actual pivot: in-process ADK-TS + OpenRouter, reversing
  //    the 2026-08-08 spec AMENDED note's standalone Python mTLS microservice) ───────────────────
  /** The "AI-less deployment" replacement (HLD §8.4 / migration plan): when `false`, every
   * `AiServicePort` method throws `AiDisabledError` immediately, with NO network I/O attempted —
   * mirrors legacy's `AI_ENGINE=disabled` contract exactly, just as a boolean flag instead of an
   * enum (there is no second "which engine" axis to select in-process). */
  AI_ENABLED: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
    .default(false),
  /** OpenRouter's OpenAI-compatible API key — `OpenRouterLlm`'s sole credential. Empty (the default)
   * is a fully valid "AI configured but no live key in this environment" shape; `AI_ENABLED` is the
   * actual gate, not this var's presence (matches `STRIPE_SECRET_KEY`'s identical "empty is valid"
   * precedent) — an operator can flip `AI_ENABLED=true` with this still empty and get a clean,
   * every-call `401`-classified non-retryable failure rather than a boot-time crash. */
  OPENROUTER_API_KEY: z.string().default(''),
  /** OpenRouter's OpenAI-compatible base URL — ported verbatim from legacy's identical var. */
  OPENROUTER_BASE_URL: z.string().default('https://openrouter.ai/api/v1'),
  /** Per-attempt HTTP timeout (ms) for `OpenRouterLlm`'s outbound `chat/completions` call — ported
   * verbatim (`AI_SERVICE_TIMEOUT_MS`, default 90000) from legacy's identical var; enforced via a
   * real `AbortController` threaded through `Runner.runAsync({abortSignal})` (see
   * `docs/plans/nextjs-rewrite-phase5-plan.md`'s "Decisions made" #6 for how ADK forwards it). */
  AI_SERVICE_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),

  // ── Embeddings (Phase 5) — ported verbatim (names/defaults) from legacy's env.schema.ts, enum
  //    narrowed to the two providers this dispatch actually ports (see the plan doc's "Decisions
  //    made" #5 for why `local-tei` is not included) ──────────────────────────────────────────────
  EMBEDDINGS_PROVIDER: z.enum(['openai-compatible', 'null']).default('null'),
  EMBEDDINGS_BASE_URL: z.string().default('https://api.openai.com/v1'),
  EMBEDDINGS_API_KEY: z.string().default(''),
  EMBEDDINGS_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDING_DIMS: z.coerce.number().int().positive().default(1536),
  EMBEDDINGS_BATCH_SIZE: z.coerce.number().int().positive().default(100),

  // ── Vector store (Phase 5) — `QDRANT_URL` points at the SAME already-running `exam-4u-qdrant-1`
  //    container legacy uses (no new container this phase); `VECTOR_COLLECTION_PREFIX` defaults to
  //    `examland_next` — deliberately DIFFERENT from legacy's `examland` default, mirroring Phase 1a's
  //    `examland_platform_next` MySQL-schema isolation precedent so this app's collections
  //    (`examland_next_chunks`/`_doc_fingerprints`/`_question_bank`) never collide with legacy's own
  //    (`examland_chunks`/`_doc_fingerprints`/`_question_bank`) in the shared Qdrant instance. ──────
  QDRANT_URL: z.string().url().default('http://localhost:6333'),
  QDRANT_API_KEY: z.string().default(''),
  VECTOR_COLLECTION_PREFIX: z.string().default('examland_next'),

  // ── Retrieval / hybrid search (Phase 5) — ported verbatim (names/defaults) from legacy's
  //    env.schema.ts; see `server/ai/domain/hybrid-rerank.ts`'s own doc comment for how each hybrid
  //    value is used. ──────────────────────────────────────────────────────────────────────────────
  RETRIEVAL_TOPK_LESSON: z.coerce.number().int().positive().default(5),
  RETRIEVAL_TOPK_EXTRACTION: z.coerce.number().int().positive().default(12),
  RETRIEVAL_TOPK_PROMPT: z.coerce.number().int().positive().default(12),
  RETRIEVAL_RELEVANCE_FLOOR: z.coerce.number().min(0).max(1).default(0.15),
  RETRIEVAL_HYBRID_LEXICAL_WEIGHT: z.coerce.number().min(0).max(1).default(0.35),
  RETRIEVAL_HYBRID_CANDIDATE_MULTIPLIER: z.coerce.number().int().positive().default(4),
  RETRIEVAL_HYBRID_LEXICAL_SCAN_LIMIT: z.coerce.number().int().positive().default(200),

  // ── PDF processing (Phase 6, sub-slice "6a") — ported verbatim (names/defaults) from legacy's
  //    env.schema.ts, trimmed to what this sub-slice's own upload/dedup/exam-extraction/
  //    stale-session-recovery scope actually reads ──────────────────────────────────────────────────
  /** `PdfProcessingService.uploadPdf`'s own magic-byte + size validation ceiling — matches legacy's
   * identical `MAX_PDF_SIZE_BYTES` default (50 MiB). Same `Content-Length`-pre-check-before-parsing
   * defense-in-depth pattern as `MAX_ZIP_SIZE_BYTES`/`MAX_AVATAR_SIZE_BYTES` (this app has no
   * `multer`-equivalent body-size limiter ahead of `request.formData()`). */
  MAX_PDF_SIZE_BYTES: z.coerce.number().int().positive().default(52_428_800),
  /** `ExamExtractionService`'s per-session token/cost ceilings (FR-PDF-12/NFR-7) — `isBudgetExhausted`
   * checks these before every page's AI call, never after. */
  PDF_MAX_TOKENS_PER_SESSION: z.coerce.number().int().positive().default(400_000),
  PDF_MAX_COST_PER_SESSION_USD: z.coerce.number().positive().default(2.0),
  /** LLD §9.3: `is_review_flagged = confidence < this` — the shared threshold `calibrateConfidence`
   * compares every generation/extraction path's calibrated score against. */
  REVIEW_FLAG_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),
  /** FR-PDF-2 tier-2 (semantic) dedup's cosine-similarity floor against the tenant's
   * `<prefix>_doc_fingerprints` collection — a point below this threshold is never returned by
   * `VectorStorePort.searchFingerprint` at all (applied Qdrant-side as `score_threshold`). */
  FINGERPRINT_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.97),
  /** `StaleSessionRecoveryWorker.recoverOne`'s "is this in-flight session actually stuck" cutoff —
   * ported verbatim (`SESSION_HEARTBEAT_STALE_MS`, default 300000 = 5 minutes; deliberately its own,
   * independently-tunable var from `PROVISIONING_HEARTBEAT_STALE_MS`, since PDF-session recovery and
   * tenant-provisioning recovery are unrelated reliability mechanisms). */
  SESSION_HEARTBEAT_STALE_MS: z.coerce.number().int().positive().default(300_000),
  /** `StaleSessionRecoveryWorker.recoverOne`'s resume-vs-fail-outright ceiling — a session whose
   * `resume_attempts` already reached this value is failed with `SESSION_RECOVERY_EXHAUSTED` rather
   * than resumed yet again. */
  MAX_RESUME_ATTEMPTS: z.coerce.number().int().positive().default(3),
  /** `ROLE=worker`'s PDF stale-session-recovery sweep tick (ms) — mirrors legacy's
   * `WORKER_SWEEP_TICK_MS` (default 60000 = 1 minute), its own independently-tunable cadence from
   * `WORKER_OUTBOX_TICK_MS`/`WORKER_TENANT_MAINTENANCE_TICK_MS` (a different reliability concern with a
   * different acceptable staleness window). */
  WORKER_PDF_SESSION_SWEEP_TICK_MS: z.coerce.number().int().positive().default(60_000),

  // ── Attempts (Phase 7) — ported verbatim (name/default) from legacy's env.schema.ts. ─────────────
  /** `ROLE=worker`'s attempt-timeout eager-sweep tick (ms) — mirrors legacy's identical
   * `WORKER_ATTEMPT_TIMEOUT_SWEEP_TICK_MS` (default 60000 = 1 minute), its own independently-tunable
   * cadence (FR-TAKE-6's belt-and-braces backstop; the lazy path is the primary mechanism, see
   * `AttemptsService`'s own doc comment). */
  WORKER_ATTEMPT_TIMEOUT_SWEEP_TICK_MS: z.coerce.number().int().positive().default(60_000),

  // ── PDF processing / document ingestion (Phase 6, sub-slice "6b") — ported verbatim (names/
  //    defaults) from legacy's env.schema.ts. `PDF_QUESTIONS_*` bound `planLessonBatches`' total-
  //    question target (FR-PDF-4's "bounded batches"); `CHUNK_*` are the shared RAG chunk target/
  //    overlap `chunkPages` uses for BOTH the Reference-indexing branch and Curriculum document
  //    ingestion (one setting, one chunker — see `common/util/chunking.util.ts`). ────────────────
  /** `planLessonBatches`' lower clamp on a document's total planned question count (FR-PDF-4). */
  PDF_QUESTIONS_MIN: z.coerce.number().int().positive().default(10),
  /** `planLessonBatches`' upper clamp on a document's total planned question count (FR-PDF-4). */
  PDF_QUESTIONS_MAX: z.coerce.number().int().positive().default(200),
  /** Configured target questions per `generateLessonBatch` call — still hard-clamped to
   * `MAX_QUESTIONS_PER_BATCH` (10) by `planLessonBatches` regardless of this value (LLD §7.11's
   * "<= 10, enforced both sides"). */
  PDF_QUESTIONS_BATCH_SIZE: z.coerce.number().int().positive().default(10),
  /** `chunkPages`' target chunk size in characters (LLD §8.4/§9.7 default 1500). */
  CHUNK_SIZE_CHARS: z.coerce.number().int().positive().default(1500),
  /** `chunkPages`' within-a-page overlap in characters (LLD §8.4/§9.7 default 200). */
  CHUNK_OVERLAP_CHARS: z.coerce.number().int().min(0).default(200),

  // ── PDF processing / similar-questions (Phase 6, sub-slice "6d") — ported verbatim (names/
  //    defaults) from legacy's own `AppConfigService.similarQuestions` shape. Deliberately a much
  //    higher floor than `RETRIEVAL_RELEVANCE_FLOOR` (a raw, undiluted cosine score, not a fused
  //    hybrid one — see `SimilarQuestionsService`'s own doc comment). ──────────────────────────────
  SIMILAR_QUESTIONS_RELEVANCE_FLOOR: z.coerce.number().min(0).max(1).default(0.75),
  SIMILAR_QUESTIONS_LIMIT: z.coerce.number().int().positive().default(5),

  // ── Practice (Phase 8) — ported verbatim (names/defaults) from legacy's env.schema.ts. `FULL_BANK_
  //    ASSESSMENT_*` are the fixed-shape defaults `FullBankAssessmentService.start` falls back to when
  //    a request omits `targetQuestionCount`/`targetTotalMinutes` (FR-PDF-13). ─────────────────────────
  FULL_BANK_ASSESSMENT_DEFAULT_QUESTION_COUNT: z.coerce.number().int().positive().default(40),
  FULL_BANK_ASSESSMENT_DEFAULT_TOTAL_MINUTES: z.coerce.number().int().positive().default(60),

  // ── Logging ──────────────────────────────────────────────────────────────
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_DIR: z.string().default('/app/logs'),
});

/** The raw, validated env shape (post zod parse). */
export type EnvVars = z.infer<typeof envSchema>;

/**
 * Keys that must be present (non-empty) in `production`/`staging` regardless of their dev-time
 * optionality above — ported pattern from `legacy/api/src/config/env.schema.ts`'s
 * `REQUIRED_IN_DEPLOYED_ENVS`, scoped down to the vars this phase actually declares.
 */
const REQUIRED_IN_DEPLOYED_ENVS: (keyof EnvVars)[] = [
  'DB_HOST',
  'DB_USER',
  'JWT_TENANT_SECRET',
  'JWT_PLATFORM_SECRET',
  'FILE_SIGNING_SECRET',
];

/**
 * Parses `process.env` (or an injectable equivalent, for tests), then applies the
 * production/staging-only invariants that a plain zod `.optional()` can't express because the same
 * field is legitimately optional in `development`/`test`. Throws synchronously, listing *every*
 * violation found (not just the first), so the process never finishes booting with an invalid
 * configuration — same fail-fast contract as the legacy app's `loadAndValidateEnv`.
 *
 * @param raw Typically `process.env`; injectable for tests.
 * @throws Error describing every violation found.
 */
export function loadAndValidateEnv(raw: NodeJS.ProcessEnv): EnvVars {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const env = parsed.data;
  const violations: string[] = [];
  const isDeployed = env.NODE_ENV === 'production' || env.NODE_ENV === 'staging';

  if (isDeployed) {
    for (const key of REQUIRED_IN_DEPLOYED_ENVS) {
      const value = env[key];
      if (value === undefined || value === '') {
        violations.push(`${key} is required in NODE_ENV=${env.NODE_ENV}`);
      }
    }
    if (env.DB_SYNCHRONIZE) {
      violations.push('DB_SYNCHRONIZE must be false in NODE_ENV=production/staging');
    }
    // Ported verbatim from legacy's identical guard — `NullEmbeddingsAdapter` is a second,
    // defense-in-depth check (its own constructor also refuses `NODE_ENV=production`); this one
    // catches the misconfiguration at boot, before any request ever reaches that adapter.
    if (env.EMBEDDINGS_PROVIDER === 'null') {
      violations.push('EMBEDDINGS_PROVIDER=null (NullEmbeddingsAdapter) is refused in NODE_ENV=production/staging');
    }
  }

  // Cross-field invariant checked in EVERY environment (not just deployed ones) whenever both
  // secrets are actually set — ported verbatim from legacy's identical check. A shared secret would
  // collapse one of the "three independent barriers" (HLD §5.1) separating the tenant-user and
  // platform-admin JWT realms: with the same secret, only the `aud`/`typ` claim checks would still
  // stand between a tenant-user token and a platform-admin-guarded route.
  if (env.JWT_TENANT_SECRET && env.JWT_PLATFORM_SECRET && env.JWT_TENANT_SECRET === env.JWT_PLATFORM_SECRET) {
    violations.push('JWT_TENANT_SECRET and JWT_PLATFORM_SECRET must differ');
  }

  // Phase 2 sub-slice "2c" (FR-PKG-6) — ported verbatim from legacy's identical check: both empty
  // (billing disabled) is valid; both set (billing enabled) is valid; exactly one set is always a
  // deployment mistake (a webhook secret with no way to create a session, or vice versa), checked in
  // every environment, not just deployed ones.
  if (Boolean(env.STRIPE_SECRET_KEY) !== Boolean(env.STRIPE_WEBHOOK_SECRET)) {
    violations.push('STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must both be set or both be empty');
  }

  if (violations.length > 0) {
    throw new Error(`Invalid environment configuration: ${violations.join('; ')}`);
  }

  return env;
}
