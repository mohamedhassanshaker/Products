import type { ProvisioningStepName } from '@examland/contracts';

/** The minimal, immutable projection of the tenant being provisioned that every
 * {@link ProvisioningStep} needs — ported verbatim from `legacy/api/src/tenancy/domain/
 * provisioning.types.ts`. Deliberately narrow — just enough to act, nothing that looks like a
 * credential. */
export interface ProvisioningTenantRef {
  id: string;
  name: string;
  subdomainSlug: string;
  schemaName: string;
}

/**
 * Everything a {@link ProvisioningStep} needs to do its work. Built fresh by
 * `TenantProvisioningService` on every `provisionNewTenant()`/`retry()` call from the tenant's
 * current platform-schema row — never cached across calls, so a step always sees the latest
 * `pendingAdminEmail`/schema name.
 */
export interface ProvisioningContext {
  tenant: ProvisioningTenantRef;
  /** The first Tenant Admin's invited email (FR-MT-4). Guaranteed non-empty by the time any step
   * actually needs it (`seed_admin_user`, `invite_admin`) — `TenantProvisioningService` persists it
   * before the first step ever runs. */
  adminEmail: string;
}

/**
 * One provisioning step (LLD §8.2: "each step is a class implementing `ProvisioningStep { readonly
 * name; run(ctx): Promise<void> }`, registered in a fixed ordered array") — ported verbatim from
 * `legacy/api/src/tenancy/domain/provisioning.types.ts`. Implementations must be idempotent — safe to
 * run again after a previous partial success — since `TenantProvisioningService` re-runs from the
 * first non-`Completed` step on every retry.
 *
 * Lives in `server/tenancy/` (a shared vocabulary between the orchestrator and each concrete step),
 * not `server/platform/provisioning/` (the orchestration workflow itself) — see
 * `docs/plans/nextjs-rewrite-phase1-plan.md`'s "Decisions made" for the full reasoning behind this
 * split.
 */
export interface ProvisioningStep {
  readonly name: ProvisioningStepName;
  run(ctx: ProvisioningContext): Promise<void>;
}
