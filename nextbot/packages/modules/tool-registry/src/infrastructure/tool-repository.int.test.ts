import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createConnector } from "@nextbot/connectors";
import {
  findToolByName,
  listTools,
  setToolCapabilityGroup,
  setToolPriorityWeight,
  setToolVisibility,
  upsertToolFromDiscovery,
} from "./tool-repository.js";
import { createCapabilityGroup } from "./capability-group-repository.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

async function makeConnector(ctx: Awaited<ReturnType<typeof createFixtureTenant>>) {
  return createConnector(ctx, {
    name: "Repo Test Connector",
    backendType: "Ticketing",
    transport: "StreamableHTTP",
    endpointUrl: "https://ticketing.example.com/mcp",
    authMethod: "None",
    environment: "Sandbox",
  });
}

describe("upsertToolFromDiscovery (FR-MCP-02/15, real Postgres)", () => {
  it("re-discovering an unchanged tool is a no-op (created=false, breakingChange=false)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await makeConnector(ctx);
    const input = {
      connectorId: connector.id,
      name: "get_ticket",
      descriptionSource: "Fetch a ticket",
      rwClass: "Read" as const,
      approvalTier: "Tier1" as const,
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      outputSchema: { type: "object" },
    };

    const first = await upsertToolFromDiscovery(ctx, input);
    expect(first.created).toBe(true);

    const second = await upsertToolFromDiscovery(ctx, input);
    expect(second).toEqual({ toolId: first.toolId, created: false, breakingChange: false });
  });

  it("appends a new non-breaking schema version when a property is added (not removed/narrowed)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await makeConnector(ctx);
    const base = {
      connectorId: connector.id,
      name: "get_ticket",
      descriptionSource: "Fetch a ticket",
      rwClass: "Read" as const,
      approvalTier: "Tier1" as const,
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      outputSchema: { type: "object" },
    };
    const first = await upsertToolFromDiscovery(ctx, base);

    const withNewOptionalProp = {
      ...base,
      inputSchema: { type: "object", properties: { id: { type: "string" }, verbose: { type: "boolean" } }, required: ["id"] },
    };
    const second = await upsertToolFromDiscovery(ctx, withNewOptionalProp);
    expect(second).toEqual({ toolId: first.toolId, created: false, breakingChange: false });
  });

  it("flags breaking=true when a required property is added or an existing property is removed", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await makeConnector(ctx);
    const base = {
      connectorId: connector.id,
      name: "get_ticket",
      descriptionSource: "Fetch a ticket",
      rwClass: "Read" as const,
      approvalTier: "Tier1" as const,
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      outputSchema: { type: "object" },
    };
    await upsertToolFromDiscovery(ctx, base);

    const removedProperty = { ...base, inputSchema: { type: "object", properties: {}, required: [] } };
    const result = await upsertToolFromDiscovery(ctx, removedProperty);
    expect(result.breakingChange).toBe(true);

    const found = await findToolByName(ctx, connector.id, "get_ticket");
    expect(found).not.toBeNull();
  });
});

describe("setToolVisibility / setToolPriorityWeight / setToolCapabilityGroup (real Postgres)", () => {
  it("updates each field independently", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await makeConnector(ctx);
    const { toolId } = await upsertToolFromDiscovery(ctx, {
      connectorId: connector.id,
      name: "create_ticket",
      descriptionSource: "Create a ticket",
      rwClass: "Write",
      approvalTier: "Tier1",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
    });
    const groupId = await createCapabilityGroup(ctx, { name: "Support Ops" });

    await setToolVisibility(ctx, toolId, false);
    await setToolPriorityWeight(ctx, toolId, 90);
    await setToolCapabilityGroup(ctx, toolId, groupId);

    const found = await findToolByName(ctx, connector.id, "create_ticket");
    expect(found).toMatchObject({ visibleToAgent: false, priorityWeight: 90, capabilityGroupId: groupId });

    await setToolCapabilityGroup(ctx, toolId, null);
    const cleared = await findToolByName(ctx, connector.id, "create_ticket");
    expect(cleared?.capabilityGroupId).toBeNull();
  });
});

describe("listTools ordering (QA Defect U13 — stable row order across reloads)", () => {
  it("returns tools in a stable (creation) order, unaffected by an inline edit", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await makeConnector(ctx);

    const names = ["alpha_tool", "beta_tool", "gamma_tool"];
    for (const name of names) {
      await upsertToolFromDiscovery(ctx, {
        connectorId: connector.id,
        name,
        descriptionSource: "test",
        rwClass: "Read",
        approvalTier: "Tier1",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
      });
    }

    const before = await listTools(ctx, { connectorId: connector.id });
    expect(before.map((t) => t.name)).toEqual(names);

    // Editing (e.g. toggling visibility on) a middle row must not reshuffle order.
    await setToolVisibility(ctx, before[1]!.id, false);

    const after = await listTools(ctx, { connectorId: connector.id });
    expect(after.map((t) => t.name)).toEqual(names);
  });
});
