import { describe, expect, it, vi, beforeEach } from "vitest";

const verifyScimBearerTokenMock = vi.fn();
const listScimUsersMock = vi.fn();
const getScimUserMock = vi.fn();
const createScimUserMock = vi.fn();
const replaceScimUserMock = vi.fn();
const setScimUserActiveMock = vi.fn();
const deleteScimUserMock = vi.fn();

vi.mock("../application/scim-token.js", () => ({
  verifyScimBearerToken: (...a: unknown[]) => verifyScimBearerTokenMock(...a),
}));
vi.mock("../application/scim-users.js", () => ({
  listScimUsers: (...a: unknown[]) => listScimUsersMock(...a),
  getScimUser: (...a: unknown[]) => getScimUserMock(...a),
  createScimUser: (...a: unknown[]) => createScimUserMock(...a),
  replaceScimUser: (...a: unknown[]) => replaceScimUserMock(...a),
  setScimUserActive: (...a: unknown[]) => setScimUserActiveMock(...a),
  deleteScimUser: (...a: unknown[]) => deleteScimUserMock(...a),
}));

const fakeCtx = { tenantId: "t1", region: "US", environment: "Production" };

describe("iam http/scim-routes (unit, mocked application layer)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyScimBearerTokenMock.mockResolvedValue(fakeCtx);
  });

  it("every handler re-verifies the bearer token against the SAME tenantSlug it was called with before delegating", async () => {
    const {
      handleScimListUsers,
      handleScimGetUser,
      handleScimCreateUser,
      handleScimReplaceUser,
      handleScimSetActive,
      handleScimDeleteUser,
    } = await import("./scim-routes.js");

    await handleScimListUsers("acme", "tok", "user@x.com");
    expect(verifyScimBearerTokenMock).toHaveBeenCalledWith("acme", "tok");
    expect(listScimUsersMock).toHaveBeenCalledWith(fakeCtx, "user@x.com");

    await handleScimGetUser("acme", "tok", "u1");
    expect(getScimUserMock).toHaveBeenCalledWith(fakeCtx, "u1");

    await handleScimCreateUser("acme", "tok", { userName: "a@b.com", displayName: "A" });
    expect(createScimUserMock).toHaveBeenCalledWith(fakeCtx, { userName: "a@b.com", displayName: "A" });

    await handleScimReplaceUser("acme", "tok", "u1", { displayName: "A", active: true, roleIds: [] });
    expect(replaceScimUserMock).toHaveBeenCalledWith(fakeCtx, "u1", { displayName: "A", active: true, roleIds: [] });

    await handleScimSetActive("acme", "tok", "u1", false);
    expect(setScimUserActiveMock).toHaveBeenCalledWith(fakeCtx, "u1", false);

    await handleScimDeleteUser("acme", "tok", "u1");
    expect(deleteScimUserMock).toHaveBeenCalledWith(fakeCtx, "u1");
  });

  it("propagates the bearer-verification failure without calling any SCIM operation", async () => {
    verifyScimBearerTokenMock.mockRejectedValue(new Error("bad token"));
    const { handleScimGetUser } = await import("./scim-routes.js");
    await expect(handleScimGetUser("acme", "bad-token", "u1")).rejects.toThrow("bad token");
    expect(getScimUserMock).not.toHaveBeenCalled();
  });
});
