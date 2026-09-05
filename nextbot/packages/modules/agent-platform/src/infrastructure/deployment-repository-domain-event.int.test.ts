import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { withTenant, schema, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { eq, and } from "drizzle-orm";
import { createAgentDefinition, createAgentDefinitionVersion } from "../application/agent-definition-service.js";
import { createInitialProductionDeployment } from "./deployment-repository.js";

const ARTIFACT = {
  apiVersion: "nextbot.io/v1" as const,
  kind: "AgentDefinition" as const,
  metadata: { name: "deploy-domain-event-target", version: "1.0.0" },
  spec: {
    graphType: "CustomFSM" as const,
    modelRoute: "chat.primary",
    instructions: "hi",
    toolPolicy: { source: "agent-tool-registry" as const, capabilityGroups: [], maxToolCallsPerTurn: 5 },
    guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: [] },
    memory: { strategy: "rolling-window", maxTurns: 20 },
    budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
  },
};
const ACTOR = "11111111-1111-1111-1111-111111111111";

/**
 * Target Architecture Blueprint Phase 18 (BL-49, FR-API-02) — closes a real,
 * disclosed gap: `createInitialProductionDeployment` (a version's first promotion to
 * Production, or a later promotion that cuts over the previously-active deployment —
 * the single most common "deployment changed" case) emitted NO `domain_event` at all
 * before this phase, confirmed by inspection (`emergencyRollbackRepoint`/
 * `setTrafficSplit` already emitted their own). Tests the infra function directly
 * (not the full promotion-gate walk `promote-version-service.int.test.ts` already
 * covers) to isolate this one producer's behavior.
 */
const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

async function domainEventsOfType(ctx: TenantContext, type: string) {
  return withTenant(ctx, (db: TenantScopedClient) => db.select().from(schema.domainEvent).where(and(eq(schema.domainEvent.tenantId, ctx.tenantId), eq(schema.domainEvent.type, type))));
}

describe("createInitialProductionDeployment now emits agent-platform.deployment_created (FR-API-02's webhook 'deployment changed' category)", () => {
  it("emits one deployment_created event on a fresh (first-ever) promotion, carrying the version/definition/environment", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const definition = await createAgentDefinition(ctx, { name: "deploy-domain-event-target" });
    const version = await createAgentDefinitionVersion(ctx, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT }, ACTOR);

    await createInitialProductionDeployment(ctx, { agentDefinitionId: definition.id, agentDefinitionVersionId: version.id, environment: "Production", actorUserId: ACTOR });

    const events = await domainEventsOfType(ctx, "agent-platform.deployment_created");
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      targetId: version.id,
      agentDefinitionId: definition.id,
      environment: "Production",
      trafficSplitPct: 100,
      replacedPriorDeployment: false,
    });
  });

  it("a SECOND promotion for the same agent/environment (cutover) emits its OWN event, flagged as having replaced the prior deployment", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const definition = await createAgentDefinition(ctx, { name: "deploy-domain-event-target-2" });
    const versionA = await createAgentDefinitionVersion(ctx, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT }, ACTOR);
    const versionB = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      { version: "1.0.1", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: { ...ARTIFACT, metadata: { ...ARTIFACT.metadata, version: "1.0.1" } } },
      ACTOR,
    );

    await createInitialProductionDeployment(ctx, { agentDefinitionId: definition.id, agentDefinitionVersionId: versionA.id, environment: "Production", actorUserId: ACTOR });
    await createInitialProductionDeployment(ctx, { agentDefinitionId: definition.id, agentDefinitionVersionId: versionB.id, environment: "Production", actorUserId: ACTOR });

    const events = await domainEventsOfType(ctx, "agent-platform.deployment_created");
    expect(events).toHaveLength(2);
    expect(events.some((e) => (e.payload as { replacedPriorDeployment: boolean }).replacedPriorDeployment === true)).toBe(true);
  });
});
