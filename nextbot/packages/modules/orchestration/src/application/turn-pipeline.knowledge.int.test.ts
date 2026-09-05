import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { withTenant, schema, generateId } from "@nextbot/db";
import { eq } from "drizzle-orm";
import type * as AiRegistryModule from "@nextbot/ai-registry";
import type * as KnowledgeModule from "@nextbot/knowledge";
import { runTurnPipeline, type EgressPort } from "@nextbot/orchestration";
import { handleCreateDefinition, handleCreateVersion } from "@nextbot/agent-platform";
import type { AgentDefinitionArtifact } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 10 (BL-41, FR-KB-05/06/07, LLD §14.4.4) — THE
 * runtime-enforcement wiring test: proves `turn-pipeline.ts`'s own "reply" branch
 * correctly interprets the bounded retrieval agent's outcome and NEVER lets an
 * ungrounded answer reach the customer, regardless of what `runBoundedRetrieval`
 * (mocked here — its own real substance is exhaustively covered by
 * `packages/modules/knowledge/src/retrieval-agent.int.test.ts`'s real Postgres/Neo4j/
 * mock-model-server suite) reports. This file's own job is narrower and different:
 * confirm the ONE call site LLD §14.4.4 names actually wires the executor's decision
 * through correctly — never trusts `selection.replyText` for a knowledge-scoped
 * agent, never fabricates a fallback for a `Grounded` outcome, and degrades safely if
 * the executor itself throws.
 *
 * `resolveKnowledgeCollectionPin` is also mocked (to a fixed fake id) alongside
 * `runBoundedRetrieval` — this file is not exercising real collection-pin resolution
 * (`agent-definition-service.knowledge-config.int.test.ts` already does, against a
 * real collection row), only the turn pipeline's own runtime branch.
 */

const generateStructuredMock = vi.fn();
vi.mock("@nextbot/ai-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof AiRegistryModule>();
  return { ...actual, generateStructured: (...args: unknown[]) => generateStructuredMock(...args) };
});

const runBoundedRetrievalMock = vi.fn();
vi.mock("@nextbot/knowledge", async (importOriginal) => {
  const actual = await importOriginal<typeof KnowledgeModule>();
  return {
    ...actual,
    runBoundedRetrieval: (...args: unknown[]) => runBoundedRetrievalMock(...args),
    resolveKnowledgeCollectionPin: async () => ({ collectionId: "00000000-0000-0000-0000-000000000001", collectionName: "fake-collection" }),
  };
});

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  generateStructuredMock.mockReset();
  runBoundedRetrievalMock.mockReset();
});

function knowledgeScopedArtifact(): AgentDefinitionArtifact {
  return {
    apiVersion: "nextbot.io/v1",
    kind: "AgentDefinition",
    metadata: { name: "knowledge-turn-pipeline-test", version: "1.0.0" },
    spec: {
      graphType: "ADK",
      modelRoute: "chat.primary",
      instructions: "You are a retrieval-scoped test agent.",
      toolPolicy: { source: "agent-tool-registry", capabilityGroups: [], maxToolCallsPerTurn: 5 },
      guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: [] },
      memory: { strategy: "rolling-window", maxTurns: 20 },
      budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
      knowledge: {
        collections: ["fake_collection@1"],
        strategy: "auto",
        maxHops: 2,
        maxExpansions: 2,
        minCitations: 1,
        refuseWhenUngrounded: true,
        budget: { usdPerTurn: 0.02, seconds: 8 },
      },
    },
  };
}

async function createKnowledgeScopedVersion(ctx: Awaited<ReturnType<typeof createFixtureTenant>>): Promise<string> {
  const definition = await handleCreateDefinition(ctx, { name: `knowledge-turn-pipeline-${Math.random().toString(36).slice(2, 8)}` });
  const version = await handleCreateVersion(ctx, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", artifact: knowledgeScopedArtifact() }, generateId());
  return version.id;
}

async function domainEventTypes(ctx: Awaited<ReturnType<typeof createFixtureTenant>>): Promise<string[]> {
  return withTenant(ctx, async (db) => {
    const rows = await db.select().from(schema.domainEvent).where(eq(schema.domainEvent.tenantId, ctx.tenantId));
    return rows.map((r) => r.type);
  });
}

describe("runTurnPipeline — bounded retrieval agent wiring (Phase 10, real Postgres)", () => {
  it("THE runtime enforcement, at the one customer-facing call site: a Refused outcome NEVER reaches the customer as text — the fixed KNOWLEDGE_NOT_GROUNDED fallback is returned instead", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const versionId = await createKnowledgeScopedVersion(ctx);
    generateStructuredMock.mockResolvedValue({ action: "reply", replyText: "some canned reply the model produced", confidence: 0.9 });
    runBoundedRetrievalMock.mockResolvedValue({
      outcome: "Refused",
      answerText: null,
      citations: [],
      strategyUsed: "Vector",
      hops: 2,
      expansions: 1,
      latencyMs: 42,
      costUsd: "0.00001000",
      retrievalEventId: "evt-1",
    });

    const egress: EgressPort = { invokeTool: vi.fn() };
    const { payload } = await runTurnPipeline(ctx, { egress }, { customerText: "What is our refund policy?", agentDefinitionVersionId: versionId });

    expect(payload).toEqual({ contentType: "Error", reason: "KnowledgeNotGrounded", text: "I don't have a sourced answer for that — let me get a colleague to help." });
    // Never `selection.replyText`, regardless of what the model itself produced upstream.
    expect(JSON.stringify(payload)).not.toContain("some canned reply");
    expect(await domainEventTypes(ctx)).toEqual(["orchestration.turn.knowledge_not_grounded"]);
  });

  it("a Grounded outcome renders the executor's real answer + citations, never selection.replyText", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const versionId = await createKnowledgeScopedVersion(ctx);
    generateStructuredMock.mockResolvedValue({ action: "reply", replyText: "a different, un-grounded guess", confidence: 0.9 });
    const citation = { collectionId: "col1", collectionName: "Refund Policy", documentId: "doc1", documentTitle: "Policy", chunkId: "chunk1", snippet: "Refunds within 14 days." };
    runBoundedRetrievalMock.mockResolvedValue({
      outcome: "Grounded",
      answerText: "Refunds are processed within 14 days.",
      citations: [citation],
      strategyUsed: "Vector",
      hops: 2,
      expansions: 0,
      latencyMs: 30,
      costUsd: "0.00000500",
      retrievalEventId: "evt-2",
    });

    const egress: EgressPort = { invokeTool: vi.fn() };
    const { payload } = await runTurnPipeline(ctx, { egress }, { customerText: "What is our refund window?", agentDefinitionVersionId: versionId });

    expect(payload).toEqual({ contentType: "Text", text: "Refunds are processed within 14 days.", citations: [citation] });
  });

  it("runBoundedRetrieval is called with the raw customer text as the query, never the goal-selection model's own replyText guess", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const versionId = await createKnowledgeScopedVersion(ctx);
    generateStructuredMock.mockResolvedValue({ action: "reply", replyText: "irrelevant model guess", confidence: 0.9 });
    runBoundedRetrievalMock.mockResolvedValue({ outcome: "Grounded", answerText: "answer", citations: [], strategyUsed: "Vector", hops: 0, expansions: 0, latencyMs: 1, costUsd: "0", retrievalEventId: "evt-3" });

    const egress: EgressPort = { invokeTool: vi.fn() };
    await runTurnPipeline(ctx, { egress }, { customerText: "What is our refund window specifically?", agentDefinitionVersionId: versionId });

    expect(runBoundedRetrievalMock).toHaveBeenCalledTimes(1);
    const [, request] = runBoundedRetrievalMock.mock.calls[0] as [unknown, { query: string }];
    expect(request.query).toBe("What is our refund window specifically?");
  });

  it("degrades to the ordinary tool-call-failure fallback (never a thrown 500, never a fabricated answer) when the retrieval agent itself throws", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const versionId = await createKnowledgeScopedVersion(ctx);
    generateStructuredMock.mockResolvedValue({ action: "reply", replyText: "guess", confidence: 0.9 });
    runBoundedRetrievalMock.mockRejectedValue(new Error("KNOWLEDGE_GENERATION_NOT_READY"));

    const egress: EgressPort = { invokeTool: vi.fn() };
    const { payload } = await runTurnPipeline(ctx, { egress }, { customerText: "What is our refund window?", agentDefinitionVersionId: versionId });

    expect(payload).toMatchObject({ contentType: "Error", reason: "ToolCallFailure" });
    expect(await domainEventTypes(ctx)).toEqual(["orchestration.turn.knowledge_retrieval_error"]);
  });

  it("a version with NO spec.knowledge configured is completely unaffected — falls through to the ordinary selection.replyText path, never calling the retrieval agent", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    generateStructuredMock.mockResolvedValue({ action: "reply", replyText: "an ordinary canned reply", confidence: 0.9 });

    const egress: EgressPort = { invokeTool: vi.fn() };
    // No agentDefinitionVersionId at all — the most common pre-Phase-10 caller shape.
    const { payload } = await runTurnPipeline(ctx, { egress }, { customerText: "hello" });

    expect(payload).toEqual({ contentType: "Text", text: "an ordinary canned reply" });
    expect(runBoundedRetrievalMock).not.toHaveBeenCalled();
  });
});
