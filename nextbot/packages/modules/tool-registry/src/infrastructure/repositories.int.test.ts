import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createConnector } from "@nextbot/connectors";
import type * as ConnectorsModule from "@nextbot/connectors";
import { createCapabilityGroup, listCapabilityGroups } from "./capability-group-repository.js";
import { listAllRules, listToolScopedRules, replaceRulesForTool } from "./permission-rule-repository.js";

const discoverToolsMock = vi.fn();
vi.mock("@nextbot/connectors", async (importOriginal) => {
  const actual = await importOriginal<typeof ConnectorsModule>();
  return { ...actual, discoverTools: (...args: unknown[]) => discoverToolsMock(...args) };
});

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  discoverToolsMock.mockReset();
});

describe("capability-group-repository (real Postgres)", () => {
  it("creates and lists capability groups for a tenant", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const id = await createCapabilityGroup(ctx, { name: "Billing Ops", guidanceText: "Use for billing tasks", priorityWeight: 70 });
    const groups = await listCapabilityGroups(ctx);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id, name: "Billing Ops", guidanceText: "Use for billing tasks", priorityWeight: 70 });
  });

  it("defaults priorityWeight to 50 and guidanceText to null when omitted", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    await createCapabilityGroup(ctx, { name: "Default Group" });
    const [group] = await listCapabilityGroups(ctx);
    expect(group).toMatchObject({ priorityWeight: 50, guidanceText: null });
  });
});

describe("permission-rule-repository (real Postgres)", () => {
  it("replaceRulesForTool overwrites the tool-scoped rule set (delete-then-insert)", async () => {
    discoverToolsMock.mockResolvedValue([{ name: "delete_invoice", inputSchema: { type: "object" } }]);
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await createConnector(ctx, {
      name: "Billing Connector",
      backendType: "Billing",
      transport: "StreamableHTTP",
      endpointUrl: "https://billing.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });
    const { discoverAndSyncTools, listCatalog } = await import("../application/catalog-service.js");
    await discoverAndSyncTools(ctx, connector.id);
    const [tool] = await listCatalog(ctx, { connectorId: connector.id });

    await replaceRulesForTool(ctx, tool!.id, [
      { ordinal: 0, conditions: {}, effect: "RequireApproval", requiredTier: "Tier3" },
    ]);
    let rules = await listToolScopedRules(ctx, tool!.id);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ effect: "RequireApproval", requiredTier: "Tier3" });

    // Replacing again removes the prior rule set entirely (not appended).
    await replaceRulesForTool(ctx, tool!.id, [{ ordinal: 0, conditions: {}, effect: "Deny" }]);
    rules = await listToolScopedRules(ctx, tool!.id);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ effect: "Deny", requiredTier: null });
  });

  it("listAllRules includes both the tool-scoped rule and the seeded BackendType-scope rule", async () => {
    discoverToolsMock.mockResolvedValue([{ name: "get_ticket", inputSchema: { type: "object" } }]);
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await createConnector(ctx, {
      name: "Ticketing Connector",
      backendType: "Ticketing",
      transport: "StreamableHTTP",
      endpointUrl: "https://ticketing.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });
    const { discoverAndSyncTools, listCatalog } = await import("../application/catalog-service.js");
    await discoverAndSyncTools(ctx, connector.id);
    const [tool] = await listCatalog(ctx, { connectorId: connector.id });

    await replaceRulesForTool(ctx, tool!.id, [{ ordinal: 0, conditions: {}, effect: "Deny" }]);
    const all = await listAllRules(ctx);
    expect(all.some((r) => r.scope === "Tool" && r.toolId === tool!.id)).toBe(true);
    expect(all.some((r) => r.scope === "BackendType" && r.backendType === "Ticketing")).toBe(true);
  });
});
