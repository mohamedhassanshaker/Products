import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { withTenant, schema } from "@nextbot/db";
import { eq } from "drizzle-orm";
import { createConnector } from "./create-connector.js";

/** ADR-0001 §6 cross-tenant proof for `connector`/`credential` (Phase 4). */
describe("connector/credential tenant isolation (ADR-0001 §6 / LLD §3.2)", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("a tenant scoped to A reads zero rows of B's connector (incl. by direct id lookup)", async () => {
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);

    const bConnector = await createConnector(b, {
      name: "B's Connector",
      backendType: "CRM",
      transport: "StreamableHTTP",
      endpointUrl: "https://crm.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });

    const rowsSeenByA = await withTenant(a, (db) => db.select().from(schema.connector).where(eq(schema.connector.id, bConnector.id)));
    expect(rowsSeenByA).toHaveLength(0);
  });

  it("a tenant scoped to A reads zero rows of B's credential ciphertext row (via the gateway-role path)", async () => {
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);

    const bConnector = await createConnector(b, {
      name: "B's Ticketing Connector",
      backendType: "Ticketing",
      transport: "StreamableHTTP",
      endpointUrl: "https://ticketing.example.com/mcp",
      authMethod: "APIKey",
      credentialPlaintext: "b-secret-value",
      environment: "Sandbox",
    });

    const { withGatewayTenant } = await import("@nextbot/db");
    const rowsSeenByA = await withGatewayTenant(a, (db) =>
      db.select().from(schema.credential).where(eq(schema.credential.id, bConnector.credentialId!)),
    );
    expect(rowsSeenByA).toHaveLength(0);
  });
});
