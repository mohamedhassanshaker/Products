import { describe, expect, it, vi, beforeEach } from "vitest";

const loginMock = vi.fn();
const verifyMfaAndCompleteLoginMock = vi.fn();
const completeMfaEnrollmentAndLoginMock = vi.fn();
const verifySessionTokenMock = vi.fn();
const listRolesMock = vi.fn();
const createRoleMock = vi.fn();
const updateRoleMock = vi.fn();
const listUsersMock = vi.fn();
const createUserMock = vi.fn();
const updateUserRolesMock = vi.fn();
const resetUserMfaMock = vi.fn();
const resolveTenantByIdMock = vi.fn();

vi.mock("../application/authenticate-user.js", () => ({
  login: (...a: unknown[]) => loginMock(...a),
  verifyMfaAndCompleteLogin: (...a: unknown[]) => verifyMfaAndCompleteLoginMock(...a),
  completeMfaEnrollmentAndLogin: (...a: unknown[]) => completeMfaEnrollmentAndLoginMock(...a),
}));
vi.mock("../application/session-token.js", () => ({
  verifySessionToken: (...a: unknown[]) => verifySessionTokenMock(...a),
}));
vi.mock("../application/manage-roles.js", () => ({
  listRoles: (...a: unknown[]) => listRolesMock(...a),
  createRole: (...a: unknown[]) => createRoleMock(...a),
  updateRole: (...a: unknown[]) => updateRoleMock(...a),
}));
vi.mock("../application/manage-users.js", () => ({
  listUsers: (...a: unknown[]) => listUsersMock(...a),
  createUser: (...a: unknown[]) => createUserMock(...a),
  updateUserRoles: (...a: unknown[]) => updateUserRolesMock(...a),
}));
vi.mock("../application/reset-mfa.js", () => ({
  resetUserMfa: (...a: unknown[]) => resetUserMfaMock(...a),
}));
vi.mock("@nextbot/tenancy", () => ({
  resolveTenantById: (...a: unknown[]) => resolveTenantByIdMock(...a),
}));

const session = {
  tenantId: "t1",
  userId: "u1",
  roleIds: ["r1"],
  permissions: { users_roles: "Write" } as never,
};

describe("iam http/admin-routes (unit, mocked application layer)", () => {
  beforeEach(() => {
    loginMock.mockReset();
    verifyMfaAndCompleteLoginMock.mockReset();
    completeMfaEnrollmentAndLoginMock.mockReset();
    verifySessionTokenMock.mockReset();
    listRolesMock.mockReset();
    createRoleMock.mockReset();
    updateRoleMock.mockReset();
    listUsersMock.mockReset();
    createUserMock.mockReset();
    updateUserRolesMock.mockReset();
    resetUserMfaMock.mockReset();
    resolveTenantByIdMock.mockReset();
    resolveTenantByIdMock.mockResolvedValue({ id: "t1", region: "US" });
  });

  it("handleLogin forwards tenantSlug/email/password + meta to login()", async () => {
    loginMock.mockResolvedValue({ outcome: "authenticated" });
    const { handleLogin } = await import("./admin-routes.js");
    await handleLogin({ tenantSlug: "acme", email: "a@b.com", password: "x" }, { ip: "1.2.3.4" });
    expect(loginMock).toHaveBeenCalledWith({ tenantSlug: "acme", email: "a@b.com", password: "x", ip: "1.2.3.4" });
  });

  it("handleMfaChallenge forwards challengeToken/code + meta", async () => {
    verifyMfaAndCompleteLoginMock.mockResolvedValue({ outcome: "authenticated" });
    const { handleMfaChallenge } = await import("./admin-routes.js");
    await handleMfaChallenge({ challengeToken: "tok", code: "123456" }, { userAgent: "test" });
    expect(verifyMfaAndCompleteLoginMock).toHaveBeenCalledWith("tok", "123456", { userAgent: "test" });
  });

  it("handleGetSession verifies the bearer token", async () => {
    verifySessionTokenMock.mockResolvedValue(session);
    const { handleGetSession } = await import("./admin-routes.js");
    const result = await handleGetSession("token-value");
    expect(result).toBe(session);
    expect(verifySessionTokenMock).toHaveBeenCalledWith("token-value");
  });

  it("handleListRoles enforces users_roles=Read and resolves the tenant region", async () => {
    listRolesMock.mockResolvedValue([]);
    const { handleListRoles } = await import("./admin-routes.js");
    await handleListRoles(session);
    expect(listRolesMock).toHaveBeenCalledWith({ tenantId: "t1", region: "US", environment: "Production" });
  });

  it("handleListRoles throws ForbiddenModuleError when the session lacks users_roles=Read", async () => {
    const { handleListRoles } = await import("./admin-routes.js");
    const { ForbiddenModuleError } = await import("@nextbot/contracts");
    const noPermsSession = { ...session, permissions: { users_roles: "None" } as never };
    await expect(handleListRoles(noPermsSession)).rejects.toThrow(ForbiddenModuleError);
  });

  it("handleCreateRole enforces users_roles=Write", async () => {
    createRoleMock.mockResolvedValue("role-id");
    const { handleCreateRole } = await import("./admin-routes.js");
    const result = await handleCreateRole(session, { name: "New Role", permissionMatrix: {} as never });
    expect(result).toBe("role-id");
  });

  it("handleMfaEnrollmentConfirm forwards enrollmentToken/code + meta (QA Defect B3)", async () => {
    completeMfaEnrollmentAndLoginMock.mockResolvedValue({ outcome: "authenticated" });
    const { handleMfaEnrollmentConfirm } = await import("./admin-routes.js");
    await handleMfaEnrollmentConfirm({ enrollmentToken: "tok", code: "123456" }, { userAgent: "test" });
    expect(completeMfaEnrollmentAndLoginMock).toHaveBeenCalledWith("tok", "123456", { userAgent: "test" });
  });

  it("handleResetUserMfa enforces users_roles=Write and resolves the tenant region (QA Defect B2)", async () => {
    const { handleResetUserMfa } = await import("./admin-routes.js");
    await handleResetUserMfa(session, "user-1");
    expect(resetUserMfaMock).toHaveBeenCalledWith({ tenantId: "t1", region: "US", environment: "Production" }, "user-1");
  });

  it("handleResetUserMfa throws ForbiddenModuleError when the session lacks users_roles=Write", async () => {
    const { handleResetUserMfa } = await import("./admin-routes.js");
    const { ForbiddenModuleError } = await import("@nextbot/contracts");
    const readOnlySession = { ...session, permissions: { users_roles: "Read" } as never };
    await expect(handleResetUserMfa(readOnlySession, "user-1")).rejects.toThrow(ForbiddenModuleError);
  });

  // Defensive "tenant vanished mid-session" guards — session references a tenant id
  // `resolveTenantById` can no longer resolve (deleted/never existed).
  it("handleListRoles throws when the session's tenant can no longer be resolved", async () => {
    resolveTenantByIdMock.mockResolvedValue(null);
    const { handleListRoles } = await import("./admin-routes.js");
    await expect(handleListRoles(session)).rejects.toThrow(/tenant not found/i);
  });

  it("handleCreateRole throws when the session's tenant can no longer be resolved", async () => {
    resolveTenantByIdMock.mockResolvedValue(null);
    const { handleCreateRole } = await import("./admin-routes.js");
    await expect(handleCreateRole(session, { name: "X", permissionMatrix: {} as never })).rejects.toThrow(/tenant not found/i);
  });

  it("handleResetUserMfa throws when the session's tenant can no longer be resolved", async () => {
    resolveTenantByIdMock.mockResolvedValue(null);
    const { handleResetUserMfa } = await import("./admin-routes.js");
    await expect(handleResetUserMfa(session, "user-1")).rejects.toThrow(/tenant not found/i);
  });

  it("handleUpdateRole enforces users_roles=Write and resolves the tenant region", async () => {
    const { handleUpdateRole } = await import("./admin-routes.js");
    await handleUpdateRole(session, "role-1", { name: "Custom", permissionMatrix: {} as never });
    expect(updateRoleMock).toHaveBeenCalledWith({ tenantId: "t1", region: "US", environment: "Production" }, "role-1", {
      name: "Custom",
      permissionMatrix: {},
    });
  });

  it("handleUpdateRole throws ForbiddenModuleError when the session lacks users_roles=Write", async () => {
    const { handleUpdateRole } = await import("./admin-routes.js");
    const { ForbiddenModuleError } = await import("@nextbot/contracts");
    const readOnlySession = { ...session, permissions: { users_roles: "Read" } as never };
    await expect(handleUpdateRole(readOnlySession, "role-1", { name: "X", permissionMatrix: {} as never })).rejects.toThrow(
      ForbiddenModuleError,
    );
  });

  it("handleListUsers enforces users_roles=Read and resolves the tenant region", async () => {
    listUsersMock.mockResolvedValue([]);
    const { handleListUsers } = await import("./admin-routes.js");
    await handleListUsers(session);
    expect(listUsersMock).toHaveBeenCalledWith({ tenantId: "t1", region: "US", environment: "Production" });
  });

  it("handleListUsers throws ForbiddenModuleError when the session lacks users_roles=Read", async () => {
    const { handleListUsers } = await import("./admin-routes.js");
    const { ForbiddenModuleError } = await import("@nextbot/contracts");
    const noPermsSession = { ...session, permissions: { users_roles: "None" } as never };
    await expect(handleListUsers(noPermsSession)).rejects.toThrow(ForbiddenModuleError);
  });

  it("handleCreateUser enforces users_roles=Write", async () => {
    createUserMock.mockResolvedValue("user-id");
    const { handleCreateUser } = await import("./admin-routes.js");
    const result = await handleCreateUser(session, {
      email: "new@b.com",
      password: "supersecret1",
      displayName: "New Person",
      roleIds: ["r1"],
    });
    expect(result).toBe("user-id");
  });

  it("handleCreateUser throws ForbiddenModuleError when the session lacks users_roles=Write", async () => {
    const { handleCreateUser } = await import("./admin-routes.js");
    const { ForbiddenModuleError } = await import("@nextbot/contracts");
    const readOnlySession = { ...session, permissions: { users_roles: "Read" } as never };
    await expect(
      handleCreateUser(readOnlySession, { email: "x@b.com", password: "x", displayName: "X", roleIds: ["r1"] }),
    ).rejects.toThrow(ForbiddenModuleError);
  });

  it("handleUpdateUserRoles enforces users_roles=Write and forwards roleIds", async () => {
    const { handleUpdateUserRoles } = await import("./admin-routes.js");
    await handleUpdateUserRoles(session, "user-1", { roleIds: ["r1", "r2"] });
    expect(updateUserRolesMock).toHaveBeenCalledWith(
      { tenantId: "t1", region: "US", environment: "Production" },
      "user-1",
      ["r1", "r2"],
    );
  });

  it("handleUpdateUserRoles throws ForbiddenModuleError when the session lacks users_roles=Write", async () => {
    const { handleUpdateUserRoles } = await import("./admin-routes.js");
    const { ForbiddenModuleError } = await import("@nextbot/contracts");
    const readOnlySession = { ...session, permissions: { users_roles: "Read" } as never };
    await expect(handleUpdateUserRoles(readOnlySession, "user-1", { roleIds: ["r1"] })).rejects.toThrow(ForbiddenModuleError);
  });
});
