import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { EmergencyRollbackNotEligibleError, EmergencyRollbackReasonRequiredError } from "@nextbot/contracts";
import { createAgentDefinition, createAgentDefinitionVersion, recordSandboxTest, bindEvalSuite } from "./agent-definition-service.js";
import { createEvalSuite, addEvalCase, runEvalSuite } from "./eval-service.js";
import { promoteAgentVersion } from "./promote-version-service.js";
import { emergencyRollback } from "./emergency-rollback-service.js";
import { listDeploymentsForAgent } from "../infrastructure/deployment-repository.js";

const ARTIFACT = {
  apiVersion: "nextbot.io/v1" as const,
  kind: "AgentDefinition" as const,
  metadata: { name: "rollback-target", version: "1.0.0" },
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

/** Walks a freshly-created Draft version all the way to a real, active Production
 * deployment — the exact prerequisite ADR-0017's eligibility check looks for
 * (`deployment_history` proof, not the version's current status). */
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

describe("emergency-rollback-service — ADR-0017's eligibility boundary against a real database", () => {
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

  it("Verification 1/4: rolls back to a previously-Production, now-superseded version — repoints traffic, writes an audit-shaped domain event, and never creates a new version row", async () => {
    const definition = await createAgentDefinition(ctx, { name: "rollback-happy-path" });
    const versionA = await promoteToProduction(ctx, definition.id, "1.0.0");

    // Version B supersedes A in Production.
    const versionB = await promoteToProduction(ctx, definition.id, "1.1.0");
    const afterB = await listDeploymentsForAgent(ctx, definition.id);
    expect(afterB.find((d) => d.agentDefinitionVersionId === versionB.id)).toMatchObject({ isActive: true, trafficSplitPct: 100 });

    const beforeYamlHash = versionA.definitionHash;

    const result = await emergencyRollback(ctx, definition.id, { targetVersionId: versionA.id, reason: "v1.1.0 introduced a checkout regression" }, REVIEWER);
    expect(result.deployment).toMatchObject({ agentDefinitionVersionId: versionA.id, environment: "Production", trafficSplitPct: 100, isActive: true });

    const deployments = await listDeploymentsForAgent(ctx, definition.id);
    const active = deployments.filter((d) => d.isActive);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ agentDefinitionVersionId: versionA.id });
    expect(active.reduce((sum, d) => sum + d.trafficSplitPct, 0)).toBe(100);

    // Immutability (ADR-0017 §6 Verification 4): the target version's own row is
    // byte-identical — this action has no create/update path onto it.
    expect(result.target.definitionHash).toBe(beforeYamlHash);
    expect(result.target.id).toBe(versionA.id);

    // Distinctly-labelled deployment-history row + audit-shaped domain event, both
    // written in the same transaction as the repoint (never a call-site courtesy).
    await withTenant(ctx, async (db: TenantScopedClient) => {
      const historyRows = await db
        .select()
        .from(schema.deploymentHistory)
        .where(and(eq(schema.deploymentHistory.tenantId, ctx.tenantId), eq(schema.deploymentHistory.agentDefinitionVersionId, versionA.id), eq(schema.deploymentHistory.action, "EmergencyRollback")));
      expect(historyRows).toHaveLength(1);
      expect(historyRows[0]).toMatchObject({ reason: "v1.1.0 introduced a checkout regression", actorUserId: REVIEWER });

      const events = await db.select().from(schema.domainEvent).where(and(eq(schema.domainEvent.tenantId, ctx.tenantId), eq(schema.domainEvent.type, "agent-platform.emergency_rollback")));
      expect(events.length).toBeGreaterThanOrEqual(1);
      const event = events.find((e) => (e.payload as { targetId?: string }).targetId === versionA.id);
      expect(event).toBeDefined();
      expect(event?.payload).toMatchObject({ reason: "v1.1.0 introduced a checkout regression", actorId: REVIEWER, targetId: versionA.id });
    });
  });

  it("Verification 1/4 (reject): a Draft version is never eligible, with no override", async () => {
    const definition = await createAgentDefinition(ctx, { name: "rollback-reject-draft" });
    const draft = await createAgentDefinitionVersion(ctx, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT }, AUTHOR);
    expect(draft.status).toBe("Draft");
    await expect(emergencyRollback(ctx, definition.id, { targetVersionId: draft.id, reason: "anything" }, REVIEWER)).rejects.toBeInstanceOf(EmergencyRollbackNotEligibleError);
  });

  it("Verification 1/4 (reject): an Approved-but-never-promoted version is never eligible", async () => {
    const definition = await createAgentDefinition(ctx, { name: "rollback-reject-approved-never-promoted" });
    const version = await createAgentDefinitionVersion(ctx, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT }, AUTHOR);
    const suite = await createEvalSuite(ctx, { name: "rollback-reject-suite" });
    await addEvalCase(ctx, suite.id, { name: "case-1", inputTranscript: [{ sender: "Customer", text: "hi" }], expectedResponsePattern: ".*" });
    await bindEvalSuite(ctx, version.id, suite.id);
    await promoteAgentVersion(ctx, version.id, "EvalGated", AUTHOR);
    await runEvalSuite(ctx, { agentDefinitionVersionId: version.id, triggeredBy: "VersionSubmitted" });
    await promoteAgentVersion(ctx, version.id, "HumanReview", AUTHOR);
    const approved = await promoteAgentVersion(ctx, version.id, "Approved", REVIEWER);
    expect(approved.status).toBe("Approved");

    // Passed the gate, but never actually served Production traffic — ADR-0017 §2.1's
    // "it already worked in production" justification does not hold.
    await expect(emergencyRollback(ctx, definition.id, { targetVersionId: version.id, reason: "anything" }, REVIEWER)).rejects.toBeInstanceOf(EmergencyRollbackNotEligibleError);
  });

  it("Verification 2/4: rejects a previously-Production version that belongs to a DIFFERENT agent definition", async () => {
    const definitionA = await createAgentDefinition(ctx, { name: "rollback-cross-def-a" });
    const definitionB = await createAgentDefinition(ctx, { name: "rollback-cross-def-b" });
    const versionA = await promoteToProduction(ctx, definitionA.id, "1.0.0");
    await promoteToProduction(ctx, definitionB.id, "1.0.0");

    // Calling emergency-rollback scoped to definition B's path with definition A's
    // (genuinely previously-Production) version id must be rejected — cross-
    // definition "rollback" is a promotion, not a rollback (ADR-0017 §2.1).
    await expect(emergencyRollback(ctx, definitionB.id, { targetVersionId: versionA.id, reason: "anything" }, REVIEWER)).rejects.toBeInstanceOf(EmergencyRollbackNotEligibleError);
  });

  it("Verification 3/4: a blank reason fails with the exact FR-AGT-30 message, and a whitespace-only reason is treated the same as blank", async () => {
    const definition = await createAgentDefinition(ctx, { name: "rollback-reject-reason" });
    const versionA = await promoteToProduction(ctx, definition.id, "1.0.0");
    await promoteToProduction(ctx, definition.id, "1.1.0");

    await expect(emergencyRollback(ctx, definition.id, { targetVersionId: versionA.id, reason: "" }, REVIEWER)).rejects.toMatchObject({
      message: "A reason is required for emergency rollback",
    });
    await expect(emergencyRollback(ctx, definition.id, { targetVersionId: versionA.id, reason: "   " }, REVIEWER)).rejects.toBeInstanceOf(EmergencyRollbackReasonRequiredError);
  });

  it("Verification 6/4: two concurrent emergency rollbacks for the same definition leave exactly one active Production deployment at 100% traffic", async () => {
    const definition = await createAgentDefinition(ctx, { name: "rollback-concurrency" });
    const versionA = await promoteToProduction(ctx, definition.id, "1.0.0");
    const versionB = await promoteToProduction(ctx, definition.id, "1.1.0");

    const attempts = 6;
    await Promise.allSettled(
      Array.from({ length: attempts }, (_, i) =>
        emergencyRollback(ctx, definition.id, { targetVersionId: i % 2 === 0 ? versionA.id : versionB.id, reason: `concurrent attempt ${i}` }, REVIEWER),
      ),
    );

    const deployments = await listDeploymentsForAgent(ctx, definition.id);
    const active = deployments.filter((d) => d.isActive);
    expect(active).toHaveLength(1);
    expect(active.reduce((sum, d) => sum + d.trafficSplitPct, 0)).toBe(100);
  });
});
