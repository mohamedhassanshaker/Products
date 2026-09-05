import { describe, expect, it, vi, beforeEach } from "vitest";
import { ForbiddenModuleError } from "@nextbot/contracts";

const getSsoConnectionConfigMock = vi.fn();
const upsertConnectionMock = vi.fn();
const setConnectionStatusMock = vi.fn();
const listSsoGroupMappingsMock = vi.fn();
const upsertSsoGroupMappingMock = vi.fn();
const deleteSsoGroupMappingMock = vi.fn();
const resolveTenantByIdMock = vi.fn();

vi.mock("../application/sso-connection.js", () => ({
  getSsoConnectionConfig: (...a: unknown[]) => getSsoConnectionConfigMock(...a),
  upsertConnection: (...a: unknown[]) => upsertConnectionMock(...a),
  setConnectionStatus: (...a: unknown[]) => setConnectionStatusMock(...a),
}));
vi.mock("../infrastructure/sso-group-mapping-repository.js", () => ({
  listSsoGroupMappings: (...a: unknown[]) => listSsoGroupMappingsMock(...a),
  upsertSsoGroupMapping: (...a: unknown[]) => upsertSsoGroupMappingMock(...a),
  deleteSsoGroupMapping: (...a: unknown[]) => deleteSsoGroupMappingMock(...a),
}));
vi.mock("@nextbot/tenancy", () => ({
  resolveTenantById: (...a: unknown[]) => resolveTenantByIdMock(...a),
}));

const writeSession = { tenantId: "t1", userId: "u1", roleIds: ["r1"], permissions: { security_settings: "Write" } as never };
const readOnlySession = { tenantId: "t1", userId: "u1", roleIds: ["r1"], permissions: { security_settings: "Read" } as never };
const noAccessSession = { tenantId: "t1", userId: "u1", roleIds: ["r1"], permissions: {} as never };

describe("iam http/sso-admin-routes (unit, mocked application layer)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantByIdMock.mockResolvedValue({ id: "t1", region: "US" });
  });

  it("handleGetSsoConnection masks the OIDC client secret, never returning the ciphertext", async () => {
    getSsoConnectionConfigMock.mockResolvedValue({
      id: "c1",
      protocol: "Oidc",
      displayName: "IdP",
      status: "Active",
      jitProvisioningEnabled: true,
      defaultRoleId: null,
      groupClaimName: null,
      oidcIssuerUrl: "https://idp",
      oidcClientId: "cid",
      oidcClientSecretCiphertext: "SECRET-CIPHERTEXT-SHOULD-NEVER-LEAK",
      oidcClientSecretDekRef: "dek-ref",
      samlEntryPoint: null,
      samlIssuer: null,
      samlIdpCertificate: null,
    });
    const { handleGetSsoConnection } = await import("./sso-admin-routes.js");
    const result = await handleGetSsoConnection(readOnlySession);
    expect(JSON.stringify(result)).not.toContain("SECRET-CIPHERTEXT-SHOULD-NEVER-LEAK");
    expect(result?.oidcClientSecretSet).toBe(true);
  });

  it("handleGetSsoConnection requires security_settings:Read", async () => {
    const { handleGetSsoConnection } = await import("./sso-admin-routes.js");
    await expect(handleGetSsoConnection(noAccessSession)).rejects.toThrow(ForbiddenModuleError);
  });

  it("handleUpsertSsoConnection requires security_settings:Write (Read is insufficient)", async () => {
    const { handleUpsertSsoConnection } = await import("./sso-admin-routes.js");
    await expect(handleUpsertSsoConnection(readOnlySession, {} as never)).rejects.toThrow(ForbiddenModuleError);
    expect(upsertConnectionMock).not.toHaveBeenCalled();
  });

  it("handleUpsertSsoConnection delegates to upsertConnection for a Write caller", async () => {
    upsertConnectionMock.mockResolvedValue("new-id");
    const { handleUpsertSsoConnection } = await import("./sso-admin-routes.js");
    const input = { protocol: "Oidc", displayName: "IdP" } as never;
    const result = await handleUpsertSsoConnection(writeSession, input);
    expect(upsertConnectionMock).toHaveBeenCalledWith({ tenantId: "t1", region: "US", environment: "Production" }, input);
    expect(result).toBe("new-id");
  });

  it("handleSetSsoConnectionStatus requires Write and delegates", async () => {
    const { handleSetSsoConnectionStatus } = await import("./sso-admin-routes.js");
    await expect(handleSetSsoConnectionStatus(readOnlySession, { status: "Active" })).rejects.toThrow(ForbiddenModuleError);
    await handleSetSsoConnectionStatus(writeSession, { status: "Active" });
    expect(setConnectionStatusMock).toHaveBeenCalledWith({ tenantId: "t1", region: "US", environment: "Production" }, "Active");
  });

  it("group-mapping handlers require the correct RBAC level and delegate", async () => {
    const { handleListSsoGroupMappings, handleUpsertSsoGroupMapping, handleDeleteSsoGroupMapping } = await import("./sso-admin-routes.js");
    await expect(handleListSsoGroupMappings(noAccessSession)).rejects.toThrow(ForbiddenModuleError);
    await handleListSsoGroupMappings(readOnlySession);
    expect(listSsoGroupMappingsMock).toHaveBeenCalled();

    await expect(handleUpsertSsoGroupMapping(readOnlySession, { externalGroup: "g", roleId: "r" })).rejects.toThrow(ForbiddenModuleError);
    await handleUpsertSsoGroupMapping(writeSession, { externalGroup: "g", roleId: "r" });
    expect(upsertSsoGroupMappingMock).toHaveBeenCalledWith({ tenantId: "t1", region: "US", environment: "Production" }, "g", "r");

    await handleDeleteSsoGroupMapping(writeSession, "m1");
    expect(deleteSsoGroupMappingMock).toHaveBeenCalledWith({ tenantId: "t1", region: "US", environment: "Production" }, "m1");
  });
});
