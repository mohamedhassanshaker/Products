import { describe, expect, it, vi, beforeEach } from "vitest";
import { ForbiddenModuleError } from "@nextbot/contracts";

const listMySessionsMock = vi.fn();
const listTenantSessionsMock = vi.fn();
const revokeMySessionMock = vi.fn();
const revokeAllMySessionsMock = vi.fn();
const adminRevokeSessionMock = vi.fn();
const adminRevokeAllSessionsForUserMock = vi.fn();
const resolveTenantByIdMock = vi.fn();

vi.mock("../application/session-management.js", () => ({
  listMySessions: (...a: unknown[]) => listMySessionsMock(...a),
  listTenantSessions: (...a: unknown[]) => listTenantSessionsMock(...a),
  revokeMySession: (...a: unknown[]) => revokeMySessionMock(...a),
  revokeAllMySessions: (...a: unknown[]) => revokeAllMySessionsMock(...a),
  adminRevokeSession: (...a: unknown[]) => adminRevokeSessionMock(...a),
  adminRevokeAllSessionsForUser: (...a: unknown[]) => adminRevokeAllSessionsForUserMock(...a),
}));
vi.mock("@nextbot/tenancy", () => ({
  resolveTenantById: (...a: unknown[]) => resolveTenantByIdMock(...a),
}));

const writeSession = { tenantId: "t1", userId: "u1", roleIds: ["r1"], permissions: { users_roles: "Write" } as never };
const readOnlySession = { tenantId: "t1", userId: "u1", roleIds: ["r1"], permissions: { users_roles: "Read" } as never };
const noAccessSession = { tenantId: "t1", userId: "u1", roleIds: ["r1"], permissions: {} as never };

describe("iam http/session-routes (unit, mocked application layer)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantByIdMock.mockResolvedValue({ id: "t1", region: "US" });
  });

  it("handleListMySessions/handleRevokeMySession/handleRevokeAllMySessions need NO RBAC grant — self-service", async () => {
    const { handleListMySessions, handleRevokeMySession, handleRevokeAllMySessions } = await import("./session-routes.js");
    await handleListMySessions(noAccessSession);
    expect(listMySessionsMock).toHaveBeenCalledWith({ tenantId: "t1", region: "US", environment: "Production" }, "u1");

    await handleRevokeMySession(noAccessSession, "s1");
    expect(revokeMySessionMock).toHaveBeenCalledWith({ tenantId: "t1", region: "US", environment: "Production" }, "u1", "s1");

    await handleRevokeAllMySessions(noAccessSession);
    expect(revokeAllMySessionsMock).toHaveBeenCalledWith({ tenantId: "t1", region: "US", environment: "Production" }, "u1");
  });

  it("handleListTenantSessions requires users_roles:Read", async () => {
    const { handleListTenantSessions } = await import("./session-routes.js");
    await expect(handleListTenantSessions(noAccessSession)).rejects.toThrow(ForbiddenModuleError);
    await handleListTenantSessions(readOnlySession);
    expect(listTenantSessionsMock).toHaveBeenCalled();
  });

  it("handleAdminRevokeSession/handleAdminRevokeAllSessionsForUser require users_roles:Write (Read insufficient)", async () => {
    const { handleAdminRevokeSession, handleAdminRevokeAllSessionsForUser } = await import("./session-routes.js");
    await expect(handleAdminRevokeSession(readOnlySession, "s1")).rejects.toThrow(ForbiddenModuleError);
    await handleAdminRevokeSession(writeSession, "s1");
    expect(adminRevokeSessionMock).toHaveBeenCalledWith({ tenantId: "t1", region: "US", environment: "Production" }, "s1");

    await expect(handleAdminRevokeAllSessionsForUser(readOnlySession, "u2")).rejects.toThrow(ForbiddenModuleError);
    await handleAdminRevokeAllSessionsForUser(writeSession, "u2");
    expect(adminRevokeAllSessionsForUserMock).toHaveBeenCalledWith({ tenantId: "t1", region: "US", environment: "Production" }, "u2");
  });
});
