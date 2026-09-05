import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { ConnectorNameDuplicateError, CredentialRequiredError } from "@nextbot/contracts";
import { createConnector } from "./create-connector.js";
import { getCredentialMasked } from "../infrastructure/credential-repository.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

describe("createConnector (BL-02 backend slice, real Postgres)", () => {
  it("creates a connector with no credential when authMethod = None", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const connector = await createConnector(ctx, {
      name: "Public KB",
      backendType: "KnowledgeBase",
      transport: "StreamableHTTP",
      endpointUrl: "https://kb.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });

    expect(connector.credentialId).toBeNull();
    expect(connector.status).toBe("Offline");
  });

  it("vaults the plaintext credential — the masked projection never exposes it", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const connector = await createConnector(ctx, {
      name: "Zendesk",
      backendType: "Ticketing",
      transport: "StreamableHTTP",
      endpointUrl: "https://zendesk.example.com/mcp",
      authMethod: "APIKey",
      credentialPlaintext: "sk-super-secret-value-123",
      credentialLabel: "Zendesk API key",
      environment: "Sandbox",
    });

    expect(connector.credentialId).not.toBeNull();
    const masked = await getCredentialMasked(ctx, connector.credentialId!);
    expect(masked?.maskedHint).not.toContain("super-secret");
    expect(JSON.stringify(masked)).not.toContain("sk-super-secret-value-123");
  });

  it("rejects a duplicate (tenant, environment, name)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const input = {
      name: "Dup Connector",
      backendType: "CRM" as const,
      transport: "StreamableHTTP" as const,
      endpointUrl: "https://crm.example.com/mcp",
      authMethod: "None" as const,
      environment: "Sandbox" as const,
    };
    await createConnector(ctx, input);
    await expect(createConnector(ctx, input)).rejects.toThrow(ConnectorNameDuplicateError);
  });

  it("requires a credential when authMethod != None", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await expect(
      createConnector(ctx, {
        name: "No Cred Connector",
        backendType: "CRM",
        transport: "StreamableHTTP",
        endpointUrl: "https://crm.example.com/mcp",
        authMethod: "APIKey",
        environment: "Sandbox",
      }),
    ).rejects.toThrow(CredentialRequiredError);
  });
});
