import { describe, expect, it, vi, beforeEach } from "vitest";
import { ForbiddenModuleError } from "@nextbot/contracts";

const listServiceAccountsMock = vi.fn();
const createServiceAccountMock = vi.fn();
const disableServiceAccountMock = vi.fn();
const listApiKeysMock = vi.fn();
const issueApiKeyMock = vi.fn();
const revokeApiKeyActionMock = vi.fn();
const resolveTenantByIdMock = vi.fn();

vi.mock("../application/service-account.js", () => ({
  listServiceAccounts: (...a: unknown[]) => listServiceAccountsMock(...a),
  createServiceAccount: (...a: unknown[]) => createServiceAccountMock(...a),
  disableServiceAccount: (...a: unknown[]) => disableServiceAccountMock(...a),
  listApiKeys: (...a: unknown[]) => listApiKeysMock(...a),
  issueApiKey: (...a: unknown[]) => issueApiKeyMock(...a),
  revokeApiKeyAction: (...a: unknown[]) => revokeApiKeyActionMock(...a),
}));
vi.mock("@nextbot/tenancy", () => ({
  resolveTenantById: (...a: unknown[]) => resolveTenantByIdMock(...a),
}));

const writeSession = { tenantId: "t1", userId: "u1", roleIds: ["r1"], permissions: { users_roles: "Write" } as never };
const readOnlySession = { tenantId: "t1", userId: "u1", roleIds: ["r1"], permissions: { users_roles: "Read" } as never };

describe("iam http/service-account-routes (unit, mocked application layer)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantByIdMock.mockResolvedValue({ id: "t1", region: "US", slug: "acme" });
  });

  it("handleListServiceAccounts requires Read, handleCreateServiceAccount requires Write", async () => {
    const { handleListServiceAccounts, handleCreateServiceAccount } = await import("./service-account-routes.js");
    await handleListServiceAccounts(readOnlySession);
    expect(listServiceAccountsMock).toHaveBeenCalledWith({ tenantId: "t1", region: "US", environment: "Production" });

    await expect(handleCreateServiceAccount(readOnlySession, { name: "bot", roleIds: ["r1"] })).rejects.toThrow(ForbiddenModuleError);
    await handleCreateServiceAccount(writeSession, { name: "bot", roleIds: ["r1"] });
    expect(createServiceAccountMock).toHaveBeenCalledWith({ tenantId: "t1", region: "US", environment: "Production" }, { name: "bot", roleIds: ["r1"] });
  });

  it("handleDisableServiceAccount requires Write and delegates", async () => {
    const { handleDisableServiceAccount } = await import("./service-account-routes.js");
    await expect(handleDisableServiceAccount(readOnlySession, "sa1")).rejects.toThrow(ForbiddenModuleError);
    await handleDisableServiceAccount(writeSession, "sa1");
    expect(disableServiceAccountMock).toHaveBeenCalledWith({ tenantId: "t1", region: "US", environment: "Production" }, "sa1");
  });

  it("handleIssueApiKey passes the resolved tenant SLUG through to issueApiKey (needed for the nbk_ format)", async () => {
    const { handleIssueApiKey } = await import("./service-account-routes.js");
    await expect(handleIssueApiKey(readOnlySession, "sa1", { name: "k" })).rejects.toThrow(ForbiddenModuleError);
    await handleIssueApiKey(writeSession, "sa1", { name: "k" });
    expect(issueApiKeyMock).toHaveBeenCalledWith({ tenantId: "t1", region: "US", environment: "Production" }, "acme", "sa1", { name: "k" });
  });

  it("handleListApiKeys requires Read, handleRevokeApiKey requires Write", async () => {
    const { handleListApiKeys, handleRevokeApiKey } = await import("./service-account-routes.js");
    await handleListApiKeys(readOnlySession, "sa1");
    expect(listApiKeysMock).toHaveBeenCalledWith({ tenantId: "t1", region: "US", environment: "Production" }, "sa1");

    await expect(handleRevokeApiKey(readOnlySession, "k1")).rejects.toThrow(ForbiddenModuleError);
    await handleRevokeApiKey(writeSession, "k1");
    expect(revokeApiKeyActionMock).toHaveBeenCalledWith({ tenantId: "t1", region: "US", environment: "Production" }, "k1");
  });
});
