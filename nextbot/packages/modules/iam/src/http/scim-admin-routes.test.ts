import { describe, expect, it, vi, beforeEach } from "vitest";
import { ForbiddenModuleError } from "@nextbot/contracts";

const hasActiveScimTokenMock = vi.fn();
const rotateScimTokenMock = vi.fn();
const revokeScimTokenMock = vi.fn();
const resolveTenantByIdMock = vi.fn();

vi.mock("../application/scim-token.js", () => ({
  hasActiveScimToken: (...a: unknown[]) => hasActiveScimTokenMock(...a),
  rotateScimToken: (...a: unknown[]) => rotateScimTokenMock(...a),
  revokeScimToken: (...a: unknown[]) => revokeScimTokenMock(...a),
}));
vi.mock("@nextbot/tenancy", () => ({
  resolveTenantById: (...a: unknown[]) => resolveTenantByIdMock(...a),
}));

const writeSession = { tenantId: "t1", userId: "u1", roleIds: ["r1"], permissions: { security_settings: "Write" } as never };
const readOnlySession = { tenantId: "t1", userId: "u1", roleIds: ["r1"], permissions: { security_settings: "Read" } as never };

describe("iam http/scim-admin-routes (unit, mocked application layer)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantByIdMock.mockResolvedValue({ id: "t1", region: "US" });
  });

  it("handleGetScimTokenStatus requires Read and reports active status", async () => {
    hasActiveScimTokenMock.mockResolvedValue(true);
    const { handleGetScimTokenStatus } = await import("./scim-admin-routes.js");
    const result = await handleGetScimTokenStatus(readOnlySession);
    expect(result).toEqual({ active: true });
  });

  it("handleRotateScimToken/handleRevokeScimToken require Write (Read insufficient)", async () => {
    rotateScimTokenMock.mockResolvedValue("scim_plaintext-token");
    const { handleRotateScimToken, handleRevokeScimToken } = await import("./scim-admin-routes.js");
    await expect(handleRotateScimToken(readOnlySession)).rejects.toThrow(ForbiddenModuleError);
    const result = await handleRotateScimToken(writeSession);
    expect(result).toEqual({ token: "scim_plaintext-token" });

    await expect(handleRevokeScimToken(readOnlySession)).rejects.toThrow(ForbiddenModuleError);
    await handleRevokeScimToken(writeSession);
    expect(revokeScimTokenMock).toHaveBeenCalledWith({ tenantId: "t1", region: "US", environment: "Production" });
  });
});
