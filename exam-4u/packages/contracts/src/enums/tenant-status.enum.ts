/**
 * Lifecycle status of a tenant (LLD §4 `tenant.status` column; HLD §4.2 tenant-resolution
 * behavior per status). Modeled as a plain string-literal union rather than a TypeScript `enum` —
 * `packages/contracts` may contain no runtime values with behavior, only types/consts (LLD §1), and
 * a string union serializes identically to the DB's `ENUM(...)` values without a mapping step.
 *
 * - `Provisioning` — schema/RBAC/admin-seeding steps are still running (FR-MT-4); not reachable by
 *   end users yet. Tenant resolution returns 503 `TENANT_UNAVAILABLE`.
 * - `Active` — fully provisioned and reachable. The only status tenant resolution lets through.
 * - `Suspended` — deliberately taken offline by a Platform Admin. Tenant resolution returns 403
 *   `TENANT_SUSPENDED`.
 * - `Failed` — provisioning did not complete successfully (FR-MT-4). Tenant resolution returns 503
 *   `TENANT_UNAVAILABLE`, same as `Provisioning`, since neither is safe to serve traffic for.
 */
export type TenantStatus = 'Provisioning' | 'Active' | 'Suspended' | 'Failed';
