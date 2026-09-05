import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { insertUser, listUsersWithRoles } from "./user-repository.js";
import { insertRole, assignRolesToUser } from "./role-repository.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

describe("listUsersWithRoles (real Postgres)", () => {
  it("attaches every assigned role to its user", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const roleA = await insertRole(ctx, { name: "Role A", permissionMatrix: {} as never });
    const roleB = await insertRole(ctx, { name: "Role B", permissionMatrix: {} as never });
    const userId = await insertUser(ctx, { email: "multi@b.com", passwordHash: null, displayName: "Multi Role" });
    await assignRolesToUser(ctx, userId, [roleA, roleB]);

    const users = await listUsersWithRoles(ctx);
    const found = users.find((u) => u.id === userId);
    expect(found?.roles.map((r) => r.name).sort()).toEqual(["Role A", "Role B"]);
  });

  it("returns an empty roles array (not a dropped row) for a user with zero role assignments", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const userId = await insertUser(ctx, { email: "norole@b.com", passwordHash: null, displayName: "No Role" });

    const users = await listUsersWithRoles(ctx);
    const found = users.find((u) => u.id === userId);
    expect(found).toBeDefined();
    expect(found?.roles).toEqual([]);
  });

  it("carries lastLoginAt/mfaEnrolled/status through unmodified", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const userId = await insertUser(ctx, { email: "shape@b.com", passwordHash: null, displayName: "Shape Check", status: "Invited" });

    const users = await listUsersWithRoles(ctx);
    const found = users.find((u) => u.id === userId);
    expect(found?.status).toBe("Invited");
    expect(found?.mfaEnrolled).toBe(false);
    expect(found?.lastLoginAt).toBeNull();
  });
});
