/**
 * Reads the ambient tenant's own `TenantProfile` singleton row.
 *
 * A port rather than a direct `getTenantDb()` call from application code, so
 * `RequirePlatformOperator` (the only consumer today) is testable against a
 * fake without a real tenant schema — the same reason every other
 * application-layer check in this codebase depends on a port, not a Prisma
 * client, per architecture.md §4's swap test.
 */
export interface TenantProfileReader {
  /**
   * Whether the currently-bound tenant is the real Platform tenant.
   *
   * Backed by `TenantProfiles.isPlatformTenant` — the same flag
   * `sql-store-provisioner.ts`'s `ensureTenantProfile` seeds from
   * `platform.Tenants.entityKind` at provisioning time, and the same one
   * `TR_Teams_crossEntityScope` already trusts.
   */
  isPlatformTenant(): Promise<boolean>;
}
