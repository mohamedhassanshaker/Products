/**
 * One-off ops script: grants `platform:operate` to the real Platform tenant's
 * (`sharjah`) `SuperAdmin` role only.
 *
 *   pnpm exec tsx scripts/grant-platform-operator.ts
 *
 * `platform:operate` is deliberately excluded from `SEEDED_ROLE_PERMISSIONS`
 * (`modules/iam/domain/permissions.ts`'s own doc comment) — every other
 * permission is granted to every tenant at provisioning via
 * `seedSeededRolesAndGrants()`, but this one must exist in exactly one
 * tenant's `RolePermissions` table: the Platform tenant's own. Granting it
 * anywhere else would be meaningless (`RequirePlatformOperator` also checks
 * `TenantProfiles.isPlatformTenant`) but still worth keeping out of the shared
 * seed path, so that path never needs a tenant-conditional branch.
 *
 * Idempotent: safe to re-run, matching `seed-iam-demo-data.ts`'s own
 * convention (checks for an existing `RolePermission` row before inserting).
 *
 * Composition root, not application code: constructs `getTenantDb()` directly
 * inside a `runWithTenant()` binding, which `application/` code may never do
 * (architecture.md §4) — identical reasoning to `seed-iam-demo-data.ts`'s own
 * module comment.
 */

import { randomUUID } from "node:crypto";
import { getTenantDb, disconnectAllTenantDbs } from "../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../apps/web/src/modules/platform/adapters/outbound/sql/ulid.js";
import { runWithTenant } from "../apps/web/src/modules/platform/tenancy/tenant-context.js";
import { assertValidSlugShape } from "../apps/web/src/modules/platform/tenancy/tenant-slug.js";
import { ROLE_KEYS } from "../apps/web/src/modules/iam/domain/permissions.js";
import { seedPermissionCatalog } from "../apps/web/src/modules/iam/application/seed-demo-data.js";
import { PrismaDemoDataSeeder } from "../apps/web/src/modules/iam/adapters/outbound/sql/prisma-demo-data-seeder.js";

const SHARJAH = assertValidSlugShape("sharjah");
const PLATFORM_OPERATE = "platform:operate";
/** Same synthetic actor id `prisma-demo-data-seeder.ts` uses for grants with no real human actor. */
const SYSTEM_SEED_ACTOR_ID = `SEED${"0".repeat(21)}1`;

function newTraceId(): string {
  return randomUUID().replace(/-/g, "");
}

async function main(): Promise<void> {
  // `RolePermissions_permissionKey_fkey` is a real DB constraint against `platform.
  // Permissions.key` (prisma/tenant/schema.prisma's own doc comment on `RolePermission.
  // permissionKey`) — so `platform:operate`'s catalog row must exist before the grant
  // below can insert, exactly the same ordering `seed-iam-demo-data.ts`'s own `main()`
  // already follows. Idempotent (create-if-missing), safe to re-run.
  await runWithTenant(
    { tenant: SHARJAH, principal: null, traceId: newTraceId(), platformScope: "provisioning" },
    () => seedPermissionCatalog(new PrismaDemoDataSeeder()),
  );

  await runWithTenant({ tenant: SHARJAH, principal: null, traceId: newTraceId() }, async () => {
    const db = getTenantDb("grant platform:operate");

    const role = await db.role.findFirst({
      where: { key: ROLE_KEYS.SuperAdmin, deletedAt: null },
    });
    if (!role) {
      throw new Error(
        `No "${ROLE_KEYS.SuperAdmin}" role found in tenant "${SHARJAH}" — run ` +
          "scripts/seed-iam-demo-data.ts first so the seeded roles exist.",
      );
    }

    const existing = await db.rolePermission.findUnique({
      where: { roleId_permissionKey: { roleId: role.id, permissionKey: PLATFORM_OPERATE } },
    });
    if (existing) {
      console.info(
        `[grant-platform-operator] already granted to "${ROLE_KEYS.SuperAdmin}" in "${SHARJAH}" — nothing to do.`,
      );
      return;
    }

    const now = new Date();
    await db.rolePermission.create({
      data: {
        id: newUlid(now),
        roleId: role.id,
        permissionKey: PLATFORM_OPERATE,
        grantedByStaffUserId: SYSTEM_SEED_ACTOR_ID,
        grantedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
    console.info(
      `[grant-platform-operator] granted "${PLATFORM_OPERATE}" to "${ROLE_KEYS.SuperAdmin}" in "${SHARJAH}".`,
    );
  });
}

main()
  .catch((error: unknown) => {
    console.error("[grant-platform-operator] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectAllTenantDbs();
  });
