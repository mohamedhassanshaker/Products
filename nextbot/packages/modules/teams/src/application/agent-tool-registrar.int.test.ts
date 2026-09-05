import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { schema, withTenant, type TenantContext } from "@nextbot/db";
import { createConnector } from "@nextbot/connectors";
import {
  createCapabilityGroup,
  findToolById,
  resolveToolPermission,
  updateToolRules,
  upsertToolFromDiscovery,
  setToolCapabilityGroup,
} from "@nextbot/tool-registry";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { createFixtureAgentVersion } from "../testing/team-fixtures.js";
import { agentToolName, deriveDelegationTierFloor, registerAgentAsTool, retireAgentTool } from "./agent-tool-registrar.js";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-01, LLD §14.7.1) — a
 * specialist agent version is registered as an entry in the EXISTING Tool Catalog,
 * and everything downstream of it (the permission resolver, the simulate preview,
 * the fail-closed default) works against it unchanged.
 */
let mockModel: MockOpenAiServerHandle;

async function connectedConnector(ctx: TenantContext, name: string, backendType: "Billing" | "Ticketing") {
  const connector = await createConnector(ctx, {
    name,
    backendType,
    transport: "StreamableHTTP",
    endpointUrl: `https://${backendType.toLowerCase()}.example.com/mcp`,
    authMethod: "None",
    environment: "Sandbox",
  });
  await withTenant(ctx, (db) => db.update(schema.connector).set({ status: "Connected" }).where(eq(schema.connector.id, connector.id)));
  return connector;
}

describe("agent-tool-registrar (FR-ORC-01, real Postgres)", () => {
  const createdTenantIds: string[] = [];
  beforeAll(async () => {
    mockModel = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "{}" }) });
  });
  afterAll(async () => {
    await mockModel.close();
  });
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("mints a real `tool` row named agent.<definitionName>, with the LLD §14.7.1 synthetic schema", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const specialist = await createFixtureAgentVersion(ctx, "billing_agent");

    const { tool } = await registerAgentAsTool(ctx, {
      definitionVersionId: specialist.versionId,
      definitionName: "billing_agent",
      authoredDelegationTier: "Tier1",
      description: "Delegate billing questions",
    });

    expect(tool.name).toBe(agentToolName("billing_agent"));
    expect(tool.name).toBe("agent.billing_agent");
    expect(tool.kind).toBe("AgentAsTool");
    expect(tool.connectorId).toBeNull();
    expect(tool.agentDefinitionVersionId).toBe(specialist.versionId);
    // rwClass is Write unconditionally: a delegation can cause any action inside the
    // specialist's own scope, so classifying it as a read would understate it.
    expect(tool.rwClass).toBe("Write");

    // The synthetic schema is what makes Ajv validation, the sandbox tester and the
    // trace viewer all work UNCHANGED against a delegation.
    const rows = await withTenant(ctx, (db) =>
      db.select().from(schema.toolSchemaVersion).where(eq(schema.toolSchemaVersion.toolId, tool.id)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.inputSchema).toMatchObject({ properties: { task: { type: "string" } }, required: ["task"] });
    expect(rows[0]?.outputSchema).toMatchObject({ properties: { outcome: { enum: ["answered", "not_mine", "escalate"] } } });
    // The tool's `current_schema_version_id` really points at it (the mutual-FK dance).
    expect((await findToolById(ctx, tool.id))?.id).toBe(tool.id);
  });

  it("is idempotent on the pinned specialist version — a second registration returns the SAME row", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const specialist = await createFixtureAgentVersion(ctx, "billing_agent");
    const first = await registerAgentAsTool(ctx, { definitionVersionId: specialist.versionId, definitionName: "billing_agent", authoredDelegationTier: "Tier1", description: "x" });
    const second = await registerAgentAsTool(ctx, { definitionVersionId: specialist.versionId, definitionName: "billing_agent", authoredDelegationTier: "Tier1", description: "x" });
    expect(second.tool.id).toBe(first.tool.id);
  });

  it("derives the delegation tier from the specialist's own HIGHEST-tier reachable tool, and never lower (LLD §14.7.1)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await connectedConnector(ctx, "Billing", "Billing");

    // A specialist that can reach a Tier-3 tool.
    const refund = await upsertToolFromDiscovery(ctx, {
      connectorId: connector.id,
      name: "issue_refund",
      descriptionSource: "Issues a refund",
      rwClass: "Write",
      approvalTier: "Tier3",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
    });
    expect(refund.created).toBe(true);

    const specialist = await createFixtureAgentVersion(ctx, "billing_agent");
    expect(await deriveDelegationTierFloor(ctx, specialist.versionId)).toBe("Tier3");

    // An author declaring Tier1 does NOT get a cheap delegation to a Tier-3-capable
    // specialist — the delegation is never cheaper to authorise than what it enables.
    const registration = await registerAgentAsTool(ctx, {
      definitionVersionId: specialist.versionId,
      definitionName: "billing_agent",
      authoredDelegationTier: "Tier1",
      description: "x",
    });
    expect(registration.derivedFloor).toBe("Tier3");
    expect(registration.effectiveTier).toBe("Tier3");
    expect(registration.tool.approvalTier).toBe("Tier3");
  });

  it("respects an author's STRICTER declaration — max(authored, derivedFloor), never min", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const specialist = await createFixtureAgentVersion(ctx, "faq_agent");
    // No tools at all in this tenant, so the derived floor is Tier1…
    expect(await deriveDelegationTierFloor(ctx, specialist.versionId)).toBe("Tier1");
    // …but the author asked for Tier3, and that is honoured.
    const registration = await registerAgentAsTool(ctx, { definitionVersionId: specialist.versionId, definitionName: "faq_agent", authoredDelegationTier: "Tier3", description: "x" });
    expect(registration.effectiveTier).toBe("Tier3");
  });

  it("only counts tools the specialist can ACTUALLY reach — its own capability-group restriction narrows the floor", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await connectedConnector(ctx, "Billing", "Billing");
    const refund = await upsertToolFromDiscovery(ctx, { connectorId: connector.id, name: "issue_refund", descriptionSource: "d", rwClass: "Write", approvalTier: "Tier3", inputSchema: {}, outputSchema: {} });
    const lookup = await upsertToolFromDiscovery(ctx, { connectorId: connector.id, name: "get_invoice", descriptionSource: "d", rwClass: "Read", approvalTier: "Tier1", inputSchema: {}, outputSchema: {} });

    // `createCapabilityGroup` returns the new group's id as a bare string.
    const riskyId = await createCapabilityGroup(ctx, { name: "risky" });
    const safeId = await createCapabilityGroup(ctx, { name: "safe" });
    await setToolCapabilityGroup(ctx, refund.toolId, riskyId);
    await setToolCapabilityGroup(ctx, lookup.toolId, safeId);

    // A specialist restricted to the "safe" group cannot reach the Tier-3 refund
    // tool, so its delegation floor is Tier1 — a real, checkable property, not a guess.
    const safeSpecialist = await createFixtureAgentVersion(ctx, "faq_agent", { capabilityGroups: ["safe"] });
    expect(await deriveDelegationTierFloor(ctx, safeSpecialist.versionId)).toBe("Tier1");

    const riskySpecialist = await createFixtureAgentVersion(ctx, "refund_agent", { capabilityGroups: ["risky"] });
    expect(await deriveDelegationTierFloor(ctx, riskySpecialist.versionId)).toBe("Tier3");
  });

  it("the EXISTING resolver works against an AgentAsTool unchanged: fail-closed by default, allowed by a Tool-scoped rule", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const specialist = await createFixtureAgentVersion(ctx, "billing_agent");
    const { tool } = await registerAgentAsTool(ctx, { definitionVersionId: specialist.versionId, definitionName: "billing_agent", authoredDelegationTier: "Tier1", description: "x" });

    // Registration seeds a Tool-scoped Allow rule (the same way `discoverAndSyncTools`
    // seeds a BackendType default for an MCP tool) — otherwise a brand-new team could
    // never delegate at all. It is NOT a tiering bypass: the resolved tier is the
    // tool's own derived `approval_tier`.
    expect(await resolveToolPermission(ctx, tool.id, {})).toMatchObject({ effect: "Allow", tier: "Tier1" });

    // Remove every rule and the SAME fail-closed default every MCP tool gets applies —
    // nothing about delegation opens a permissive path.
    await withTenant(ctx, (db) => db.delete(schema.toolPermissionRule).where(eq(schema.toolPermissionRule.toolId, tool.id)));
    expect(await resolveToolPermission(ctx, tool.id, {})).toMatchObject({ effect: "Deny", reason: "no_matching_rule" });

    // The ordinary per-tool permission rule engine governs it — no parallel path.
    await updateToolRules(ctx, tool.id, [{ scope: "Tool", toolId: tool.id, ordinal: 0, conditions: {}, effect: "Deny", enabled: true }]);
    expect(await resolveToolPermission(ctx, tool.id, {})).toMatchObject({ effect: "Deny", reason: "rule_deny" });
  });

  it("the resolver's Tier escalation works identically for an AgentAsTool (max of rule tier and tool tier)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const specialist = await createFixtureAgentVersion(ctx, "billing_agent");
    const { tool } = await registerAgentAsTool(ctx, { definitionVersionId: specialist.versionId, definitionName: "billing_agent", authoredDelegationTier: "Tier1", description: "x" });
    await updateToolRules(ctx, tool.id, [
      { scope: "Tool", toolId: tool.id, ordinal: 0, conditions: {}, effect: "RequireApproval", requiredTier: "Tier3", enabled: true },
    ]);
    expect(await resolveToolPermission(ctx, tool.id, {})).toMatchObject({ effect: "RequireApproval", tier: "Tier3" });
  });

  it("a DISABLED (retired) AgentAsTool is not selectable — retirement is soft, so history stays intact", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const specialist = await createFixtureAgentVersion(ctx, "billing_agent");
    const { tool } = await registerAgentAsTool(ctx, { definitionVersionId: specialist.versionId, definitionName: "billing_agent", authoredDelegationTier: "Tier1", description: "x" });
    await updateToolRules(ctx, tool.id, [{ scope: "Tool", toolId: tool.id, ordinal: 0, conditions: {}, effect: "Allow", enabled: true }]);

    await retireAgentTool(ctx, tool.id);

    const retired = await findToolById(ctx, tool.id);
    expect(retired?.status).toBe("Disabled");
    expect(retired?.visibleToAgent).toBe(false);
    // The row still EXISTS (soft retirement), but is no longer selectable.
    expect(await resolveToolPermission(ctx, tool.id, {})).toMatchObject({ effect: "Deny", reason: "tool_not_selectable" });
  });
});
