import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { KmsEnvelopeSecretsProvider } from "@nextbot/secrets";
import { createConnector } from "./create-connector.js";
import { getCredentialForDecrypt } from "../infrastructure/credential-repository.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

/**
 * Exercises the real credential round trip `discoverTools` depends on (real
 * Postgres, real envelope encryption) — vaulting at `createConnector` time and
 * decrypting via the gateway-role-only `getCredentialForDecrypt` path. The
 * MCP-transport half of `discoverTools` is covered at the unit level
 * (`discover-tools.test.ts`, mocked boundaries) and the mcp-client package's own
 * integration tests (`packages/mcp-client/src/application/*.int.test.ts`) against a
 * real HTTP mock server — this test's job is specifically the vault round trip
 * `discoverTools` composes those two things around.
 */
describe("connector credential vault round trip (real Postgres, real envelope crypto)", () => {
  it("decrypts back to the exact plaintext supplied at connector creation time", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const connector = await createConnector(ctx, {
      name: "Vault Round Trip Connector",
      backendType: "CRM",
      transport: "StreamableHTTP",
      endpointUrl: "https://crm.example.com/mcp",
      authMethod: "APIKey",
      credentialPlaintext: "the-real-plaintext-api-key",
      environment: "Sandbox",
    });

    const stored = await getCredentialForDecrypt(ctx, connector.credentialId!);
    expect(stored).not.toBeNull();

    const provider = new KmsEnvelopeSecretsProvider();
    const plaintext = await provider.get(stored!.ciphertext, stored!.dekRef, {
      tenantId: ctx.tenantId,
      kind: "connector-credential",
      id: connector.credentialId!,
    });
    expect(plaintext).toBe("the-real-plaintext-api-key");
  });
});
