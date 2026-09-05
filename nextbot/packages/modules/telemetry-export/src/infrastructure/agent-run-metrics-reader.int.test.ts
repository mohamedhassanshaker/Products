import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { handleCreateDefinition, handleCreateVersion } from "@nextbot/agent-platform";
import { getAgentRunMetricsSnapshot } from "./agent-run-metrics-reader.js";

const ARTIFACT = {
  apiVersion: "nextbot.io/v1" as const,
  kind: "AgentDefinition" as const,
  metadata: { name: "metrics-fixture", version: "1.0.0" },
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
 * `agent_run` is shared infrastructure (`@nextbot/db`'s schema) — this module reads
 * it directly, matching this codebase's established "reading another module's table
 * via the shared schema package" precedent (see this file's own doc comment). The
 * OWNING `agent_definition_version` fixture is created through `@nextbot/agent-
 * platform`'s real save-time route-resolution path instead of a hand-rolled raw
 * insert, since `model_route_version_id` is NOT NULL in the real (post-migration)
 * database and that resolution logic belongs to that module, not duplicated here
 * (a test-fixture-only edge, see `eslint.config.mjs`'s own disclosure).
 */
async function seedAgentRun(
  ctx: TenantContext,
  input: { trigger: "CustomerMessage" | "ShadowEvaluation"; status: "Succeeded" | "Failed"; durationMs: number; costUsd: string; startedAt: Date },
): Promise<void> {
  const definition = await handleCreateDefinition(ctx, { name: `metrics-fixture-${generateId()}` });
  const version = await handleCreateVersion(ctx, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT }, ACTOR);
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.agentRun).values({
      id: generateId(),
      tenantId: ctx.tenantId,
      agentDefinitionVersionId: version.id,
      trigger: input.trigger,
      status: input.status,
      otelTraceId: generateId(),
      durationMs: input.durationMs,
      costUsd: input.costUsd,
      startedAt: input.startedAt,
      endedAt: input.startedAt,
    });
  });
}

describe("getAgentRunMetricsSnapshot (real Postgres) — real aggregate, excludes shadow-evaluation traffic", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("aggregates succeeded/failed counts, avg duration, and total cost over the window", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const now = new Date();
    await seedAgentRun(ctx, { trigger: "CustomerMessage", status: "Succeeded", durationMs: 100, costUsd: "0.10", startedAt: now });
    await seedAgentRun(ctx, { trigger: "CustomerMessage", status: "Succeeded", durationMs: 300, costUsd: "0.20", startedAt: now });
    await seedAgentRun(ctx, { trigger: "CustomerMessage", status: "Failed", durationMs: 50, costUsd: "0.05", startedAt: now });

    const snapshot = await getAgentRunMetricsSnapshot(ctx, 5);
    expect(snapshot.succeededCount).toBe(2);
    expect(snapshot.failedCount).toBe(1);
    expect(snapshot.avgDurationMs).toBeCloseTo(150, 0);
    expect(snapshot.totalCostUsd).toBeCloseTo(0.35, 5);
  });

  it("excludes ShadowEvaluation-triggered runs entirely — shadow traffic never inflates a tenant's real metrics", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const now = new Date();
    await seedAgentRun(ctx, { trigger: "CustomerMessage", status: "Succeeded", durationMs: 100, costUsd: "0.10", startedAt: now });
    await seedAgentRun(ctx, { trigger: "ShadowEvaluation", status: "Succeeded", durationMs: 999, costUsd: "9.99", startedAt: now });

    const snapshot = await getAgentRunMetricsSnapshot(ctx, 5);
    expect(snapshot.succeededCount).toBe(1);
    expect(snapshot.totalCostUsd).toBeCloseTo(0.1, 5);
  });

  it("excludes runs outside the aggregation window", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const longAgo = new Date(Date.now() - 60 * 60_000); // 1 hour ago
    await seedAgentRun(ctx, { trigger: "CustomerMessage", status: "Succeeded", durationMs: 100, costUsd: "0.10", startedAt: longAgo });

    const snapshot = await getAgentRunMetricsSnapshot(ctx, 5); // 5-minute window
    expect(snapshot.succeededCount).toBe(0);
    expect(snapshot.failedCount).toBe(0);
  });

  it("returns null averages/totals (never a division-by-zero artifact) when there is genuinely no activity", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const snapshot = await getAgentRunMetricsSnapshot(ctx, 5);
    expect(snapshot).toEqual({ succeededCount: 0, failedCount: 0, avgDurationMs: null, totalCostUsd: null });
  });
});
