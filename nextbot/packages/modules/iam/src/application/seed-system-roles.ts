import type { TenantContext } from "@nextbot/db";
import { SYSTEM_ROLES } from "../domain/system-roles.js";
import { findRoleByName, insertRole } from "../infrastructure/role-repository.js";

/**
 * Seeds the six system roles (LLD §3.3) for a newly-provisioned tenant. Called by the
 * composition root (e.g. an onboarding Server Action/route handler) immediately after
 * `@nextbot/tenancy`'s `provisionTenant()` — kept as two separate application-service
 * calls rather than one cross-module transaction because `tenancy` cannot depend on
 * `iam` (LLD §2.3's allow-list only permits the reverse edge, `iam -> tenancy`).
 * Idempotent: re-running for a tenant that already has a same-named role is a no-op
 * for that role (system roles are not expected to be renamed by tenants; if one is,
 * this seeds a second role with the same canonical name — acceptable for a
 * provisioning-time-only operation, not a live reconciliation job).
 */
export async function seedSystemRoles(ctx: TenantContext): Promise<string[]> {
  const ids: string[] = [];
  for (const def of SYSTEM_ROLES) {
    const existing = await findRoleByName(ctx, def.name);
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    ids.push(await insertRole(ctx, { name: def.name, permissionMatrix: def.permissionMatrix, isSystem: true }));
  }
  return ids;
}
