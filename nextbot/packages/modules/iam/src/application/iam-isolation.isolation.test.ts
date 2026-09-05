import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { withTenant, schema } from "@nextbot/db";
import { eq } from "drizzle-orm";
import { seedSystemRoles } from "./seed-system-roles.js";
import { registerUser } from "./register-user.js";

/**
 * ADR-0001 §6 cross-tenant proof for the IAM tables (Phase 2), same pattern as
 * `packages/modules/tenancy`'s isolation suite — the generic
 * `rls-coverage.isolation.test.ts` only proves policy *presence*; this proves the
 * policy actually blocks a cross-tenant read/insert for the most sensitive table in
 * the schema (`app_user`, which holds password hashes).
 */
describe("iam tenant isolation (ADR-0001 §6 / LLD §3.2)", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("a tenant scoped to A reads zero rows of B's app_user, even querying by B's own id", async () => {
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);

    await seedSystemRoles(b);
    const bUserId = await registerUser(b, { email: "victim@example.com", password: "x".repeat(12), displayName: "Victim", roleName: "Tenant Admin" });

    const rowsSeenByA = await withTenant(a, (db) => db.select().from(schema.appUser).where(eq(schema.appUser.id, bUserId)));
    expect(rowsSeenByA).toHaveLength(0);
  });

  it("an INSERT under A's context with B's tenant_id on user_role is rejected by WITH CHECK", async () => {
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);
    const [bRoleId] = await seedSystemRoles(b);
    const bUserId = await registerUser(b, { email: "victim2@example.com", password: "x".repeat(12), displayName: "Victim2", roleName: "Tenant Admin" });

    // Both `userId`/`roleId` are genuinely valid FKs belonging to tenant B — the only
    // thing that can reject this insert is the `WITH CHECK (tenant_id = ...)` RLS
    // predicate itself, not a foreign-key violation.
    await expect(
      withTenant(a, (db) => db.insert(schema.userRole).values({ tenantId: b.tenantId, userId: bUserId, roleId: bRoleId! })),
    ).rejects.toThrow();
  });
});
