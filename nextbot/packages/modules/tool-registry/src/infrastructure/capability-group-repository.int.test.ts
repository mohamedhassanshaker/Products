import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createConnector } from "@nextbot/connectors";
import { CapabilityGroupNameDuplicateError } from "@nextbot/contracts";
import {
  createCapabilityGroup,
  listCapabilityGroups,
  listCapabilityGroupsWithToolCounts,
  updateCapabilityGroup,
  deleteCapabilityGroup,
  countToolsInCapabilityGroup,
} from "./capability-group-repository.js";
import { setToolCapabilityGroup, upsertToolFromDiscovery, findToolById } from "./tool-repository.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

async function makeConnector(ctx: Awaited<ReturnType<typeof createFixtureTenant>>) {
  return createConnector(ctx, {
    name: "Capability Group Test Connector",
    backendType: "Ticketing",
    transport: "StreamableHTTP",
    endpointUrl: "https://ticketing.example.com/mcp",
    authMethod: "None",
    environment: "Sandbox",
  });
}

/**
 * Phase 10 (client-feedback-batch item 8) — real, DB-backed proof that the
 * capability-groups picker's data source is genuinely tenant-scoped (never a
 * cross-tenant leak) and that its tool-member count is accurate, since both are
 * explicit acceptance criteria for the new admin-console picker.
 */
describe("listCapabilityGroupsWithToolCounts / listCapabilityGroups (Phase 10, real Postgres)", () => {
  it("never returns another tenant's capability groups — real cross-tenant isolation, not a mocked check", async () => {
    const tenantA = await createFixtureTenant();
    createdTenantIds.push(tenantA.tenantId);
    const tenantB = await createFixtureTenant();
    createdTenantIds.push(tenantB.tenantId);

    await createCapabilityGroup(tenantA, { name: "billing" });
    await createCapabilityGroup(tenantB, { name: "order-lookup" });

    const groupsForA = await listCapabilityGroupsWithToolCounts(tenantA);
    expect(groupsForA.map((g) => g.name)).toEqual(["billing"]);

    const groupsForB = await listCapabilityGroupsWithToolCounts(tenantB);
    expect(groupsForB.map((g) => g.name)).toEqual(["order-lookup"]);

    // Same isolation guarantee on the pre-existing (no-count) list function this
    // phase reused rather than replaced.
    expect((await listCapabilityGroups(tenantA)).map((g) => g.name)).toEqual(["billing"]);
  });

  it("reports an accurate live tool count per group, including zero for a group with no tools assigned yet", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await makeConnector(ctx);

    const billingGroupId = await createCapabilityGroup(ctx, { name: "billing" });
    await createCapabilityGroup(ctx, { name: "empty-group" });

    const tool1 = await upsertToolFromDiscovery(ctx, {
      connectorId: connector.id,
      name: "refund_order",
      descriptionSource: "Refund an order",
      rwClass: "Write",
      approvalTier: "Tier2",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
    });
    const tool2 = await upsertToolFromDiscovery(ctx, {
      connectorId: connector.id,
      name: "get_invoice",
      descriptionSource: "Fetch an invoice",
      rwClass: "Read",
      approvalTier: "Tier1",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
    });
    await setToolCapabilityGroup(ctx, tool1.toolId, billingGroupId);
    await setToolCapabilityGroup(ctx, tool2.toolId, billingGroupId);

    const groups = await listCapabilityGroupsWithToolCounts(ctx);
    const billing = groups.find((g) => g.name === "billing");
    const empty = groups.find((g) => g.name === "empty-group");
    expect(billing?.toolCount).toBe(2);
    expect(empty?.toolCount).toBe(0);
  });
});

/**
 * Phase 6 (BL-28, FR-MCP-17) — the capability-group management screen's CRUD path,
 * proven against a real database. The dispatch's explicit verification target: after
 * a group with tools assigned is deleted, its member tools' `capability_group_id`
 * reflects `NULL` — never a cascade delete of the tools themselves.
 */
describe("updateCapabilityGroup / deleteCapabilityGroup (Phase 6, real Postgres)", () => {
  it("renames a group and rejects renaming it to collide with another existing group's name", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const groupAId = await createCapabilityGroup(ctx, { name: "billing" });
    await createCapabilityGroup(ctx, { name: "shipping" });

    await updateCapabilityGroup(ctx, groupAId, { name: "billing-renamed", priorityWeight: 80 });
    const afterRename = await listCapabilityGroups(ctx);
    expect(afterRename.find((g) => g.id === groupAId)).toMatchObject({ name: "billing-renamed", priorityWeight: 80 });

    await expect(updateCapabilityGroup(ctx, groupAId, { name: "shipping" })).rejects.toBeInstanceOf(CapabilityGroupNameDuplicateError);
  });

  it("rejects creating a second group with a name that collides with an existing one", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await createCapabilityGroup(ctx, { name: "billing" });
    await expect(createCapabilityGroup(ctx, { name: "billing" })).rejects.toBeInstanceOf(CapabilityGroupNameDuplicateError);
  });

  it("deleting a group reassigns its member tools to Ungrouped (capability_group_id = NULL) rather than deleting or disabling the tools themselves", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await makeConnector(ctx);
    const groupId = await createCapabilityGroup(ctx, { name: "billing" });

    const tool1 = await upsertToolFromDiscovery(ctx, {
      connectorId: connector.id,
      name: "refund_order",
      descriptionSource: "Refund an order",
      rwClass: "Write",
      approvalTier: "Tier2",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
    });
    const tool2 = await upsertToolFromDiscovery(ctx, {
      connectorId: connector.id,
      name: "get_invoice",
      descriptionSource: "Fetch an invoice",
      rwClass: "Read",
      approvalTier: "Tier1",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
    });
    await setToolCapabilityGroup(ctx, tool1.toolId, groupId);
    await setToolCapabilityGroup(ctx, tool2.toolId, groupId);

    expect(await countToolsInCapabilityGroup(ctx, groupId)).toBe(2);

    const { reassignedToolCount } = await deleteCapabilityGroup(ctx, groupId);
    expect(reassignedToolCount).toBe(2);

    // The group itself is gone from the (non-deleted) listing...
    const groupsAfter = await listCapabilityGroups(ctx);
    expect(groupsAfter.find((g) => g.id === groupId)).toBeUndefined();

    // ...but both tools still exist, are not disabled, and now read Ungrouped
    // (capability_group_id IS NULL) — never cascade-deleted.
    const tool1After = await findToolById(ctx, tool1.toolId);
    const tool2After = await findToolById(ctx, tool2.toolId);
    expect(tool1After).toMatchObject({ id: tool1.toolId, status: "Active", capabilityGroupId: null });
    expect(tool2After).toMatchObject({ id: tool2.toolId, status: "Active", capabilityGroupId: null });
  });

  it("deleting a group with zero tools assigned is a safe no-op reassignment (reassignedToolCount: 0)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const groupId = await createCapabilityGroup(ctx, { name: "empty-group" });
    expect(await countToolsInCapabilityGroup(ctx, groupId)).toBe(0);
    const { reassignedToolCount } = await deleteCapabilityGroup(ctx, groupId);
    expect(reassignedToolCount).toBe(0);
  });
});
