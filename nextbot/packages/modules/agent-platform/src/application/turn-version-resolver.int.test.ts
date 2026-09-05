import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { generateId, type TenantContext } from "@nextbot/db";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { createAgentDefinition, createAgentDefinitionVersion, recordSandboxTest, bindEvalSuite } from "./agent-definition-service.js";
import { createEvalSuite, addEvalCase, runEvalSuite } from "./eval-service.js";
import { promoteAgentVersion } from "./promote-version-service.js";
import { emergencyRollback } from "./emergency-rollback-service.js";
import { setTrafficSplit } from "./traffic-split-service.js";
import { resolveTurnAgentVersion } from "./turn-version-resolver.js";
import { listActiveDeploymentsForAgentEnvironment } from "../infrastructure/deployment-repository.js";

/**
 * Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.3, LLD §15.3/§15.9 items 3,
 * 4, 5 and 10) — the live version resolver, against a real Postgres.
 *
 * **The centrepiece of this suite is the stickiness-bounded-by-lifetime property.**
 * ADR-0019 §3 calls a stickiness that survived deployment deactivation "the most
 * consequential rejection in this ADR": it would make emergency rollback ineffective for
 * in-flight conversations — the exact population being harmed by the bad version — *while
 * appearing to succeed*. That failure mode produces no error, no crash and no red test
 * unless a test is written specifically to look for it, which is what the adversarial case
 * below does.
 */

const ARTIFACT = {
  apiVersion: "nextbot.io/v1" as const,
  kind: "AgentDefinition" as const,
  metadata: { name: "resolver-target", version: "1.0.0" },
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

describe("resolveTurnAgentVersion — the Phase 17 live version resolution chain (real Postgres)", () => {
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

  it("LLD §15.9 item 10 (fallback preservation): a NULL binding resolves exactly as the pre-Phase-17 build did", async () => {
    const definition = await createAgentDefinition(ctx, { name: "resolver-null-binding" });
    const v = await promoteToProduction(ctx, definition.id, "1.0.0");

    const resolved = await resolveTurnAgentVersion(ctx, { conversationId: generateId(), agentDefinitionId: null, environment: "Production" });

    // The tenant-wide fallback: most recently promoted Production version across all of
    // the tenant's definitions, with no deployment attribution — byte-for-byte the old
    // `findActiveAgentDefinitionVersion` behavior, deliberately retained.
    expect(resolved).toMatchObject({ agentDefinitionVersionId: v.id, deploymentId: null, source: "TenantWideFallback" });
  });

  it("returns null when the agent has no active deployment at all — the honest 'no agent run to trace yet' state, unchanged", async () => {
    const definition = await createAgentDefinition(ctx, { name: "resolver-nothing-deployed" });
    // A Draft only: never promoted, so no `deployment` row exists.
    await createAgentDefinitionVersion(ctx, definition.id, { version: "0.1.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT }, AUTHOR);

    expect(await resolveTurnAgentVersion(ctx, { conversationId: generateId(), agentDefinitionId: definition.id, environment: "Production" })).toBeNull();
  });

  it("LLD §15.9 item 4 (stickiness): a conversation's second turn resolves to the SAME version while the deployment stays active", async () => {
    const definition = await createAgentDefinition(ctx, { name: "resolver-sticky" });
    const stable = await promoteToProduction(ctx, definition.id, "1.0.0");
    const canary = await promoteToProduction(ctx, definition.id, "1.1.0");
    await setTrafficSplit(
      ctx,
      definition.id,
      {
        environment: "Production",
        allocations: [
          { agentDefinitionVersionId: stable.id, trafficSplitPct: 50 },
          { agentDefinitionVersionId: canary.id, trafficSplitPct: 50 },
        ],
        reason: "50/50",
      },
      REVIEWER,
    );

    const conversationId = generateId();
    const first = await resolveTurnAgentVersion(ctx, { conversationId, agentDefinitionId: definition.id, environment: "Production" });
    expect(first!.source).toBe("WeightedSplit");

    for (let turn = 0; turn < 5; turn += 1) {
      const next = await resolveTurnAgentVersion(ctx, { conversationId, agentDefinitionId: definition.id, environment: "Production" });
      expect(next!.agentDefinitionVersionId).toBe(first!.agentDefinitionVersionId);
      expect(next!.deploymentId).toBe(first!.deploymentId);
      // From the second turn on it comes from the stored assignment, not a re-roll.
      expect(next!.source).toBe("StickyAssignment");
    }
  });

  it("LLD §15.9 item 3 (determinism): two distinct conversations both resolve reproducibly, and different conversations can land on different arms", async () => {
    const definition = await createAgentDefinition(ctx, { name: "resolver-deterministic" });
    const a = await promoteToProduction(ctx, definition.id, "1.0.0");
    const b = await promoteToProduction(ctx, definition.id, "1.1.0");
    await setTrafficSplit(
      ctx,
      definition.id,
      {
        environment: "Production",
        allocations: [
          { agentDefinitionVersionId: a.id, trafficSplitPct: 50 },
          { agentDefinitionVersionId: b.id, trafficSplitPct: 50 },
        ],
        reason: "50/50",
      },
      REVIEWER,
    );

    const seen = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const resolved = await resolveTurnAgentVersion(ctx, { conversationId: generateId(), agentDefinitionId: definition.id, environment: "Production" });
      seen.add(resolved!.agentDefinitionVersionId);
    }
    // Over 40 conversations on a 50/50 split, landing on only one arm has probability
    // ~2^-39 — so this is a real assertion that the weighted walk actually distributes,
    // not a coin-flip that could flake.
    expect(seen.size).toBe(2);
  });

  it("**ADVERSARIAL — stickiness is bounded by the ASSIGNED deployment's `is_active` lifetime.** A stale assignment to a deactivated deployment is DISCARDED and re-resolved, never honored (ADR-0019 §2.3 step 3 / §3)", async () => {
    const definition = await createAgentDefinition(ctx, { name: "resolver-stickiness-lifetime" });
    const bad = await promoteToProduction(ctx, definition.id, "1.0.0");
    const good = await promoteToProduction(ctx, definition.id, "1.1.0");

    // Put 100% of traffic on the BAD version so the conversation is guaranteed to be
    // assigned to it — this test must not depend on which arm the hash happened to pick.
    await setTrafficSplit(
      ctx,
      definition.id,
      { environment: "Production", allocations: [{ agentDefinitionVersionId: bad.id, trafficSplitPct: 100 }], reason: "all traffic on 1.0.0" },
      REVIEWER,
    );

    const conversationId = generateId();
    const turn1 = await resolveTurnAgentVersion(ctx, { conversationId, agentDefinitionId: definition.id, environment: "Production" });
    expect(turn1!.agentDefinitionVersionId).toBe(bad.id);

    // Confirm the assignment really is sticky BEFORE the rollback, so the assertion after
    // it is about the lifetime bound and not about stickiness never having worked.
    const turn2 = await resolveTurnAgentVersion(ctx, { conversationId, agentDefinitionId: definition.id, environment: "Production" });
    expect(turn2!.source).toBe("StickyAssignment");
    expect(turn2!.agentDefinitionVersionId).toBe(bad.id);

    // The bad version is rolled back. This DEACTIVATES the deployment the conversation is
    // stuck to; the assignment row itself is deliberately left in place (nothing deletes
    // it), so the only thing standing between this conversation and being served the bad
    // version forever is the resolver's `WHERE deployment.is_active` join.
    await emergencyRollback(ctx, definition.id, { targetVersionId: good.id, reason: "1.0.0 is broken" }, REVIEWER);

    const turn3 = await resolveTurnAgentVersion(ctx, { conversationId, agentDefinitionId: definition.id, environment: "Production" });
    expect(turn3!.agentDefinitionVersionId).toBe(good.id);
    expect(turn3!.agentDefinitionVersionId).not.toBe(bad.id);
    // Re-RESOLVED, not honoured from the stale row.
    expect(turn3!.source).toBe("WeightedSplit");

    // And the assignment has been re-pointed at the new, active deployment, so the turn
    // after that is sticky again — the conversation is not permanently re-rolling.
    const turn4 = await resolveTurnAgentVersion(ctx, { conversationId, agentDefinitionId: definition.id, environment: "Production" });
    expect(turn4!.source).toBe("StickyAssignment");
    expect(turn4!.agentDefinitionVersionId).toBe(good.id);
  });

  it("**ADVERSARIAL — the same bound holds for an ordinary SPLIT CHANGE, not just an emergency rollback**: a conversation assigned to an arm that is removed re-resolves on its next turn", async () => {
    const definition = await createAgentDefinition(ctx, { name: "resolver-split-change-rebind" });
    const oldArm = await promoteToProduction(ctx, definition.id, "1.0.0");
    const newArm = await promoteToProduction(ctx, definition.id, "1.1.0");

    await setTrafficSplit(
      ctx,
      definition.id,
      { environment: "Production", allocations: [{ agentDefinitionVersionId: oldArm.id, trafficSplitPct: 100 }], reason: "all on old" },
      REVIEWER,
    );
    const conversationId = generateId();
    expect((await resolveTurnAgentVersion(ctx, { conversationId, agentDefinitionId: definition.id, environment: "Production" }))!.agentDefinitionVersionId).toBe(oldArm.id);

    // An ordinary admin split change — every previous row is deactivated by
    // `setTrafficSplit`'s own deactivate-then-insert, exactly like a rollback.
    await setTrafficSplit(
      ctx,
      definition.id,
      { environment: "Production", allocations: [{ agentDefinitionVersionId: newArm.id, trafficSplitPct: 100 }], reason: "all on new" },
      REVIEWER,
    );

    const afterChange = await resolveTurnAgentVersion(ctx, { conversationId, agentDefinitionId: definition.id, environment: "Production" });
    expect(afterChange!.agentDefinitionVersionId).toBe(newArm.id);
  });

  it("**Phase 17 exit gate, end to end**: an emergency rollback against a live 2-ROW canary is served to an already-assigned conversation on its very next turn, inside NFR-2's <5s bound", async () => {
    const definition = await createAgentDefinition(ctx, { name: "resolver-exit-gate" });
    const stable = await promoteToProduction(ctx, definition.id, "1.0.0");
    const canary = await promoteToProduction(ctx, definition.id, "1.1.0");
    await setTrafficSplit(
      ctx,
      definition.id,
      {
        environment: "Production",
        allocations: [
          { agentDefinitionVersionId: stable.id, trafficSplitPct: 50 },
          { agentDefinitionVersionId: canary.id, trafficSplitPct: 50 },
        ],
        reason: "50/50 so either arm can be the assigned one",
      },
      REVIEWER,
    );
    expect(await listActiveDeploymentsForAgentEnvironment(ctx, definition.id, "Production")).toHaveLength(2);

    // Assign several conversations across BOTH arms, so the assertion below covers the
    // conversation stuck to the surviving arm as well as the rolled-back one.
    const conversations = Array.from({ length: 12 }, () => generateId());
    const before = new Map<string, string>();
    for (const conversationId of conversations) {
      const r = await resolveTurnAgentVersion(ctx, { conversationId, agentDefinitionId: definition.id, environment: "Production" });
      before.set(conversationId, r!.agentDefinitionVersionId);
    }
    expect(new Set(before.values()).size).toBe(2);

    const startedAt = Date.now();
    await emergencyRollback(ctx, definition.id, { targetVersionId: stable.id, reason: "canary regressed" }, REVIEWER);
    const rollbackMs = Date.now() - startedAt;

    // The whole 2-row canary collapsed to one 100% row...
    const active = await listActiveDeploymentsForAgentEnvironment(ctx, definition.id, "Production");
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ agentDefinitionVersionId: stable.id, trafficSplitPct: 100 });

    // ...and EVERY in-flight conversation — including the ones stuck to the canary arm —
    // serves the rolled-back version on its next turn. This is the property that would
    // silently be false if stickiness outlived deactivation.
    for (const conversationId of conversations) {
      const next = await resolveTurnAgentVersion(ctx, { conversationId, agentDefinitionId: definition.id, environment: "Production" });
      expect(next!.agentDefinitionVersionId).toBe(stable.id);
    }

    expect(rollbackMs).toBeLessThan(5_000);
  });
});
