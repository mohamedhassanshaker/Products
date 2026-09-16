/**
 * Tenant provisioning domain.
 *
 * A tenant is a Sharjah government entity — SEWA, Sharjah Customs, Sharjah
 * Libraries, Platform. Provisioning one means creating its isolation unit in
 * **four** stores (ADR-0002): a SQL Server schema, Neo4j label-scoped indexes,
 * a Qdrant collection and a Redis key prefix.
 *
 * ## Why this is a domain concern and not just a script
 *
 * There is no transaction spanning four stores (ADR-0003 rule 4), so
 * provisioning cannot be atomic in the database sense. It has to be made atomic
 * in the *observable* sense instead: a tenant is either fully present and
 * serving traffic, or absent. A half-provisioned tenant is the one state in
 * which the isolation reasoning breaks down (ADR-0002 rule 6, RISK-013) —
 * queries would succeed against the stores that exist and fail against the ones
 * that do not, and "fail" is not the same as "isolated".
 *
 * The mechanism is a single visible commit point: the registry status flips to
 * `Active` only after all four steps report `Completed`, and traffic is gated on
 * that status. Everything before the flip is invisible to the application.
 *
 * This module holds no vendor imports — the swap test (architecture.md §4)
 * forbids them, which is what lets the same provisioning logic be tested against
 * fakes and run against four real stores.
 */

/** The four isolation units, in the order they are created. */
export const PROVISIONING_STORES = ["Sql", "Neo4j", "Qdrant", "Redis"] as const;

export type ProvisioningStore = (typeof PROVISIONING_STORES)[number];

export type ProvisioningStepStatus = "Pending" | "Running" | "Completed" | "Failed" | "RolledBack";

/**
 * Registry lifecycle. `Active` is the only status that serves traffic, and
 * reaching it requires all four steps `Completed`.
 *
 * `Deprovisioned` (added for `DeprovisionTenant`, the platform operator's tenant-lifecycle
 * "Delete") is the terminal state after all four stores are torn down and each verified
 * gone (`StoreProvisioner.destroy()` + `.verify()`, the same pair `ProvisionTenant.
 * rollback()` already uses) — distinct from `Failed`, which means provisioning never
 * completed in the first place, not that an already-Active tenant was deliberately removed.
 */
export type TenantStatus =
  | "Provisioning"
  | "Active"
  | "Suspended"
  | "Deprovisioning"
  | "Deprovisioned"
  | "Failed";

export interface ProvisioningStep {
  readonly store: ProvisioningStore;
  readonly status: ProvisioningStepStatus;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  /**
   * Present on `Failed`. Kept as a message rather than an error object because
   * it is persisted and read by an operator following RB-09, who needs the
   * store's own words rather than a stack trace.
   */
  readonly failureReason?: string;
}

export interface Tenant {
  readonly slug: string;
  readonly displayName: string;
  readonly status: TenantStatus;
  /** Derived, never typed by hand (ADR-0002 rule 4). */
  readonly sqlSchema: string;
  readonly neo4jTenantLabel: string;
  readonly qdrantCollection: string;
  readonly redisPrefix: string;
  /**
   * Recorded at provisioning and asserted at boot. Changing the embedding model
   * or dimension invalidates every vector in the collection, and a silent
   * mismatch poisons retrieval rather than failing it (ADR-0004 rule 3,
   * RISK-016) — so the collection remembers what produced it.
   */
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;
  readonly steps: readonly ProvisioningStep[];
  readonly createdAt: Date;
  readonly activatedAt?: Date;
}

/**
 * Whether every isolation unit exists.
 *
 * This is the predicate behind the single commit point. It deliberately requires
 * *all four* rather than "no failures", because a step still `Pending` is not a
 * step that succeeded — and an optimistic reading here is precisely how a
 * half-provisioned tenant would start serving traffic.
 */
export function isFullyProvisioned(steps: readonly ProvisioningStep[]): boolean {
  if (steps.length !== PROVISIONING_STORES.length) return false;
  const seen = new Set(steps.map((s) => s.store));
  if (seen.size !== PROVISIONING_STORES.length) return false;
  return steps.every((step) => step.status === "Completed");
}

/**
 * The steps that need compensating rollback after a failure.
 *
 * Only `Completed` steps created anything, so only they need undoing. A `Failed`
 * step may have created something *partially* — a collection with no payload
 * index, say — so it is included too: the rollback operations are idempotent by
 * contract, which makes over-rolling-back safe and under-rolling-back not.
 *
 * Returned in reverse creation order, so dependents come down before the things
 * they depend on.
 */
export function stepsRequiringRollback(
  steps: readonly ProvisioningStep[],
): readonly ProvisioningStore[] {
  const needsUndo = new Set(
    steps.filter((s) => s.status === "Completed" || s.status === "Failed").map((s) => s.store),
  );
  return [...PROVISIONING_STORES].reverse().filter((store) => needsUndo.has(store));
}

export class TenantProvisioningError extends Error {
  constructor(
    readonly slug: string,
    readonly store: ProvisioningStore,
    /**
     * The underlying store error. Named `storeError` rather than `cause` to
     * avoid shadowing the built-in `Error.cause`, which is set below so standard
     * tooling and log formatters still walk the chain.
     */
    readonly storeError: unknown,
  ) {
    super(
      `Provisioning tenant "${slug}" failed at the ${store} step. ` +
        "The tenant has NOT been activated and every completed step is being rolled back. " +
        "If rollback also fails, follow RB-10 — a half-provisioned tenant must never be left addressable.",
      { cause: storeError },
    );
    this.name = "TenantProvisioningError";
  }
}

export class TenantRollbackError extends Error {
  constructor(
    readonly slug: string,
    readonly failures: readonly { store: ProvisioningStore; reason: string }[],
  ) {
    super(
      `Rollback of tenant "${slug}" left ${failures.length} store(s) uncleaned: ` +
        failures.map((f) => `${f.store} (${f.reason})`).join(", ") +
        ". The registry status is Failed so the tenant serves no traffic, but the residue must be " +
        "removed manually via RB-10 before the slug is reused.",
    );
    this.name = "TenantRollbackError";
  }
}
