import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Unit-level test for `discoverTools` (mocking the connector repository, credential
 * repository, and `@nextbot/mcp-client`'s `listTools`) — the connector's stored
 * `endpoint_url` must be `https://` per the DB CHECK constraint (FR-SEC-02), which
 * makes exercising this against a real local mock MCP server (necessarily `http://`)
 * awkward at the integration layer. The credential-decryption *security* boundary
 * (gateway-role-only ciphertext SELECT) is proven separately by
 * `credential-db-grant.int.test.ts`; this file proves the discovery orchestration
 * logic itself.
 */

const findConnectorById = vi.fn();
const getCredentialForDecrypt = vi.fn();
const markDiscovered = vi.fn();
const listTools = vi.fn();

vi.mock("../infrastructure/connector-repository.js", () => ({
  findConnectorById: (...args: unknown[]) => findConnectorById(...args),
  markDiscovered: (...args: unknown[]) => markDiscovered(...args),
}));
vi.mock("../infrastructure/credential-repository.js", () => ({
  getCredentialForDecrypt: (...args: unknown[]) => getCredentialForDecrypt(...args),
}));
vi.mock("@nextbot/mcp-client", () => ({
  listTools: (...args: unknown[]) => listTools(...args),
}));
vi.mock("@nextbot/secrets", () => ({
  KmsEnvelopeSecretsProvider: class {
    async get() {
      return "decrypted-plaintext-token";
    }
  },
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

describe("discoverTools (unit, mocked boundaries)", () => {
  beforeEach(() => {
    findConnectorById.mockReset();
    getCredentialForDecrypt.mockReset();
    markDiscovered.mockReset();
    listTools.mockReset();
  });

  it("calls listTools with no auth header when the connector has no credential", async () => {
    findConnectorById.mockResolvedValue({ id: "c1", credentialId: null, endpointUrl: "https://example.com/mcp" });
    listTools.mockResolvedValue([{ name: "get_x", inputSchema: {} }]);

    const { discoverTools } = await import("./discover-tools.js");
    const result = await discoverTools(ctx, "c1");

    expect(result).toEqual([{ name: "get_x", inputSchema: {} }]);
    expect(listTools).toHaveBeenCalledWith({ endpointUrl: "https://example.com/mcp", headers: {} });
    expect(markDiscovered).toHaveBeenCalledWith(ctx, "c1");
  });

  it("decrypts the credential and forwards it as a Bearer authorization header", async () => {
    findConnectorById.mockResolvedValue({ id: "c2", credentialId: "cred-1", endpointUrl: "https://example.com/mcp" });
    getCredentialForDecrypt.mockResolvedValue({ ciphertext: "abc", dekRef: "def" });
    listTools.mockResolvedValue([]);

    const { discoverTools } = await import("./discover-tools.js");
    await discoverTools(ctx, "c2");

    expect(listTools).toHaveBeenCalledWith({
      endpointUrl: "https://example.com/mcp",
      headers: { authorization: "Bearer decrypted-plaintext-token" },
    });
  });

  it("throws ConnectorNotFoundError for an unknown connector id", async () => {
    findConnectorById.mockResolvedValue(null);
    const { discoverTools } = await import("./discover-tools.js");
    const { ConnectorNotFoundError } = await import("@nextbot/contracts");
    await expect(discoverTools(ctx, "missing")).rejects.toThrow(ConnectorNotFoundError);
  });
});
