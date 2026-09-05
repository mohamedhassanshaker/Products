import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { resolveTenantById } from "@nextbot/tenancy";
import { ForbiddenModuleError, RBAC_MODULES, type PermissionMatrix } from "@nextbot/contracts";
import { createRole } from "./manage-roles.js";
import { createUser } from "./manage-users.js";
import { login } from "./authenticate-user.js";
import { verifySessionToken } from "./session-token.js";
import { requirePermission } from "../domain/permission-matrix.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

/** A matrix with every module defaulted to `"None"`, for a test to override just the
 * modules it cares about — mirrors the role editor's own "start from all-None"
 * default (`PermissionMatrixEditor.tsx`'s `emptyPermissionMatrix()`). */
function emptyMatrixFixture(): PermissionMatrix {
  const result = {} as PermissionMatrix;
  for (const module of RBAC_MODULES) result[module] = "None";
  return result;
}

async function getTenantSlug(tenantId: string): Promise<string> {
  const tenant = await resolveTenantById(tenantId);
  return tenant!.slug;
}

/**
 * This dispatch's own gate item: "confirming that role's permissions actually take
 * effect (e.g., a user with approval_queue: None genuinely can't access the Approval
 * Queue)" — exercised end-to-end through the real create-role -> create-user -> login
 * -> requirePermission path, not just each unit in isolation.
 */
describe("Users & Roles screen — a custom role's permission matrix takes effect end-to-end (real Postgres)", () => {
  it("a user assigned a custom role with approval_queue: None cannot pass requirePermission for it, while their granted modules still work", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const matrix = emptyMatrixFixture();
    matrix.approval_queue = "None";
    matrix.connectors = "Write";
    matrix.reporting = "Read";
    const roleId = await createRole(ctx, { name: "Limited Ops", permissionMatrix: matrix });

    const userId = await createUser(ctx, {
      email: "limited@example.com",
      password: "correct-horse-battery-staple",
      displayName: "Limited User",
      roleIds: [roleId],
    });
    expect(userId).toBeTruthy();

    const slug = await getTenantSlug(ctx.tenantId);
    const result = await login({ tenantSlug: slug, email: "limited@example.com", password: "correct-horse-battery-staple" });
    expect(result.outcome).toBe("authenticated");
    if (result.outcome !== "authenticated") throw new Error("expected authenticated outcome");

    const claims = await verifySessionToken(result.sessionToken);
    expect(claims.permissions.approval_queue).toBe("None");
    expect(claims.permissions.connectors).toBe("Write");
    expect(claims.permissions.reporting).toBe("Read");

    // The module this user was denied genuinely rejects — this is the same
    // `requirePermission` guard every real `/api/v1/admin/**` route calls.
    expect(() => requirePermission(claims.permissions, "approval_queue", "Read")).toThrow(ForbiddenModuleError);
    // The modules this user *was* granted genuinely work.
    expect(() => requirePermission(claims.permissions, "connectors", "Write")).not.toThrow();
    expect(() => requirePermission(claims.permissions, "reporting", "Read")).not.toThrow();
    // Read is not enough for a Write-gated action even on a module they can read.
    expect(() => requirePermission(claims.permissions, "reporting", "Write")).toThrow(ForbiddenModuleError);
  });

  it("reassigning a user's roles via updateUserRoles changes their effective permissions on next login", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const readOnlyMatrix = emptyMatrixFixture();
    readOnlyMatrix.approval_queue = "Read";
    const readOnlyRoleId = await createRole(ctx, { name: "Approval Read-Only", permissionMatrix: readOnlyMatrix });

    const writeMatrix = emptyMatrixFixture();
    writeMatrix.approval_queue = "Write";
    const writeRoleId = await createRole(ctx, { name: "Approval Write", permissionMatrix: writeMatrix });

    const userId = await createUser(ctx, {
      email: "reassign@example.com",
      password: "correct-horse-battery-staple",
      displayName: "Reassign Me",
      roleIds: [readOnlyRoleId],
    });

    const slug = await getTenantSlug(ctx.tenantId);
    const before = await login({ tenantSlug: slug, email: "reassign@example.com", password: "correct-horse-battery-staple" });
    if (before.outcome !== "authenticated") throw new Error("expected authenticated outcome");
    expect(before.permissions.approval_queue).toBe("Read");
    expect(() => requirePermission(before.permissions, "approval_queue", "Write")).toThrow(ForbiddenModuleError);

    const { updateUserRoles } = await import("./manage-users.js");
    await updateUserRoles(ctx, userId, [writeRoleId]);

    const after = await login({ tenantSlug: slug, email: "reassign@example.com", password: "correct-horse-battery-staple" });
    if (after.outcome !== "authenticated") throw new Error("expected authenticated outcome");
    expect(after.permissions.approval_queue).toBe("Write");
    expect(() => requirePermission(after.permissions, "approval_queue", "Write")).not.toThrow();
  });
});
