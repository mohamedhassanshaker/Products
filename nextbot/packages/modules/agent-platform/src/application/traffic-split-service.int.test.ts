import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { schema, withTenant, generateId, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { DeploymentReasonRequiredError, TrafficSplitInvalidError, VersionNotInDefinitionError, VersionNotProductionError } from "@nextbot/contracts";
import { createAgentDefinition, createAgentDefinitionVersion, recordSandboxTest, bindEvalSuite } from "./agent-definition-service.js";
import { createEvalSuite, addEvalCase, runEvalSuite } from "./eval-service.js";
import { promoteAgentVersion } from "./promote-version-service.js";
import { emergencyRollback } from "./emergency-rollback-service.js";
import { promoteCanary, setTrafficSplit } from "./traffic-split-service.js";
import { listActiveDeploymentsForAgentEnvironment, listDeploymentsForAgent } from "../infrastructure/deployment-repository.js";

/**
 * Target Architecture Blueprint Phase 17 (BL-48, absorbing BL-13) — the multi-row-active
 * deployment writers, against a real Postgres.
 *
 * Covers ADR-0019 §6 / LLD §15.9 items 1 (split invariant, domain **and** trigger), 2
 * (the shared advisory lock under a real race) and 5 (**the phase's own exit gate**:
 * emergency rollback still collapses an N-row canary correctly, which is only a
 * meaningful claim now that an N-row canary can exist at all).
 */

const ARTIFACT = {
  apiVersion: "nextbot.io/v1" as const,
  kind: "AgentDefinition" as const,
  metadata: { name: "canary-target", version: "1.0.0" },
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

const AUTHOR = "11111111-1111-1111-1111-111111111111";
const REVIEWER = "22222222-2222-2222-2222-222222222222";

/** Walks a fresh Draft all the way to Production through the REAL promotion gate — the
 *  precondition ADR-0019 §2.4 requires before a version may receive any canary traffic. */
async function promoteToProduction(ctx: TenantContext, definitionId: string, version: string) {
  const v = await createAgentDefinitionVersion(ctx, definitionId, { version, modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT }, AUTHOR);
  const suite = await createEvalSuite(ctx, { name: `suite-${definitionId}-${version}` });
  await addEvalCase(ctx, suite.id, { name: "case-1", inputTranscript: [{ sender: "Customer", text: "hi" }], expectedResponsePattern: ".*" });
  await bindEvalSuite(ctx, v.id, suite.id);
  await promoteAgentVersion(ctx, v.id, "EvalGated", AUTHOR);
  await runEvalSuite(ctx, { agentDefinitionVersionId: v.id, triggeredBy: "VersionSubmitted" });
  await promoteAgentVersion(ctx, v.id, "HumanReview", AUTHOR);
  await promoteAgentVersion(ctx, v.id, "Approved", REVIEWER);
  await recordSandboxTest(ctx, v.id);
  await promoteAgentVersion(ctx, v.id, "Production", REVIEWER);
  return v;
}

/** A Draft that never went through the gate — the thing ADR-0019 §2.4 must keep out of
 *  production traffic. */
async function makeDraft(ctx: TenantContext, definitionId: string, version: string) {
  return createAgentDefinitionVersion(ctx, definitionId, { version, modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT }, AUTHOR);
}

describe("setTrafficSplit / promoteCanary — the first multi-row-active deployment writers (real Postgres)", () => {
  let ctx: TenantContext;
  let aiServer: MockOpenAiServerHandle;

  beforeAll(async () => {
    ctx = await createFixtureTenant();
    aiServer = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "ok" }) });
    process.env.AI_PROVIDER = "openai-compatible";
    process.env.AI_BASE_URL = aiServer.url;
    process.env.AI_MODEL_CHAT_PRIMARY = "test-model";
  });
  afterAll(async () => {
    await aiServer.close();
    await deleteFixtureTenant(ctx.tenantId);
  });

  it("LLD §15.9 item 1: a 90/10 split writes TWO simultaneously-active rows summing to 100 — something no code path in this codebase could produce before Phase 17", async () => {
    const definition = await createAgentDefinition(ctx, { name: "split-90-10" });
    const stable = await promoteToProduction(ctx, definition.id, "1.0.0");
    const canary = await promoteToProduction(ctx, definition.id, "1.1.0");

    const rows = await setTrafficSplit(
      ctx,
      definition.id,
      {
        environment: "Production",
        allocations: [
          { agentDefinitionVersionId: stable.id, trafficSplitPct: 90 },
          { agentDefinitionVersionId: canary.id, trafficSplitPct: 10 },
        ],
        reason: "Starting a 10% canary on 1.1.0.",
      },
      REVIEWER,
    );
    expect(rows).toHaveLength(2);

    const active = await listActiveDeploymentsForAgentEnvironment(ctx, definition.id, "Production");
    expect(active).toHaveLength(2);
    expect(active.reduce((sum, d) => sum + d.trafficSplitPct, 0)).toBe(100);
    expect(new Set(active.map((d) => d.agentDefinitionVersionId))).toEqual(new Set([stable.id, canary.id]));

    // Every prior active row was deactivated in the same transaction, so the trigger never
    // observed both sets active at once.
    const all = await listDeploymentsForAgent(ctx, definition.id);
    expect(all.filter((d) => d.isActive)).toHaveLength(2);
  });

  it("LLD §15.9 item 1: a 90/20 split is rejected by DOMAIN validation before any row is written", async () => {
    const definition = await createAgentDefinition(ctx, { name: "split-90-20-domain" });
    const a = await promoteToProduction(ctx, definition.id, "1.0.0");
    const b = await promoteToProduction(ctx, definition.id, "1.1.0");

    await expect(
      setTrafficSplit(
        ctx,
        definition.id,
        {
          environment: "Production",
          allocations: [
            { agentDefinitionVersionId: a.id, trafficSplitPct: 90 },
            { agentDefinitionVersionId: b.id, trafficSplitPct: 20 },
          ],
          reason: "should be rejected",
        },
        REVIEWER,
      ),
    ).rejects.toBeInstanceOf(TrafficSplitInvalidError);

    // The last successful promotion's single 100% row is untouched — a rejected split is
    // not a partially-applied one.
    const active = await listActiveDeploymentsForAgentEnvironment(ctx, definition.id, "Production");
    expect(active).toHaveLength(1);
    expect(active[0]!.agentDefinitionVersionId).toBe(b.id);
  });

  it("LLD §15.9 item 1: with domain validation BYPASSED, migration 0016's trigger still rejects a >100 sum — the backstop is real", async () => {
    const definition = await createAgentDefinition(ctx, { name: "split-trigger-backstop" });
    const a = await promoteToProduction(ctx, definition.id, "1.0.0");
    const b = await promoteToProduction(ctx, definition.id, "1.1.0");

    // Deliberately writes straight to the table, skipping `setTrafficSplit` entirely —
    // this is the "a bug anywhere else in this codebase can never silently violate the
    // invariant" claim migration 0016's own comment makes, exercised for real.
    await expect(
      withTenant(ctx, async (db: TenantScopedClient) => {
        await db
          .update(schema.deployment)
          .set({ trafficSplitPct: 90 })
          .where(and(eq(schema.deployment.tenantId, ctx.tenantId), eq(schema.deployment.agentDefinitionId, definition.id), eq(schema.deployment.isActive, true)));
        await db.insert(schema.deployment).values({
          id: generateId(),
          tenantId: ctx.tenantId,
          agentDefinitionId: definition.id,
          agentDefinitionVersionId: a.id,
          environment: "Production",
          trafficSplitPct: 20,
          isActive: true,
        });
      }),
    ).rejects.toThrow(/traffic_split_pct invariant violated/);

    expect(b.id).toBeDefined();
  });

  it("ADR-0019 §2.4: a version that has NOT been promoted to Production cannot receive canary traffic — canary is not a second route past the gate", async () => {
    const definition = await createAgentDefinition(ctx, { name: "split-gate-bypass-attempt" });
    const stable = await promoteToProduction(ctx, definition.id, "1.0.0");
    const ungated = await makeDraft(ctx, definition.id, "2.0.0");
    expect(ungated.status).toBe("Draft");

    await expect(
      setTrafficSplit(
        ctx,
        definition.id,
        {
          environment: "Production",
          allocations: [
            { agentDefinitionVersionId: stable.id, trafficSplitPct: 90 },
            { agentDefinitionVersionId: ungated.id, trafficSplitPct: 10 },
          ],
          reason: "attempting to skip the gate",
        },
        REVIEWER,
      ),
    ).rejects.toBeInstanceOf(VersionNotProductionError);

    // And nothing was written: the Draft never reached a single real customer.
    const active = await listActiveDeploymentsForAgentEnvironment(ctx, definition.id, "Production");
    expect(active.map((d) => d.agentDefinitionVersionId)).toEqual([stable.id]);
  });

  it("ADR-0019 §2.4: `promoteCanary` enforces the SAME Production precondition — it is not a softer path to 100%", async () => {
    const definition = await createAgentDefinition(ctx, { name: "promote-canary-gate" });
    await promoteToProduction(ctx, definition.id, "1.0.0");
    const ungated = await makeDraft(ctx, definition.id, "2.0.0");

    await expect(
      promoteCanary(ctx, definition.id, { environment: "Production", agentDefinitionVersionId: ungated.id, reason: "nope" }, REVIEWER),
    ).rejects.toBeInstanceOf(VersionNotProductionError);
  });

  it("LLD §15.4: a version from a DIFFERENT agent definition is rejected, checked against the version row and never inferred from the request", async () => {
    const definitionA = await createAgentDefinition(ctx, { name: "split-cross-def-a" });
    const definitionB = await createAgentDefinition(ctx, { name: "split-cross-def-b" });
    const inA = await promoteToProduction(ctx, definitionA.id, "1.0.0");
    const inB = await promoteToProduction(ctx, definitionB.id, "1.0.0");

    await expect(
      setTrafficSplit(
        ctx,
        definitionA.id,
        {
          environment: "Production",
          allocations: [
            { agentDefinitionVersionId: inA.id, trafficSplitPct: 90 },
            { agentDefinitionVersionId: inB.id, trafficSplitPct: 10 },
          ],
          reason: "cross-definition",
        },
        REVIEWER,
      ),
    ).rejects.toBeInstanceOf(VersionNotInDefinitionError);
  });

  it("LLD §15.4: a blank/whitespace-only reason is rejected server-side on both writers", async () => {
    const definition = await createAgentDefinition(ctx, { name: "split-reason-required" });
    const v = await promoteToProduction(ctx, definition.id, "1.0.0");

    await expect(
      setTrafficSplit(ctx, definition.id, { environment: "Production", allocations: [{ agentDefinitionVersionId: v.id, trafficSplitPct: 100 }], reason: "   " }, REVIEWER),
    ).rejects.toBeInstanceOf(DeploymentReasonRequiredError);
    await expect(promoteCanary(ctx, definition.id, { environment: "Production", agentDefinitionVersionId: v.id, reason: "" }, REVIEWER)).rejects.toBeInstanceOf(
      DeploymentReasonRequiredError,
    );
  });

  it("writes a real `SplitChange` history row plus an outbox event IN THE SAME TRANSACTION — the `SplitChange` enum value's first-ever writer", async () => {
    const definition = await createAgentDefinition(ctx, { name: "split-audit-trail" });
    const stable = await promoteToProduction(ctx, definition.id, "1.0.0");
    const canary = await promoteToProduction(ctx, definition.id, "1.1.0");

    await setTrafficSplit(
      ctx,
      definition.id,
      {
        environment: "Production",
        allocations: [
          { agentDefinitionVersionId: stable.id, trafficSplitPct: 70 },
          { agentDefinitionVersionId: canary.id, trafficSplitPct: 30 },
        ],
        reason: "Widening the canary to 30%.",
      },
      REVIEWER,
    );

    await withTenant(ctx, async (db: TenantScopedClient) => {
      const history = await db
        .select()
        .from(schema.deploymentHistory)
        .where(and(eq(schema.deploymentHistory.tenantId, ctx.tenantId), eq(schema.deploymentHistory.agentDefinitionId, definition.id), eq(schema.deploymentHistory.action, "SplitChange")));
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ reason: "Widening the canary to 30%.", actorUserId: REVIEWER });
      // Attributed to the majority arm, which is what a rollout timeline reads naturally.
      expect(history[0]!.agentDefinitionVersionId).toBe(stable.id);
      expect(history[0]!.toState).toMatchObject({ allocations: [{ agentDefinitionVersionId: stable.id, trafficSplitPct: 70 }, { agentDefinitionVersionId: canary.id, trafficSplitPct: 30 }] });

      const events = await db
        .select()
        .from(schema.domainEvent)
        .where(and(eq(schema.domainEvent.tenantId, ctx.tenantId), eq(schema.domainEvent.type, "agent-platform.traffic_split_changed")));
      const event = events.find((e) => (e.payload as { targetId?: string }).targetId === definition.id);
      expect(event).toBeDefined();
      expect(event!.payload).toMatchObject({ reason: "Widening the canary to 30%.", actorId: REVIEWER, actionType: "Deployment" });
    });
  });

  it("`promoteCanary` collapses the split to a single 100% row and writes the `PromoteCanary` action (also never written before Phase 17)", async () => {
    const definition = await createAgentDefinition(ctx, { name: "promote-canary-happy" });
    const stable = await promoteToProduction(ctx, definition.id, "1.0.0");
    const canary = await promoteToProduction(ctx, definition.id, "1.1.0");
    await setTrafficSplit(
      ctx,
      definition.id,
      {
        environment: "Production",
        allocations: [
          { agentDefinitionVersionId: stable.id, trafficSplitPct: 90 },
          { agentDefinitionVersionId: canary.id, trafficSplitPct: 10 },
        ],
        reason: "10% canary",
      },
      REVIEWER,
    );

    await promoteCanary(ctx, definition.id, { environment: "Production", agentDefinitionVersionId: canary.id, reason: "Canary healthy at 10% for 48h." }, REVIEWER);

    const active = await listActiveDeploymentsForAgentEnvironment(ctx, definition.id, "Production");
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ agentDefinitionVersionId: canary.id, trafficSplitPct: 100 });

    await withTenant(ctx, async (db: TenantScopedClient) => {
      const history = await db
        .select()
        .from(schema.deploymentHistory)
        .where(and(eq(schema.deploymentHistory.tenantId, ctx.tenantId), eq(schema.deploymentHistory.agentDefinitionId, definition.id), eq(schema.deploymentHistory.action, "PromoteCanary")));
      expect(history).toHaveLength(1);
    });
  });

  it("**Phase 17's own exit gate** — emergency rollback collapses a live N-ROW canary to one 100% row, with NO new rollback code (ADR-0019 §2.7, LLD §15.9 item 5)", async () => {
    const definition = await createAgentDefinition(ctx, { name: "rollback-vs-canary" });
    const stable = await promoteToProduction(ctx, definition.id, "1.0.0");
    const canary = await promoteToProduction(ctx, definition.id, "1.1.0");
    await setTrafficSplit(
      ctx,
      definition.id,
      {
        environment: "Production",
        allocations: [
          { agentDefinitionVersionId: stable.id, trafficSplitPct: 90 },
          { agentDefinitionVersionId: canary.id, trafficSplitPct: 10 },
        ],
        reason: "10% canary on 1.1.0",
      },
      REVIEWER,
    );
    // Precondition: a genuine two-arm canary is live. Before Phase 17 this state was
    // unreachable, which is why the exit gate could not previously be tested at all.
    expect(await listActiveDeploymentsForAgentEnvironment(ctx, definition.id, "Production")).toHaveLength(2);

    const startedAt = Date.now();
    await emergencyRollback(ctx, definition.id, { targetVersionId: stable.id, reason: "1.1.0 is dropping refund requests." }, REVIEWER);
    const elapsedMs = Date.now() - startedAt;

    // BOTH active rows were collapsed, not just one — `UPDATE ... WHERE is_active = true`
    // matches all of them, which is exactly why this needed no new code.
    const active = await listActiveDeploymentsForAgentEnvironment(ctx, definition.id, "Production");
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ agentDefinitionVersionId: stable.id, trafficSplitPct: 100 });
    expect(active.reduce((sum, d) => sum + d.trafficSplitPct, 0)).toBe(100);

    // NFR-2's <5s bound, measured the same way the existing rollback timing test measures
    // it: the repoint itself, not the operator's round trip.
    expect(elapsedMs).toBeLessThan(5_000);
  });

  it("LLD §15.9 item 2: a concurrent `setTrafficSplit` and `emergencyRollbackRepoint` on the SAME agent+environment leave exactly one consistent active set", async () => {
    const definition = await createAgentDefinition(ctx, { name: "split-vs-rollback-race" });
    const stable = await promoteToProduction(ctx, definition.id, "1.0.0");
    const canary = await promoteToProduction(ctx, definition.id, "1.1.0");

    // Fired without awaiting either first: the shared
    // `pg_advisory_xact_lock(hashtext("<tenant>:<agent>:<env>"))` key is the only thing
    // preventing these two deactivate-then-insert transactions from interleaving into a
    // set that violates the SUM=100 invariant (or worse, leaves zero active rows).
    const results = await Promise.allSettled([
      setTrafficSplit(
        ctx,
        definition.id,
        {
          environment: "Production",
          allocations: [
            { agentDefinitionVersionId: stable.id, trafficSplitPct: 60 },
            { agentDefinitionVersionId: canary.id, trafficSplitPct: 40 },
          ],
          reason: "widening canary",
        },
        REVIEWER,
      ),
      emergencyRollback(ctx, definition.id, { targetVersionId: stable.id, reason: "rolling back mid-change" }, REVIEWER),
    ]);

    // Both are legitimate operations; neither is expected to fail. What matters is the
    // end state, not which won.
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const active = await listActiveDeploymentsForAgentEnvironment(ctx, definition.id, "Production");
    expect(active.length).toBeGreaterThanOrEqual(1);
    expect(active.reduce((sum, d) => sum + d.trafficSplitPct, 0)).toBe(100);
  });

  it("LLD §15.9 item 2: TWO concurrent `setTrafficSplit` calls for the same triple also serialize — the last committed set is the whole active set", async () => {
    const definition = await createAgentDefinition(ctx, { name: "split-vs-split-race" });
    const a = await promoteToProduction(ctx, definition.id, "1.0.0");
    const b = await promoteToProduction(ctx, definition.id, "1.1.0");

    await Promise.all([
      setTrafficSplit(
        ctx,
        definition.id,
        { environment: "Production", allocations: [{ agentDefinitionVersionId: a.id, trafficSplitPct: 80 }, { agentDefinitionVersionId: b.id, trafficSplitPct: 20 }], reason: "80/20" },
        REVIEWER,
      ),
      setTrafficSplit(
        ctx,
        definition.id,
        { environment: "Production", allocations: [{ agentDefinitionVersionId: a.id, trafficSplitPct: 50 }, { agentDefinitionVersionId: b.id, trafficSplitPct: 50 }], reason: "50/50" },
        REVIEWER,
      ),
    ]);

    const active = await listActiveDeploymentsForAgentEnvironment(ctx, definition.id, "Production");
    expect(active).toHaveLength(2);
    expect(active.reduce((sum, d) => sum + d.trafficSplitPct, 0)).toBe(100);
    // Exactly one of the two requested sets survived intact — never a mixture of both
    // (e.g. 80 + 50, which the trigger would have rejected, or 20 + 50, which it would
    // NOT have rejected and which is therefore the genuinely dangerous interleaving).
    const shape = active
      .map((d) => d.trafficSplitPct)
      .sort((x, y) => x - y)
      .join("/");
    expect(["20/80", "50/50"]).toContain(shape);
  });
});
