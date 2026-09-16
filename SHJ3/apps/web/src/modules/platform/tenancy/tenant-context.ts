/**
 * Request-scoped tenant and principal context.
 *
 * ADR-0002 rule 2: tenant context is bound to the request scope and read by the
 * data-access layer — it is **not** threaded as an argument through application
 * code. Two reasons, and the second is the important one:
 *
 *  1. Passing a tenant through every function signature is noise that gets
 *     dropped under refactoring.
 *  2. More importantly, a tenant *parameter* is a tenant a caller can choose.
 *     Reading it from an ambient, write-once context means an application-layer
 *     author has nothing to choose — which is the whole design intent. A
 *     cross-tenant query is not forbidden here; it is unexpressible.
 *
 * ADR-0002 rule 1: the tenant is resolved from the authenticated principal only.
 * Never from a header, query string, route parameter or request body. That
 * resolution happens in the auth middleware, which is the only caller of
 * `runWithTenant`.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { TenantSlug } from "./tenant-slug.js";

/**
 * What a feature module is allowed to know about who is asking.
 *
 * Deliberately carries nothing about *how* the principal authenticated — no
 * token, no cookie, no password, no OIDC claim. ADR-0006 rule 1: feature modules
 * consume a Principal, never credentials, which is what makes swapping the local
 * password adapter for UAE PASS or Entra ID a change to session *creation* only.
 */
export interface Principal {
  readonly id: string;
  readonly tenant: TenantSlug;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly permissions: ReadonlySet<string>;
  /**
   * Verification state, per B11's step-up rules. `L0` anonymous, `L1` verified
   * identity, `L2` verified plus OTP, `L3` document-verified.
   *
   * Gating reads this level and never how it was established, so the mock
   * verification adapter and the real UAE PASS adapter are indistinguishable to
   * a feature module (ADR-0006 rule 5).
   */
  readonly assurance: "L0" | "L1" | "L2" | "L3";
}

export interface TenantContext {
  readonly tenant: TenantSlug;
  readonly principal: Principal | null;
  /**
   * Correlates this request across shj3-web, shj3-ai and any tool call it makes.
   * One trace id spanning the hop is what makes B14 tab 3's observability real
   * rather than decorative (ADR-0001 follow-up).
   */
  readonly traceId: string;
  /**
   * Set only for the audited cross-tenant paths (ADR-0002 rule 5): tenant
   * provisioning, cross-tenant analytics rollups, and — added for the theming
   * backend wave (2026-09-09) — running an N-tenant schema migration
   * (`RunTenantMigrations`), which is the same class of operation as provisioning
   * (a platform-level orchestrator touching every tenant's schema in turn, not a
   * per-tenant request) and already writes a real audit entry
   * (`RunTenantMigrations.execute()`'s own `audit.record({ action: "migration.run",
   * ... })` call) — it was simply never wired to a concrete, platform-data-touching
   * executor before this wave (`adapters/outbound/sql/migration-executor.ts`,
   * `migration-status-store.ts`). Anything reading this must write an audit entry.
   * It exists so these paths are *visible* rather than achieved by bypassing the
   * context entirely.
   *
   * `"identity"` — added for B-2 (2026-09-09), a genuinely different class from the
   * three above. `platform.StaffUsers`/`StaffCredentials`/`TenantMemberships`/
   * `Permissions` hold staff identity data that is deliberately platform-global (one
   * email is one account across every tenant, ADR-0006 rule 3) rather than
   * per-tenant — which means the *ordinary*, per-request work `UserRepository`'s
   * real adapter does (resolving a session's principal, listing a tenant's users for
   * B9 tab 1, checking `membershipsFor` before honouring a requested tenant) reaches
   * across the tenant/platform boundary on every authenticated request, not as a
   * rare bulk or administrative operation. Requiring a bespoke audit entry per read
   * here would not serve api.md's audit intent ("config changes, publishes,
   * permission grants, data exports") — it would flood the log with noise on every
   * sign-in and page view. The state changes that *are* meaningful (`user.invited`,
   * `user.suspended`, `user.removed`, a role's permissions edited) already write
   * their own explicit audit entries through the existing `AuditedStatusChange`-style
   * mechanism (`suspend-user.ts`'s own pattern) — this scope gates the *read* path
   * `getPlatformDb()` requires, not a step that itself needs auditing.
   *
   * `"channel-routing"` — added for B-6 (2026-09-09). The WhatsApp inbound
   * webhook (api.md §4.4) arrives with no tenant at all — Meta names only a
   * receiving `phone_number_id` — so resolving which tenant's `WhatsAppConfig`
   * owns that number is a genuine cross-tenant read, structurally identical to
   * `"identity"`'s justification (an ordinary, per-request lookup that reaches
   * across the boundary, not a rare bulk operation) rather than to
   * `"provisioning"`/`"migration"` (which mutate platform-global state and are
   * individually audited). Read-only: it enumerates `platform.Tenants` to find
   * the one whose tenant schema has a matching `WhatsAppConfigs.phoneNumberId`,
   * and writes nothing itself.
   *
   * `"branding-override"` — added for the platform-admin wave (2026-09-13), Part D.
   * A platform operator's Branding screen (`(platform-admin)/branding/`) rebinds
   * `runWithTenant` to a *target* tenant slug for the duration of one Server Action
   * call, so `getTenantDb()` resolves that tenant's own schema and the ordinary,
   * unchanged `ManageAppearance`/`PrismaThemeRepository` write to it — the same
   * rebind-to-a-resolved-tenant shape `signInWithPassword` already performs, gated by
   * `requirePlatformOperator()` and paired with an explicit `AuditSink.record()` call
   * instead of ambient. Every use is individually audited (`tenant.branding.override`),
   * matching `"provisioning"`/`"migration"`'s convention, not `"identity"`'s.
   */
  readonly platformScope?:
    | "provisioning"
    | "analytics-rollup"
    | "migration"
    | "identity"
    | "channel-routing"
    | "branding-override";
}

const storage = new AsyncLocalStorage<TenantContext>();

export class MissingTenantContextError extends Error {
  constructor(operation: string) {
    super(
      `No tenant context bound while performing "${operation}". ` +
        "Tenant-scoped store access is only available inside runWithTenant(), " +
        "which the authentication middleware establishes from the principal. " +
        "If this is a background job, wrap it in runWithTenant() for the tenant it serves.",
    );
    this.name = "MissingTenantContextError";
  }
}

/**
 * Bind a tenant context for the duration of `fn`.
 *
 * Called by the auth middleware, by the provisioning path, and by workers that
 * process a job on behalf of one tenant. It must not be called from a feature
 * module — that would be a module choosing its own tenant.
 */
export function runWithTenant<T>(context: TenantContext, fn: () => T): T {
  return storage.run(context, fn);
}

/**
 * Read the bound context, throwing if there is none.
 *
 * Throwing rather than returning a default is deliberate: a missing context is
 * a programming error, and the safe failure is a 500, never a silent read
 * against some fallback tenant.
 */
export function requireTenantContext(operation: string): TenantContext {
  const context = storage.getStore();
  if (!context) throw new MissingTenantContextError(operation);
  return context;
}

/** The bound tenant, or throw. This is what the store factories call. */
export function currentTenant(operation: string): TenantSlug {
  return requireTenantContext(operation).tenant;
}

/** Non-throwing read, for logging and diagnostics only. */
export function tryGetTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * The bound principal, or throw if the request is anonymous.
 *
 * Anonymous is legitimate on the citizen surface — B11 tab 2 allows "view bill
 * balance" at L0 — so callers that tolerate it should read `principal` from the
 * context directly rather than using this.
 */
export function requirePrincipal(operation: string): Principal {
  const { principal } = requireTenantContext(operation);
  if (!principal) {
    throw new Error(
      `"${operation}" requires an authenticated principal, but the request is anonymous.`,
    );
  }
  return principal;
}
