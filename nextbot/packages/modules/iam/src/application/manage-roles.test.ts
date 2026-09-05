import { describe, expect, it, vi, beforeEach } from "vitest";

const findRoleByName = vi.fn();
const findRoleById = vi.fn();
const insertRole = vi.fn();
const listRolesRepo = vi.fn();
const updateRoleRepo = vi.fn();

vi.mock("../infrastructure/role-repository.js", () => ({
  findRoleByName: (...a: unknown[]) => findRoleByName(...a),
  findRoleById: (...a: unknown[]) => findRoleById(...a),
  insertRole: (...a: unknown[]) => insertRole(...a),
  listRoles: (...a: unknown[]) => listRolesRepo(...a),
  updateRole: (...a: unknown[]) => updateRoleRepo(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Production" as const };

describe("manage-roles (unit, mocked repository)", () => {
  beforeEach(() => {
    findRoleByName.mockReset();
    findRoleById.mockReset();
    insertRole.mockReset();
    listRolesRepo.mockReset();
    updateRoleRepo.mockReset();
  });

  it("listRoles delegates to the repository", async () => {
    listRolesRepo.mockResolvedValue([{ id: "r1" }]);
    const { listRoles } = await import("./manage-roles.js");
    const result = await listRoles(ctx);
    expect(result).toEqual([{ id: "r1" }]);
    expect(listRolesRepo).toHaveBeenCalledWith(ctx);
  });

  it("createRole inserts a non-system role when the name is free", async () => {
    findRoleByName.mockResolvedValue(null);
    insertRole.mockResolvedValue("role-new");
    const { createRole } = await import("./manage-roles.js");
    const matrix = { connectors: "Read" } as never;
    const id = await createRole(ctx, { name: "Custom", permissionMatrix: matrix });
    expect(id).toBe("role-new");
    expect(insertRole).toHaveBeenCalledWith(ctx, { name: "Custom", permissionMatrix: matrix, isSystem: false, mfaRequired: false });
  });

  it("createRole passes mfaRequired through when set (QA Defect B3)", async () => {
    findRoleByName.mockResolvedValue(null);
    insertRole.mockResolvedValue("role-new");
    const { createRole } = await import("./manage-roles.js");
    const matrix = { connectors: "Read" } as never;
    await createRole(ctx, { name: "Custom", permissionMatrix: matrix, mfaRequired: true });
    expect(insertRole).toHaveBeenCalledWith(ctx, { name: "Custom", permissionMatrix: matrix, isSystem: false, mfaRequired: true });
  });

  it("createRole throws RoleNameDuplicateError when the name is taken", async () => {
    findRoleByName.mockResolvedValue({ id: "existing" });
    const { createRole } = await import("./manage-roles.js");
    const { RoleNameDuplicateError } = await import("@nextbot/contracts");
    await expect(createRole(ctx, { name: "Taken", permissionMatrix: {} as never })).rejects.toThrow(RoleNameDuplicateError);
    expect(insertRole).not.toHaveBeenCalled();
  });

  describe("updateRole", () => {
    it("updates a custom role's matrix/name/mfaRequired", async () => {
      findRoleById.mockResolvedValue({ id: "r2", name: "Custom", isSystem: false, permissionMatrix: {}, mfaRequired: false });
      findRoleByName.mockResolvedValue(null);
      const { updateRole } = await import("./manage-roles.js");
      const matrix = { connectors: "Write" } as never;
      await updateRole(ctx, "r2", { name: "Custom", permissionMatrix: matrix, mfaRequired: true });
      expect(updateRoleRepo).toHaveBeenCalledWith(ctx, "r2", { name: "Custom", permissionMatrix: matrix, mfaRequired: true });
    });

    it("throws RoleNotFoundInTenantError when the role doesn't exist", async () => {
      findRoleById.mockResolvedValue(null);
      const { updateRole } = await import("./manage-roles.js");
      const { RoleNotFoundInTenantError } = await import("@nextbot/contracts");
      await expect(updateRole(ctx, "ghost", { name: "X", permissionMatrix: {} as never })).rejects.toThrow(
        RoleNotFoundInTenantError,
      );
      expect(updateRoleRepo).not.toHaveBeenCalled();
    });

    it("throws SystemRoleImmutableError for a system role, never touching the repository", async () => {
      findRoleById.mockResolvedValue({ id: "r1", name: "Tenant Admin", isSystem: true, permissionMatrix: {}, mfaRequired: false });
      const { updateRole } = await import("./manage-roles.js");
      const { SystemRoleImmutableError } = await import("@nextbot/contracts");
      await expect(updateRole(ctx, "r1", { name: "Tenant Admin", permissionMatrix: {} as never })).rejects.toThrow(
        SystemRoleImmutableError,
      );
      expect(updateRoleRepo).not.toHaveBeenCalled();
    });

    it("throws RoleNameDuplicateError when renaming to a name already used by a different role", async () => {
      findRoleById.mockResolvedValue({ id: "r2", name: "Custom", isSystem: false, permissionMatrix: {}, mfaRequired: false });
      findRoleByName.mockResolvedValue({ id: "r3", name: "Taken" });
      const { updateRole } = await import("./manage-roles.js");
      const { RoleNameDuplicateError } = await import("@nextbot/contracts");
      await expect(updateRole(ctx, "r2", { name: "Taken", permissionMatrix: {} as never })).rejects.toThrow(
        RoleNameDuplicateError,
      );
      expect(updateRoleRepo).not.toHaveBeenCalled();
    });

    it("allows keeping the same name (no collision check against itself)", async () => {
      findRoleById.mockResolvedValue({ id: "r2", name: "Custom", isSystem: false, permissionMatrix: {}, mfaRequired: false });
      const { updateRole } = await import("./manage-roles.js");
      await updateRole(ctx, "r2", { name: "Custom", permissionMatrix: {} as never });
      expect(findRoleByName).not.toHaveBeenCalled();
      expect(updateRoleRepo).toHaveBeenCalled();
    });
  });
});
