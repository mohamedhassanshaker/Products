/**
 * Ports for tenant provisioning.
 *
 * The interfaces the provisioning use case depends on. No implementations, no
 * vendor types — architecture.md §4's `ports/` layer, which is what makes the
 * use case testable against fakes and runnable against four real stores without
 * changing a line of it.
 */

import type {
  ProvisioningStore,
  ProvisioningStep,
  Tenant,
  TenantStatus,
} from "../domain/tenant.js";
import type { Principal } from "../tenancy/tenant-context.js";
import type { TenantSlug } from "../tenancy/tenant-slug.js";

/**
 * Creates and removes one store's isolation unit.
 *
 * One implementation per store, so the SQL, Neo4j, Qdrant and Redis specifics
 * stay in their own adapters and the orchestration stays store-agnostic.
 */
export interface StoreProvisioner {
  readonly store: ProvisioningStore;

  /**
   * Create this store's isolation unit for the tenant.
   *
   * Must be **idempotent**: re-running after a partial failure has to succeed
   * rather than collide, because RB-09 is resumable and an operator will re-run
   * it. In practice that means `IF NOT EXISTS` semantics everywhere.
   */
  create(tenant: TenantSlug): Promise<void>;

  /**
   * Remove this store's isolation unit. The compensating action for `create`.
   *
   * Must also be **idempotent**, and must tolerate the unit not existing —
   * rollback runs after a failure, so it cannot assume what got created.
   *
   * For Neo4j this is materially harder than it was under ADR-0002: what used to
   * be `DROP DATABASE` is now a batched, filtered delete, so completeness has to
   * be demonstrated rather than assumed (ADR-0009 rule 6). Hence `verify`.
   */
  destroy(tenant: TenantSlug): Promise<void>;

  /**
   * Prove the unit exists and is correctly shaped.
   *
   * Called after `create` to confirm the step, and after `destroy` to confirm
   * erasure. Returning `false` from a post-destroy check is what turns "we ran
   * the delete" into "the data is gone" — the distinction that matters for the
   * right-to-be-forgotten path.
   */
  verify(tenant: TenantSlug): Promise<boolean>;
}

/** Persistence for the tenant registry — the platform-global source of truth. */
export interface TenantRegistry {
  findBySlug(slug: TenantSlug): Promise<Tenant | null>;
  listActive(): Promise<readonly Tenant[]>;

  /** Every tenant regardless of status — the platform operator's Tenants screen. */
  listAll(): Promise<readonly Tenant[]>;

  /**
   * Insert a tenant in `Provisioning` status with all four steps `Pending`.
   *
   * Rejects a slug that already exists, including one left in `Failed` — reusing
   * a slug whose stores may still hold residue is how one government entity
   * would inherit another's data.
   */
  register(input: {
    slug: TenantSlug;
    displayName: string;
    embeddingModel: string;
    embeddingDimensions: number;
    /** `GovernmentEntity` (the adapter's own default) or `PlatformOperator` — see `ProvisionTenantInput`'s identical field for why (B-2). */
    entityKind?: "GovernmentEntity" | "PlatformOperator";
  }): Promise<Tenant>;

  recordStep(slug: TenantSlug, step: ProvisioningStep): Promise<void>;

  /**
   * The single visible commit point. Setting `Active` is what makes a tenant
   * addressable, so the implementation must refuse unless all four steps are
   * `Completed` — belt and braces alongside the use case's own check, because
   * this is the one invariant whose violation is unrecoverable.
   */
  setStatus(slug: TenantSlug, status: TenantStatus, at: Date): Promise<void>;
}

/**
 * Who performed an audited action — the source for `actorStaffUserId` /
 * `actorDisplayNameSnapshot` / `actorRoleSnapshot` (§4.13).
 *
 * Two shapes, not one `Principal` with everything optional, because the two cases
 * are different in kind rather than in completeness. An authenticated action
 * already has a `Principal` resolved by the auth middleware (ADR-0006 rule 1),
 * and the snapshot is frozen from it. A background write — provisioning's own
 * bootstrap, a scheduled migration run — has no session to resolve one from, and
 * making that caller synthesise a fake `Principal` just to have a `displayName`
 * would misrepresent who acted.
 */
export type AuditActor =
  | { readonly kind: "Principal"; readonly principal: Principal }
  | { readonly kind: "System"; readonly label: string };

/** What an audited action happened to — `targetKind` / `targetId` / `targetLabelSnapshot`. */
export interface AuditTarget {
  readonly kind: string;
  /** Char(26) per §1.2. Omitted when the target has no id of its own yet. */
  readonly id?: string;
  readonly labelSnapshot: string;
}

/**
 * One audited write, in port-shape. Mirrors `usp_WriteAuditLogEntry`'s parameter
 * list (prisma/sql/001_constraints.sql §4.13) rather than the table's columns
 * directly — `correlationId` is not here because the adapter derives it from
 * `TenantContext.traceId`, and `entryHash`/`prevHash`/`sequenceNo`/`id` are not
 * here because the procedure computes them, never the caller.
 */
export interface AuditEntry {
  readonly actor: AuditActor;
  /** Short dot.case verb, e.g. `tenant.provision` — matches `action varchar(64)`. */
  readonly action: string;
  readonly target: AuditTarget;
  /** Plain-language sentence. This is what B14 tab 2 renders. */
  readonly summary: string;
  readonly environmentKey?: string;
  /**
   * Arbitrary structured detail, serialised to `beforeJson` / `afterJson`.
   * Need not be JSON-safe on the way in — the adapter handles `undefined` and
   * circular values, since an audit write must never be the reason the audited
   * action fails.
   */
  readonly before?: unknown;
  readonly after?: unknown;
  readonly requestId?: string;
  readonly ipHash?: string;
  readonly userAgentHash?: string;
  /**
   * `PlatformAuditLogEntries.tenantId` / `tenantSlugSnapshot` — freezes which
   * government entity a cross-tenant action concerned (§3.3), e.g. which tenant
   * was provisioned. Meaningful only to `PlatformAuditSink`: `TenantAuditSink`
   * ignores it, because a tenant's own audit table has no need to name itself.
   */
  readonly tenant?: { readonly id?: string; readonly slugSnapshot: string };
}

/**
 * Append-only audit sink — the TypeScript shape of `usp_WriteAuditLogEntry` and
 * its platform-schema twin `usp_WritePlatformAuditLogEntry`
 * (prisma/sql/001_constraints.sql §4.13). One port, two adapters:
 * `PlatformAuditSink` writes `platform.PlatformAuditLogEntries` for the two
 * sanctioned cross-tenant paths (ADR-0002 rule 5) — provisioning is one of
 * them — and `TenantAuditSink` writes `<tenant>.AuditLogEntries` for everything
 * else. The application layer calls `record` either way and never knows which
 * table received it.
 *
 * There is deliberately no `outcome` field: the table has no such column. B14 tab
 * 2's entries read as plain sentences ("Granted Entity Admin role to Lina
 * Haddad"), so a failed attempt is distinguished by what `summary` says
 * happened — the same convention `TR_PromotionRequests_decisionRules` uses when
 * it writes `@summary = @status`.
 *
 * The underlying table has no UPDATE or DELETE grant for any role, including
 * Super Admin (B14 tab 2), which is why this port offers only `record`.
 */
export interface AuditSink {
  record(entry: AuditEntry): Promise<void>;
}

/** Injectable clock, so provisioning timestamps are assertable in tests. */
export interface Clock {
  now(): Date;
}

/**
 * Runs once a tenant is fully provisioned and `Active` — the seam a feature module uses to
 * seed whatever default data every tenant needs to be usable from day one (e.g. `channels`'
 * fixed four-channel catalogue, B10 tab 1).
 *
 * `platform` depends on nothing (architecture.md §3): it can never import a feature module
 * directly, so this interface is how `ProvisionTenant` reaches feature-owned provisioning
 * logic without knowing it exists. A feature module implements this port in its own
 * `adapters/outbound/` layer; the app-layer composition root — the one place allowed to
 * depend on everything — is what wires the concrete instance into `ProvisionTenant`'s deps.
 *
 * Deliberately best-effort, not part of the four-store commit contract `isFullyProvisioned`
 * guards: a hook failure is caught, audited, and never rolls back or blocks activation. By
 * the time hooks run, the tenant's four isolation units already exist and are verified —
 * that is the guarantee this use case exists to prove. Per-module default data is
 * convenience seeded on top of it, not a fifth isolation unit.
 */
export interface TenantProvisionedHook {
  /** Short, stable identifier — logged and audited on failure, so a failed hook is
   *  attributable without reading a stack trace. */
  readonly name: string;
  onTenantProvisioned(tenant: TenantSlug): Promise<void>;
}

/**
 * Ends every live session for a tenant, immediately. The seam `SuspendTenant`
 * (`modules/platform/application/suspend-tenant.ts`) uses to reach `iam`'s
 * `SessionStore` without importing it directly — `platform` depends on nothing
 * (architecture.md §3), and `iam` is a feature module, so this port exists for
 * exactly the reason `TenantProvisionedHook` above already documents.
 *
 * Unlike `TenantProvisionedHook`, this is a **required** effect, not best-effort
 * convenience data: api.md §3.6's whole promise ("Suspended ends sessions now")
 * depends on this actually running, so `SuspendTenant` must propagate a failure
 * here rather than catch and log it. A concrete adapter (`iam/adapters/outbound/
 * session-tenant-revoker.ts`) rebinds `runWithTenant` to the target tenant for the
 * call's duration, then calls `SessionStore.destroyAllForTenant()`.
 */
export interface TenantSessionRevoker {
  /** Returns how many sessions were destroyed, for the audit entry. */
  destroyAllSessions(tenant: TenantSlug): Promise<number>;
}
