import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createConnector } from "../application/create-connector.js";
import { findConnectorById, listConnectors, markDiscovered } from "./connector-repository.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

describe("connector-repository listConnectors/markDiscovered (real Postgres)", () => {
  it("listConnectors returns every connector for the tenant", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await createConnector(ctx, {
      name: "Connector A",
      backendType: "CRM",
      transport: "StreamableHTTP",
      endpointUrl: "https://a.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });
    await createConnector(ctx, {
      name: "Connector B",
      backendType: "ERP",
      transport: "StreamableHTTP",
      endpointUrl: "https://b.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });

    const all = await listConnectors(ctx);
    expect(all.map((c) => c.name).sort()).toEqual(["Connector A", "Connector B"]);
  });

  it("markDiscovered stamps lastDiscoveredAt", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await createConnector(ctx, {
      name: "Discoverable Connector",
      backendType: "CRM",
      transport: "StreamableHTTP",
      endpointUrl: "https://c.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });
    expect((await findConnectorById(ctx, connector.id))?.lastDiscoveredAt).toBeNull();

    await markDiscovered(ctx, connector.id);
    const after = await findConnectorById(ctx, connector.id);
    expect(after?.lastDiscoveredAt).not.toBeNull();
  });
});
