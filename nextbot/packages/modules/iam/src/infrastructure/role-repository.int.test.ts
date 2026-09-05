import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import {
  insertRole,
  findRoleByName,
  findRoleById,
  findRolesByIds,
  updateRole,
  assignRoleToUser,
  assignRolesToUser,
  replaceUserRoles,
  syncSsoRoleAssignment,
} from "./role-repository.js";
import { insertUser, listUsersWithRoles } from "./user-repository.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

describe("role-repository (real Postgres)", () => {
  it("insertRole defaults isSystem and mfaRequired to false when omitted entirely", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    await insertRole(ctx, { name: "Custom Role", permissionMatrix: {} as never });
    const found = await findRoleByName(ctx, "Custom Role");

    expect(found).toMatchObject({ isSystem: false, mfaRequired: false });
  });

  it("insertRole persists an explicit mfaRequired: true (QA Defect B3)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    await insertRole(ctx, { name: "MFA Required Role", permissionMatrix: {} as never, mfaRequired: true });
    const found = await findRoleByName(ctx, "MFA Required Role");

    expect(found?.mfaRequired).toBe(true);
  });

  it("findRoleById finds an existing role and returns null for an unknown id", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const roleId = await insertRole(ctx, { name: "Findable", permissionMatrix: {} as never });
    expect((await findRoleById(ctx, roleId))?.name).toBe("Findable");
    expect(await findRoleById(ctx, "00000000-0000-7000-8000-000000000000")).toBeNull();
  });

  it("findRolesByIds resolves only the ids that exist in this tenant", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const r1 = await insertRole(ctx, { name: "Role A", permissionMatrix: {} as never });
    const r2 = await insertRole(ctx, { name: "Role B", permissionMatrix: {} as never });

    const found = await findRolesByIds(ctx, [r1, r2, "00000000-0000-7000-8000-000000000000"]);
    expect(found.map((r) => r.id).sort()).toEqual([r1, r2].sort());
  });

  it("updateRole persists a name/matrix/mfaRequired change on a non-system role", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const roleId = await insertRole(ctx, { name: "Before", permissionMatrix: {} as never, mfaRequired: false });
    await updateRole(ctx, roleId, { name: "After", permissionMatrix: { connectors: "Write" } as never, mfaRequired: true });

    const found = await findRoleById(ctx, roleId);
    expect(found?.name).toBe("After");
    expect(found?.mfaRequired).toBe(true);
    expect(found?.permissionMatrix).toEqual({ connectors: "Write" });
  });

  it("updateRole is a no-op (defense-in-depth WHERE clause) against a system role", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const roleId = await insertRole(ctx, { name: "System Role", permissionMatrix: {} as never, isSystem: true });
    await updateRole(ctx, roleId, { name: "Renamed", permissionMatrix: {} as never });

    const found = await findRoleById(ctx, roleId);
    expect(found?.name).toBe("System Role"); // unchanged — the WHERE isSystem=false clause excluded it
  });

  it("replaceUserRoles atomically swaps a user's role assignment set", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const roleA = await insertRole(ctx, { name: "Role A", permissionMatrix: {} as never });
    const roleB = await insertRole(ctx, { name: "Role B", permissionMatrix: {} as never });
    const userId = await insertUser(ctx, { email: "u@b.com", passwordHash: null, displayName: "U" });

    await assignRolesToUser(ctx, userId, [roleA]);
    await replaceUserRoles(ctx, userId, [roleB]);

    const users = await listUsersWithRoles(ctx);
    const user = users.find((u) => u.id === userId)!;
    expect(user.roles.map((r) => r.id)).toEqual([roleB]); // Role A was removed, Role B is the only assignment now
  });

  // QA 20260829-054900 Finding 1 fix — syncSsoRoleAssignment must re-derive the
  // SSO-sourced role set exactly, without ever touching a Manual grant.
  describe("syncSsoRoleAssignment (QA 20260829-054900 Finding 1 fix)", () => {
    it("adds a newly-asserted role AND removes a previously Sso-sourced role no longer asserted", async () => {
      const ctx = await createFixtureTenant();
      createdTenantIds.push(ctx.tenantId);

      const roleAdmin = await insertRole(ctx, { name: "Admin", permissionMatrix: {} as never });
      const roleReadOnly = await insertRole(ctx, { name: "Read-Only", permissionMatrix: {} as never });
      const userId = await insertUser(ctx, { email: "sso@b.com", passwordHash: null, displayName: "SSO User" });

      // Login 1: IdP asserts a group mapping to Admin.
      await syncSsoRoleAssignment(ctx, userId, [roleAdmin]);
      let users = await listUsersWithRoles(ctx);
      expect(users.find((u) => u.id === userId)!.roles.map((r) => r.id)).toEqual([roleAdmin]);

      // Login 2: IdP now asserts a DIFFERENT, non-overlapping group -> Read-Only only.
      await syncSsoRoleAssignment(ctx, userId, [roleReadOnly]);
      users = await listUsersWithRoles(ctx);
      expect(users.find((u) => u.id === userId)!.roles.map((r) => r.id)).toEqual([roleReadOnly]); // Admin fully retracted, not unioned
    });

    it("never removes a Manual (console/SCIM) grant, even if the IdP assertion no longer maps to it", async () => {
      const ctx = await createFixtureTenant();
      createdTenantIds.push(ctx.tenantId);

      const manualRole = await insertRole(ctx, { name: "Console Granted", permissionMatrix: {} as never });
      const ssoRoleA = await insertRole(ctx, { name: "SSO Role A", permissionMatrix: {} as never });
      const ssoRoleB = await insertRole(ctx, { name: "SSO Role B", permissionMatrix: {} as never });
      const userId = await insertUser(ctx, { email: "mixed@b.com", passwordHash: null, displayName: "Mixed User" });

      // Admin manually grants a role through the console (default source: Manual).
      await assignRoleToUser(ctx, userId, manualRole);
      // Login 1 asserts SSO Role A.
      await syncSsoRoleAssignment(ctx, userId, [ssoRoleA]);
      // Login 2 asserts a completely different group -> SSO Role B, no longer A.
      await syncSsoRoleAssignment(ctx, userId, [ssoRoleB]);

      const users = await listUsersWithRoles(ctx);
      const roleIds = users.find((u) => u.id === userId)!.roles.map((r) => r.id).sort();
      expect(roleIds).toEqual([manualRole, ssoRoleB].sort()); // manual grant survived; stale SSO role A gone, current SSO role B present
    });

    it("refuses to shrink the SSO-derived set to zero when the IdP assertion maps to nothing", async () => {
      const ctx = await createFixtureTenant();
      createdTenantIds.push(ctx.tenantId);

      const ssoRole = await insertRole(ctx, { name: "SSO Role", permissionMatrix: {} as never });
      const userId = await insertUser(ctx, { email: "empty-claim@b.com", passwordHash: null, displayName: "Empty Claim User" });

      await syncSsoRoleAssignment(ctx, userId, [ssoRole]);
      await syncSsoRoleAssignment(ctx, userId, []); // misconfigured/empty group claim on a later login

      const users = await listUsersWithRoles(ctx);
      expect(users.find((u) => u.id === userId)!.roles.map((r) => r.id)).toEqual([ssoRole]); // left untouched, not stripped to zero
    });

    it("re-granting a role that already exists as Manual keeps it Manual (not silently reclassified to Sso)", async () => {
      const ctx = await createFixtureTenant();
      createdTenantIds.push(ctx.tenantId);

      const roleId = await insertRole(ctx, { name: "Shared Role", permissionMatrix: {} as never });
      const otherSsoRole = await insertRole(ctx, { name: "Other SSO Role", permissionMatrix: {} as never });
      const userId = await insertUser(ctx, { email: "shared@b.com", passwordHash: null, displayName: "Shared User" });

      await assignRoleToUser(ctx, userId, roleId); // Manual grant first
      await syncSsoRoleAssignment(ctx, userId, [roleId]); // IdP also asserts a group mapping to the same role (onConflictDoNothing — row stays Manual-sourced)
      // A later login whose assertion maps to a DIFFERENT, non-overlapping role must
      // not remove `roleId`, because the underlying row is still Manual-sourced —
      // onConflictDoNothing on the earlier call never overwrote its source column.
      await syncSsoRoleAssignment(ctx, userId, [otherSsoRole]);

      const users = await listUsersWithRoles(ctx);
      const roleIds = users.find((u) => u.id === userId)!.roles.map((r) => r.id).sort();
      expect(roleIds).toEqual([roleId, otherSsoRole].sort());
    });
  });
});
