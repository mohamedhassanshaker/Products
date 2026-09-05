import { describe, expect, it, vi, beforeEach } from "vitest";

const findUserByEmail = vi.fn();
const findUserById = vi.fn();
const insertUser = vi.fn();
const listUsersWithRoles = vi.fn();
const assignRolesToUser = vi.fn();
const findRolesByIds = vi.fn();
const replaceUserRoles = vi.fn();
const hashPassword = vi.fn();

vi.mock("../infrastructure/user-repository.js", () => ({
  findUserByEmail: (...a: unknown[]) => findUserByEmail(...a),
  findUserById: (...a: unknown[]) => findUserById(...a),
  insertUser: (...a: unknown[]) => insertUser(...a),
  listUsersWithRoles: (...a: unknown[]) => listUsersWithRoles(...a),
}));
vi.mock("../infrastructure/role-repository.js", () => ({
  assignRolesToUser: (...a: unknown[]) => assignRolesToUser(...a),
  findRolesByIds: (...a: unknown[]) => findRolesByIds(...a),
  replaceUserRoles: (...a: unknown[]) => replaceUserRoles(...a),
}));
vi.mock("../domain/password.js", () => ({
  hashPassword: (...a: unknown[]) => hashPassword(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Production" as const };

describe("manage-users (unit, mocked repositories)", () => {
  beforeEach(() => {
    findUserByEmail.mockReset();
    findUserById.mockReset();
    insertUser.mockReset();
    listUsersWithRoles.mockReset();
    assignRolesToUser.mockReset();
    findRolesByIds.mockReset();
    replaceUserRoles.mockReset();
    hashPassword.mockReset();
  });

  describe("listUsers", () => {
    it("delegates to the repository", async () => {
      listUsersWithRoles.mockResolvedValue([{ id: "u1" }]);
      const { listUsers } = await import("./manage-users.js");
      const result = await listUsers(ctx);
      expect(result).toEqual([{ id: "u1" }]);
      expect(listUsersWithRoles).toHaveBeenCalledWith(ctx);
    });
  });

  describe("createUser", () => {
    it("hashes the password, inserts the user, and assigns every requested role", async () => {
      findUserByEmail.mockResolvedValue(null);
      findRolesByIds.mockResolvedValue([{ id: "r1" }, { id: "r2" }]);
      hashPassword.mockResolvedValue("hashed-value");
      insertUser.mockResolvedValue("user-1");

      const { createUser } = await import("./manage-users.js");
      const userId = await createUser(ctx, {
        email: "a@b.com",
        password: "secret123",
        displayName: "A B",
        roleIds: ["r1", "r2"],
      });

      expect(userId).toBe("user-1");
      expect(insertUser).toHaveBeenCalledWith(ctx, { email: "a@b.com", passwordHash: "hashed-value", displayName: "A B" });
      expect(assignRolesToUser).toHaveBeenCalledWith(ctx, "user-1", ["r1", "r2"]);
    });

    it("de-dupes repeated role ids before resolving/assigning", async () => {
      findUserByEmail.mockResolvedValue(null);
      findRolesByIds.mockResolvedValue([{ id: "r1" }]);
      hashPassword.mockResolvedValue("hashed-value");
      insertUser.mockResolvedValue("user-1");

      const { createUser } = await import("./manage-users.js");
      await createUser(ctx, { email: "a@b.com", password: "x", displayName: "X", roleIds: ["r1", "r1"] });

      expect(findRolesByIds).toHaveBeenCalledWith(ctx, ["r1"]);
      expect(assignRolesToUser).toHaveBeenCalledWith(ctx, "user-1", ["r1"]);
    });

    it("throws EmailAlreadyRegisteredError on a duplicate email", async () => {
      findUserByEmail.mockResolvedValue({ id: "existing" });
      const { createUser } = await import("./manage-users.js");
      const { EmailAlreadyRegisteredError } = await import("./register-user.js");
      await expect(
        createUser(ctx, { email: "dup@b.com", password: "x", displayName: "X", roleIds: ["r1"] }),
      ).rejects.toThrow(EmailAlreadyRegisteredError);
      expect(insertUser).not.toHaveBeenCalled();
    });

    it("throws InvalidRoleAssignmentError when a roleId doesn't resolve in this tenant", async () => {
      findUserByEmail.mockResolvedValue(null);
      findRolesByIds.mockResolvedValue([{ id: "r1" }]); // only one of two resolved
      const { createUser } = await import("./manage-users.js");
      const { InvalidRoleAssignmentError } = await import("@nextbot/contracts");
      await expect(
        createUser(ctx, { email: "a@b.com", password: "x", displayName: "X", roleIds: ["r1", "ghost"] }),
      ).rejects.toThrow(InvalidRoleAssignmentError);
      expect(insertUser).not.toHaveBeenCalled();
    });
  });

  describe("updateUserRoles", () => {
    it("replaces the user's role set when the user and every role exist", async () => {
      findUserById.mockResolvedValue({ id: "u1" });
      findRolesByIds.mockResolvedValue([{ id: "r1" }]);
      const { updateUserRoles } = await import("./manage-users.js");
      await updateUserRoles(ctx, "u1", ["r1"]);
      expect(replaceUserRoles).toHaveBeenCalledWith(ctx, "u1", ["r1"]);
    });

    it("throws UserNotFoundInTenantError when the user doesn't exist", async () => {
      findUserById.mockResolvedValue(null);
      const { updateUserRoles } = await import("./manage-users.js");
      const { UserNotFoundInTenantError } = await import("@nextbot/contracts");
      await expect(updateUserRoles(ctx, "ghost", ["r1"])).rejects.toThrow(UserNotFoundInTenantError);
      expect(replaceUserRoles).not.toHaveBeenCalled();
    });

    it("throws InvalidRoleAssignmentError when a roleId doesn't resolve", async () => {
      findUserById.mockResolvedValue({ id: "u1" });
      findRolesByIds.mockResolvedValue([]);
      const { updateUserRoles } = await import("./manage-users.js");
      const { InvalidRoleAssignmentError } = await import("@nextbot/contracts");
      await expect(updateUserRoles(ctx, "u1", ["ghost"])).rejects.toThrow(InvalidRoleAssignmentError);
      expect(replaceUserRoles).not.toHaveBeenCalled();
    });
  });
});
