import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit coverage for `apps/web`'s admin-side `EgressPort` implementation (previously
 * untested). QA fix BE2 added the shared circuit-breaker check here — these tests
 * cover the breaker-open short-circuit, the credential-injection branch, and both
 * the success/failure outcomes, all with fakes (no real DB/HTTP), per this dispatch's
 * unit-tier convention.
 */

const isBreakerOpenMock = vi.fn();
const recordBreakerOutcomeMock = vi.fn();
const callToolMock = vi.fn();
vi.mock("@nextbot/mcp-client", () => ({
  isBreakerOpen: (...a: unknown[]) => isBreakerOpenMock(...a),
  recordBreakerOutcome: (...a: unknown[]) => recordBreakerOutcomeMock(...a),
  callTool: (...a: unknown[]) => callToolMock(...a),
}));

const findConnectorByIdMock = vi.fn();
const getCredentialForDecryptMock = vi.fn();
vi.mock("@nextbot/connectors", () => ({
  findConnectorById: (...a: unknown[]) => findConnectorByIdMock(...a),
  getCredentialForDecrypt: (...a: unknown[]) => getCredentialForDecryptMock(...a),
}));

const findToolByIdMock = vi.fn();
const findCurrentSchemaVersionMock = vi.fn();
vi.mock("@nextbot/tool-registry", () => ({
  findToolById: (...a: unknown[]) => findToolByIdMock(...a),
  findCurrentSchemaVersion: (...a: unknown[]) => findCurrentSchemaVersionMock(...a),
}));

const secretsGetMock = vi.fn();
vi.mock("@nextbot/secrets", () => ({
  KmsEnvelopeSecretsProvider: class {
    get = secretsGetMock;
  },
}));

const checkToolCallRateMock = vi.fn();
vi.mock("@nextbot/tenancy", () => ({
  checkToolCallRate: (...a: unknown[]) => checkToolCallRateMock(...a),
}));

const CTX = { tenantId: "tenant-1" } as never;
const BASE_INVOCATION = {
  toolCallId: "tc-1",
  tenantId: "tenant-1",
  toolId: "tool-1",
  connectorId: "conn-1",
  toolName: "get_order",
  args: {},
  idempotencyKey: "idem-1",
};

describe("createAdminMcpEgressPort (apps/web, QA fix BE2)", () => {
  beforeEach(() => {
    isBreakerOpenMock.mockReset().mockReturnValue(false);
    recordBreakerOutcomeMock.mockReset();
    callToolMock.mockReset();
    findConnectorByIdMock.mockReset();
    getCredentialForDecryptMock.mockReset();
    findToolByIdMock.mockReset();
    findCurrentSchemaVersionMock.mockReset();
    secretsGetMock.mockReset();
    checkToolCallRateMock.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.resetModules());

  it("returns Denied without calling out when the shared breaker is open (BE2)", async () => {
    isBreakerOpenMock.mockReturnValue(true);
    const { createAdminMcpEgressPort } = await import("./mcp-egress.js");
    const result = await createAdminMcpEgressPort(CTX).invokeTool(BASE_INVOCATION);
    expect(result).toEqual({ outcome: "Denied", reason: "circuit_open" });
    expect(callToolMock).not.toHaveBeenCalled();
  });

  it("fails with Failed when the tool or connector no longer exists", async () => {
    findToolByIdMock.mockResolvedValue(null);
    findConnectorByIdMock.mockResolvedValue({ id: "conn-1" });
    const { createAdminMcpEgressPort } = await import("./mcp-egress.js");
    const result = await createAdminMcpEgressPort(CTX).invokeTool(BASE_INVOCATION);
    expect(result).toEqual({ outcome: "Failed", errorMessage: "tool or connector no longer exists" });
  });

  it("fails with Failed when no schema version has been discovered", async () => {
    findToolByIdMock.mockResolvedValue({ id: "tool-1" });
    findConnectorByIdMock.mockResolvedValue({ id: "conn-1", credentialId: null, endpointUrl: "https://x.example.com" });
    findCurrentSchemaVersionMock.mockResolvedValue(null);
    const { createAdminMcpEgressPort } = await import("./mcp-egress.js");
    const result = await createAdminMcpEgressPort(CTX).invokeTool(BASE_INVOCATION);
    expect(result).toEqual({ outcome: "Failed", errorMessage: "tool has no discovered schema" });
  });

  it("injects a decrypted credential as a Bearer header when the connector has one", async () => {
    findToolByIdMock.mockResolvedValue({ id: "tool-1" });
    findConnectorByIdMock.mockResolvedValue({ id: "conn-1", credentialId: "cred-1", endpointUrl: "https://x.example.com" });
    findCurrentSchemaVersionMock.mockResolvedValue({ inputSchema: {}, outputSchema: {} });
    getCredentialForDecryptMock.mockResolvedValue({ ciphertext: "enc", dekRef: "dek-1" });
    secretsGetMock.mockResolvedValue("plaintext-secret");
    callToolMock.mockResolvedValue({ ok: true });

    const { createAdminMcpEgressPort } = await import("./mcp-egress.js");
    const result = await createAdminMcpEgressPort(CTX).invokeTool(BASE_INVOCATION);

    expect(result).toEqual({ outcome: "Succeeded", output: { ok: true } });
    expect(callToolMock).toHaveBeenCalledWith(
      "get_order",
      {},
      { inputSchema: {}, outputSchema: {} },
      { endpointUrl: "https://x.example.com", headers: { authorization: "Bearer plaintext-secret" } },
    );
    expect(recordBreakerOutcomeMock).toHaveBeenCalledWith("tenant-1", "tool-1", true);
  });

  it("records a breaker failure and returns Failed (without leaking the raw error) when callTool throws", async () => {
    findToolByIdMock.mockResolvedValue({ id: "tool-1" });
    findConnectorByIdMock.mockResolvedValue({ id: "conn-1", credentialId: null, endpointUrl: "https://x.example.com" });
    findCurrentSchemaVersionMock.mockResolvedValue({ inputSchema: {}, outputSchema: {} });
    callToolMock.mockRejectedValue(new Error("upstream 503"));

    const { createAdminMcpEgressPort } = await import("./mcp-egress.js");
    const result = await createAdminMcpEgressPort(CTX).invokeTool(BASE_INVOCATION);

    expect(result).toEqual({ outcome: "Failed", errorMessage: "upstream 503" });
    expect(recordBreakerOutcomeMock).toHaveBeenCalledWith("tenant-1", "tool-1", false);
  });
});
