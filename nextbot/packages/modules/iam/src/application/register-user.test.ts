import { describe, expect, it, vi, beforeEach } from "vitest";

const findUserByEmail = vi.fn();
const insertUser = vi.fn();
const findRoleByName = vi.fn();
const assignRoleToUser = vi.fn();
const hashPassword = vi.fn();

vi.mock("../infrastructure/user-repository.js", () => ({
  findUserByEmail: (...a: unknown[]) => findUserByEmail(...a),
  insertUser: (...a: unknown[]) => insertUser(...a),
}));
vi.mock("../infrastructure/role-repository.js", () => ({
  findRoleByName: (...a: unknown[]) => findRoleByName(...a),
  assignRoleToUser: (...a: unknown[]) => assignRoleToUser(...a),
}));
vi.mock("../domain/password.js", () => ({
  hashPassword: (...a: unknown[]) => hashPassword(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Production" as const };

describe("registerUser (unit, mocked repositories)", () => {
  beforeEach(() => {
    findUserByEmail.mockReset();
    insertUser.mockReset();
    findRoleByName.mockReset();
    assignRoleToUser.mockReset();
    hashPassword.mockReset();
  });

  it("hashes the password, inserts the user, and assigns the requested role", async () => {
    findUserByEmail.mockResolvedValue(null);
    findRoleByName.mockResolvedValue({ id: "role-1", tenantId: "t1", name: "Tenant Admin", isSystem: true, permissionMatrix: {} });
    hashPassword.mockResolvedValue("hashed-value");
    insertUser.mockResolvedValue("user-1");

    const { registerUser } = await import("./register-user.js");
    const userId = await registerUser(ctx, { email: "a@b.com", password: "secret123", displayName: "A B", roleName: "Tenant Admin" });

    expect(userId).toBe("user-1");
    expect(hashPassword).toHaveBeenCalledWith("secret123");
    expect(insertUser).toHaveBeenCalledWith(ctx, { email: "a@b.com", passwordHash: "hashed-value", displayName: "A B" });
    expect(assignRoleToUser).toHaveBeenCalledWith(ctx, "user-1", "role-1");
  });

  it("throws EmailAlreadyRegisteredError on a duplicate email", async () => {
    findUserByEmail.mockResolvedValue({ id: "existing" });
    const { registerUser, EmailAlreadyRegisteredError } = await import("./register-user.js");
    await expect(
      registerUser(ctx, { email: "dup@b.com", password: "x", displayName: "X", roleName: "Tenant Admin" }),
    ).rejects.toThrow(EmailAlreadyRegisteredError);
    expect(insertUser).not.toHaveBeenCalled();
  });

  it("throws RoleNotFoundError when the named role doesn't exist", async () => {
    findUserByEmail.mockResolvedValue(null);
    findRoleByName.mockResolvedValue(null);
    const { registerUser, RoleNotFoundError } = await import("./register-user.js");
    await expect(
      registerUser(ctx, { email: "a@b.com", password: "x", displayName: "X", roleName: "Ghost Role" }),
    ).rejects.toThrow(RoleNotFoundError);
  });
});
