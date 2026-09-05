import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createConnector } from "@nextbot/connectors";
import type * as ConnectorsModule from "@nextbot/connectors";
import { PermissionRuleInvalidError, ToolNotFoundError } from "@nextbot/contracts";
import { getToolRules, updateToolRules } from "./permission-service.js";

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

describe("permission-service getToolRules/updateToolRules (real Postgres)", () => {
  it("updateToolRules throws ToolNotFoundError for an unknown tool id", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await expect(updateToolRules(ctx, crypto.randomUUID(), [])).rejects.toThrow(ToolNotFoundError);
  });

  it("updateToolRules persists a rule set that getToolRules then returns", async () => {
    discoverToolsMock.mockResolvedValue([{ name: "get_ticket", inputSchema: { type: "object" } }]);
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await createConnector(ctx, {
      name: "Perm Service Connector",
      backendType: "Ticketing",
      transport: "StreamableHTTP",
      endpointUrl: "https://ticketing.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });
    const { discoverAndSyncTools, listCatalog } = await import("./catalog-service.js");
    await discoverAndSyncTools(ctx, connector.id);
    const [tool] = await listCatalog(ctx, { connectorId: connector.id });

    await updateToolRules(ctx, tool!.id, [
      { scope: "Tool", ordinal: 0, conditions: {}, effect: "Allow" },
    ]);
    const rules = await getToolRules(ctx, tool!.id);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ effect: "Allow", scope: "Tool" });
  });

  // QA Final Review minor item: an invalid rule combination (here, `requiredTier`
  // set on a non-`RequireApproval` effect) previously hit
  // `tool_permission_rule_required_tier_only_when_require_approval`'s raw DB
  // CHECK-constraint violation and surfaced as an opaque 500 — it's now caught
  // and mapped to the proper 422 `PermissionRuleInvalidError`.
  it("updateToolRules throws PermissionRuleInvalidError (not a raw DB 500) for an invalid effect/requiredTier combination", async () => {
    discoverToolsMock.mockResolvedValue([{ name: "get_lead", inputSchema: { type: "object" } }]);
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await createConnector(ctx, {
      name: "Invalid Rule Connector",
      backendType: "CRM",
      transport: "StreamableHTTP",
      endpointUrl: "https://crm.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });
    const { discoverAndSyncTools, listCatalog } = await import("./catalog-service.js");
    await discoverAndSyncTools(ctx, connector.id);
    const [tool] = await listCatalog(ctx, { connectorId: connector.id });

    await expect(
      updateToolRules(ctx, tool!.id, [
        // Invalid: `effect: "Allow"` must NOT carry a `requiredTier` (the DB
        // CHECK constraint only allows `requiredTier` when `effect ===
        // "RequireApproval"`).
        { scope: "Tool", ordinal: 0, conditions: {}, effect: "Allow", requiredTier: "Tier3" },
      ]),
    ).rejects.toThrow(PermissionRuleInvalidError);
  });
});
