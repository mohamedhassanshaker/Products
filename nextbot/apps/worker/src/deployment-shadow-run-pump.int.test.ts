import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { generateId, schema, withTenant, type TenantContext } from "@nextbot/db";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { createWebWidgetChannel } from "@nextbot/channels";
import { deleteConversationsByIds, insertConversation, insertMessage } from "@nextbot/conversations";
import {
  getShadowEvaluation,
  getShadowEvaluationReport,
  getShadowRun,
  insertShadowRun,
  listShadowRuns,
  SHADOW_RUN_MAX_ATTEMPTS,
  maybeEnqueueShadowRun,
  shouldSampleForShadow,
  startShadowEvaluation,
  stopShadowEvaluationById,
  startAgentRun,
  completeAgentRun,
} from "@nextbot/agent-platform";
import type * as AiRegistryModule from "@nextbot/ai-registry";
import { runDeploymentShadowRunPump } from "./deployment-shadow-run-pump.js";
import { runDeploymentShadowLeaseReaper } from "./deployment-shadow-lease-reaper.js";

/**
 * Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.5, LLD §15.5/§15.9 item 11)
 * — the shadow replay's END-TO-END path through `apps/worker`, against a real Postgres.
 *
 * `deployment-shadow-containment.int.test.ts` proves the four side-effect containments at
 * the pipeline level with a real recording MCP server; this suite proves the durable
 * work-table machinery around them: enqueue sampling and ceilings, the claim/lease/reclaim
 * idiom, the stopped-experiment guard, and — the one ADR-0019 §4 specifically calls out —
 * `Skipped(SourceGone)` when the source conversation was purged between enqueue and replay.
 */

const generateStructuredMock = vi.fn();
vi.mock("@nextbot/ai-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof AiRegistryModule>();
  return { ...actual, generateStructured: (...args: unknown[]) => generateStructuredMock(...args) };
});

const createdTenantIds: string[] = [];
let ai: MockOpenAiServerHandle | undefined;

afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  await ai?.close();
  ai = undefined;
  generateStructuredMock.mockReset();
});

interface Fixture {
  ctx: TenantContext;
  agentDefinitionId: string;
  candidateVersionId: string;
  conversationId: string;
  liveMessageId: string;
  liveAgentRunId: string;
}

async function setUp(): Promise<Fixture> {
  ai = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "ok" }) });
  process.env.AI_PROVIDER = "openai-compatible";
  process.env.AI_BASE_URL = ai.url;
  process.env.AI_MODEL_CHAT_PRIMARY = "test-model";
  generateStructuredMock.mockResolvedValue({ action: "reply", replyText: "candidate answer", confidence: 0.95 });

  const ctx = await createFixtureTenant();
  createdTenantIds.push(ctx.tenantId);
  // `listActiveTenantContexts` (which every cross-tenant worker sweep iterates) only sees
  // `Active` tenants; the fixture defaults to `Trial`. Same one-liner every other
  // sweep-driven integration suite in this codebase uses.
  await withTenant(ctx, (db) => db.update(schema.tenant).set({ status: "Active" }).where(eq(schema.tenant.id, ctx.tenantId)));

  const { agentDefinitionId, versionId } = await seedDefinitionAndVersion(ctx);
  const channel = await createWebWidgetChannel(ctx, { name: "Widget", environment: "Sandbox" });
  const conversationId = await insertConversation(ctx, { channelId: channel.id, language: "en" });

  const customer = await insertMessage(ctx, {
    conversationId,
    sender: "Customer",
    contentType: "Text",
    payload: { contentType: "Text", text: "where is my order?" },
  });
  // The live turn's own run + reply, so the replay has a real thing to compare against.
  const { run, span } = await startAgentRun(ctx, { agentDefinitionVersionId: versionId, trigger: "CustomerMessage", conversationId });
  await completeAgentRun(ctx, run, span, { status: "Succeeded", durationMs: 120 });
  await insertMessage(ctx, {
    conversationId,
    sender: "AI",
    contentType: "Text",
    payload: { contentType: "Text", text: "it shipped yesterday" },
    agentRunId: run.id,
  });

  return { ctx, agentDefinitionId, candidateVersionId: versionId, conversationId, liveMessageId: customer.id, liveAgentRunId: run.id };
}

describe("shadow evaluation — enqueue sampling and hard ceilings (ADR-0019 §2.5)", () => {
  it("`shouldSampleForShadow` is deterministic and honours the configured percentage", () => {
    const runId = generateId();
    expect(shouldSampleForShadow(runId, 100)).toBe(true);
    expect(shouldSampleForShadow(runId, 0)).toBe(false);
    // Deterministic: the same run id always rolls the same way, so a spend-controlling
    // decision is reproducible rather than a coin flip.
    const at50 = shouldSampleForShadow(runId, 50);
    for (let i = 0; i < 20; i += 1) expect(shouldSampleForShadow(runId, 50)).toBe(at50);

    // And it genuinely samples: ~10% of 2000 ids at samplePct=10.
    let sampled = 0;
    for (let i = 0; i < 2000; i += 1) if (shouldSampleForShadow(`run-${i}`, 10)) sampled += 1;
    expect(sampled).toBeGreaterThan(140);
    expect(sampled).toBeLessThan(260);
  });

  it("enqueues nothing when no experiment is active — shadow evaluation is OFF BY DEFAULT", async () => {
    const f = await setUp();
    const enqueued = await maybeEnqueueShadowRun(f.ctx, {
      agentDefinitionId: f.agentDefinitionId,
      environment: "Production",
      conversationId: f.conversationId,
      liveAgentRunId: f.liveAgentRunId,
      liveMessageId: f.liveMessageId,
    });
    expect(enqueued).toBeNull();
  });

  it("enforces `max_runs` FOR REAL — a 2-run ceiling admits exactly two enqueues even under concurrency", async () => {
    const f = await setUp();
    const evaluation = await startShadowEvaluation(
      f.ctx,
      f.agentDefinitionId,
      { environment: "Production", candidateVersionId: f.candidateVersionId, samplePct: 100, maxRuns: 2, maxCostUsd: 100 },
      null,
    );

    // Fired concurrently on purpose: `tryClaimEnqueueSlot` is a conditional UPDATE, not a
    // read-then-write, precisely so N racing live turns cannot each observe "under the
    // cap" and collectively overshoot a real spend ceiling.
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        maybeEnqueueShadowRun(f.ctx, {
          agentDefinitionId: f.agentDefinitionId,
          environment: "Production",
          conversationId: f.conversationId,
          liveAgentRunId: f.liveAgentRunId,
          liveMessageId: f.liveMessageId,
        }),
      ),
    );

    expect(results.filter((r) => r !== null)).toHaveLength(2);
    expect((await getShadowEvaluation(f.ctx, evaluation.id))!.runsEnqueued).toBe(2);
    expect(await listShadowRuns(f.ctx, evaluation.id)).toHaveLength(2);
  });

  it("refuses a second concurrently-active experiment for the same (agent definition, environment)", async () => {
    const f = await setUp();
    await startShadowEvaluation(f.ctx, f.agentDefinitionId, { environment: "Production", candidateVersionId: f.candidateVersionId, samplePct: 100, maxRuns: 5, maxCostUsd: 1 }, null);
    await expect(
      startShadowEvaluation(f.ctx, f.agentDefinitionId, { environment: "Production", candidateVersionId: f.candidateVersionId, samplePct: 100, maxRuns: 5, maxCostUsd: 1 }, null),
    ).rejects.toMatchObject({ code: "SHADOW_EVALUATION_ALREADY_ACTIVE" });
  });

  it("two genuinely CONCURRENT starts leave exactly one active experiment — the partial unique index, not the pre-check, is the correctness mechanism", async () => {
    const f = await setUp();
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        startShadowEvaluation(f.ctx, f.agentDefinitionId, { environment: "Production", candidateVersionId: f.candidateVersionId, samplePct: 100, maxRuns: 5, maxCostUsd: 1 }, null),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    // Every loser surfaced the friendly 409, never a raw duplicate-key 500.
    for (const rejected of results.filter((r) => r.status === "rejected")) {
      expect((rejected as PromiseRejectedResult).reason).toMatchObject({ code: "SHADOW_EVALUATION_ALREADY_ACTIVE", httpStatus: 409 });
    }
  });

  it("rejects a candidate belonging to a DIFFERENT agent definition, checked against the version row rather than the request", async () => {
    const f = await setUp();
    const other = await seedDefinitionAndVersion(f.ctx);
    await expect(
      startShadowEvaluation(f.ctx, f.agentDefinitionId, { environment: "Production", candidateVersionId: other.versionId, samplePct: 100, maxRuns: 5, maxCostUsd: 1 }, null),
    ).rejects.toMatchObject({ code: "VERSION_NOT_IN_DEFINITION" });
  });

  it("allows a NON-Production candidate — the opposite of the canary rule, and deliberately so", async () => {
    const f = await setUp();
    // Shadow evaluation exists to gather evidence about a version BEFORE promoting it, and
    // it can reach no customer by construction, so gating it on the promotion gate would
    // defeat the feature while protecting nothing. (The canary traffic path enforces the
    // Production precondition for real — see `traffic-split-service.int.test.ts`.)
    const draftVersionId = await withTenant(f.ctx, async (db) => {
      const [row] = await db
        .update(schema.agentDefinitionVersion)
        .set({ status: "Draft" })
        .where(eq(schema.agentDefinitionVersion.id, f.candidateVersionId))
        .returning({ id: schema.agentDefinitionVersion.id });
      return row!.id;
    });
    const evaluation = await startShadowEvaluation(
      f.ctx,
      f.agentDefinitionId,
      { environment: "Production", candidateVersionId: draftVersionId, samplePct: 100, maxRuns: 5, maxCostUsd: 1 },
      null,
    );
    expect(evaluation.status).toBe("Active");
  });
});

describe("shadow evaluation — the comparison report (ADR-0019 §2.5: evidence, never a gate)", () => {
  it("reports null — not 0% — for every divergence figure until something has actually completed", async () => {
    const f = await setUp();
    const evaluation = await startShadowEvaluation(
      f.ctx,
      f.agentDefinitionId,
      { environment: "Production", candidateVersionId: f.candidateVersionId, samplePct: 100, maxRuns: 10, maxCostUsd: 100 },
      null,
    );
    const report = await getShadowEvaluationReport(f.ctx, evaluation.id);

    // "nothing measured yet" and "measured, and it was zero" are very different claims.
    expect(report).toMatchObject({ completedRuns: 0, skippedRuns: 0, failedRuns: 0, replyDivergencePct: null, toolCallDivergencePct: null, escalationRatePct: null, p50Ms: null, p95Ms: null });
    expect(report.totalCostUsd).toBe(0);
  });

  it("counts reply divergence against the live side and reports real percentiles once runs complete", async () => {
    const f = await setUp();
    const evaluation = await startShadowEvaluation(
      f.ctx,
      f.agentDefinitionId,
      { environment: "Production", candidateVersionId: f.candidateVersionId, samplePct: 100, maxRuns: 10, maxCostUsd: 100 },
      null,
    );
    await maybeEnqueueShadowRun(f.ctx, {
      agentDefinitionId: f.agentDefinitionId,
      environment: "Production",
      conversationId: f.conversationId,
      liveAgentRunId: f.liveAgentRunId,
      liveMessageId: f.liveMessageId,
    });
    await runDeploymentShadowRunPump();

    const report = await getShadowEvaluationReport(f.ctx, evaluation.id);
    expect(report.completedRuns).toBe(1);
    // The candidate ("candidate answer") differs from the live reply ("it shipped
    // yesterday"), so divergence is a measured 100% rather than null.
    expect(report.replyDivergencePct).toBe(100);
    // Neither side made a tool call, so there is no divergence there.
    expect(report.toolCallDivergencePct).toBe(0);
    expect(report.escalationRatePct).toBe(0);
    expect(report.p50Ms).not.toBeNull();
    expect(report.p95Ms).not.toBeNull();
  });

  it("404s for an unknown evaluation id rather than returning an empty report", async () => {
    const f = await setUp();
    await expect(getShadowEvaluationReport(f.ctx, generateId())).rejects.toMatchObject({ code: "SHADOW_EVALUATION_NOT_FOUND", httpStatus: 404 });
  });
});

describe("deployment.shadow-run-pump — the durable replay (ADR-0019 §2.5, LLD §15.5)", () => {
  it("replays a pending run through the REAL turn pipeline and records the comparison, with no customer-visible side effect", async () => {
    const f = await setUp();
    const evaluation = await startShadowEvaluation(
      f.ctx,
      f.agentDefinitionId,
      { environment: "Production", candidateVersionId: f.candidateVersionId, samplePct: 100, maxRuns: 10, maxCostUsd: 100 },
      null,
    );
    const enqueued = await maybeEnqueueShadowRun(f.ctx, {
      agentDefinitionId: f.agentDefinitionId,
      environment: "Production",
      conversationId: f.conversationId,
      liveAgentRunId: f.liveAgentRunId,
      liveMessageId: f.liveMessageId,
    });
    expect(enqueued).not.toBeNull();

    const messagesBefore = await countMessages(f.ctx, f.conversationId);
    const result = await runDeploymentShadowRunPump();
    expect(result.completed).toBeGreaterThanOrEqual(1);

    const run = await getShadowRun(f.ctx, enqueued!.id);
    expect(run).toMatchObject({ status: "Completed" });
    expect(run!.shadowAgentRunId).toBeTruthy();
    expect(run!.replyText).toBe("candidate answer");
    // The live side of the comparison was captured at replay time — a hash and a count,
    // never a copy of the customer's text.
    expect(run!.liveReplyPayloadHash).toBeTruthy();
    expect(run!.liveToolCallCount).toBe(0);
    expect(run!.replyPayloadHash).not.toBe(run!.liveReplyPayloadHash);

    // Its `agent_run` is stamped so every reporting aggregate excludes it...
    const shadowAgentRun = await withTenant(f.ctx, async (db) => (await db.select().from(schema.agentRun).where(eq(schema.agentRun.id, run!.shadowAgentRunId!)))[0]);
    expect(shadowAgentRun!.trigger).toBe("ShadowEvaluation");

    // ...and NO customer-visible artefact was produced. The pump has no import path to
    // `insertMessage`, the SSE bus, or `triggerEscalation` at all (enforced by
    // `eslint.config.mjs`'s `no-restricted-imports` block on this file's siblings).
    expect(await countMessages(f.ctx, f.conversationId)).toBe(messagesBefore);
    expect(await countRows(f.ctx, "escalation")).toBe(0);

    // The parent experiment's counters advanced.
    expect((await getShadowEvaluation(f.ctx, evaluation.id))!.runsCompleted).toBe(1);
  });

  it("**LLD §15.9 item 11 (purge safety)** — a run whose source conversation was purged terminates `Skipped(SourceGone)`, never an error and never by resurrecting purged content", async () => {
    const f = await setUp();
    const evaluation = await startShadowEvaluation(
      f.ctx,
      f.agentDefinitionId,
      { environment: "Production", candidateVersionId: f.candidateVersionId, samplePct: 100, maxRuns: 10, maxCostUsd: 100 },
      null,
    );
    const enqueued = await maybeEnqueueShadowRun(f.ctx, {
      agentDefinitionId: f.agentDefinitionId,
      environment: "Production",
      conversationId: f.conversationId,
      liveAgentRunId: f.liveAgentRunId,
      liveMessageId: f.liveMessageId,
    });

    // A real retention/DSR purge, through the real deletion path — exactly the race
    // ADR-0019 §4 flags as a consequence of storing pointers instead of a transcript copy.
    await deleteConversationsByIds(f.ctx, [f.conversationId]);

    const result = await runDeploymentShadowRunPump();
    expect(result.failed).toBe(0);
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    const run = await getShadowRun(f.ctx, enqueued!.id);
    expect(run).toMatchObject({ status: "Skipped", skipReason: "SourceGone" });
    // Nothing was fabricated in place of the purged content.
    expect(run!.replyText).toBeNull();
    expect(run!.shadowAgentRunId).toBeNull();
    expect(evaluation.id).toBeTruthy();
  });

  it("a run enqueued before the experiment was stopped terminates `Skipped(EvaluationStopped)` rather than spending more of a stopped experiment's budget", async () => {
    const f = await setUp();
    const evaluation = await startShadowEvaluation(
      f.ctx,
      f.agentDefinitionId,
      { environment: "Production", candidateVersionId: f.candidateVersionId, samplePct: 100, maxRuns: 10, maxCostUsd: 100 },
      null,
    );
    const enqueued = await maybeEnqueueShadowRun(f.ctx, {
      agentDefinitionId: f.agentDefinitionId,
      environment: "Production",
      conversationId: f.conversationId,
      liveAgentRunId: f.liveAgentRunId,
      liveMessageId: f.liveMessageId,
    });

    await stopShadowEvaluationById(f.ctx, evaluation.id, "changed my mind", null);

    await runDeploymentShadowRunPump();
    expect(await getShadowRun(f.ctx, enqueued!.id)).toMatchObject({ status: "Skipped", skipReason: "EvaluationStopped" });
  });

  it("**a saturated tenant DEFERS the shadow run rather than failing it** — a shadow experiment must never be able to 429 a real customer", async () => {
    const f = await setUp();
    // A REAL saturation, not a mocked one: `tenant_runtime_quota.max_concurrent_runs = 0`
    // makes the very first `claimConcurrentRunSlot` throw `QuotaExceededError` through the
    // genuine Redis-backed gauge, which is exactly the condition a busy tenant produces.
    await withTenant(f.ctx, (db) =>
      db.update(schema.tenantRuntimeQuota).set({ maxConcurrentRuns: 0 }).where(eq(schema.tenantRuntimeQuota.tenantId, f.ctx.tenantId)),
    );

    const evaluation = await startShadowEvaluation(
      f.ctx,
      f.agentDefinitionId,
      { environment: "Production", candidateVersionId: f.candidateVersionId, samplePct: 100, maxRuns: 10, maxCostUsd: 100 },
      null,
    );
    const enqueued = await maybeEnqueueShadowRun(f.ctx, {
      agentDefinitionId: f.agentDefinitionId,
      environment: "Production",
      conversationId: f.conversationId,
      liveAgentRunId: f.liveAgentRunId,
      liveMessageId: f.liveMessageId,
    });

    const first = await runDeploymentShadowRunPump();
    expect(first.deferred).toBeGreaterThanOrEqual(1);
    expect(first.failed).toBe(0);
    // Back to `Pending` and unleased, so a later tick can retry it.
    expect(await getShadowRun(f.ctx, enqueued!.id)).toMatchObject({ status: "Pending", leaseOwner: null });
    // Nothing was attributed for a run that never executed.
    expect((await getShadowEvaluation(f.ctx, evaluation.id))!.runsCompleted).toBe(0);

    // Deferral is bounded: after `SHADOW_RUN_MAX_ATTEMPTS` the row is Skipped rather than
    // accumulating an unbounded backlog against a permanently saturated tenant.
    for (let i = 0; i < SHADOW_RUN_MAX_ATTEMPTS + 1; i += 1) await runDeploymentShadowRunPump();
    expect(await getShadowRun(f.ctx, enqueued!.id)).toMatchObject({ status: "Skipped", skipReason: "QuotaDeferredTooLong" });
  });

  it("replays a QuickReply-triggered turn using the same text extraction the live turn used", async () => {
    const f = await setUp();
    const evaluation = await startShadowEvaluation(
      f.ctx,
      f.agentDefinitionId,
      { environment: "Production", candidateVersionId: f.candidateVersionId, samplePct: 100, maxRuns: 10, maxCostUsd: 100 },
      null,
    );
    // A chip selection, not free text — the replay must feed the pipeline the chip's
    // LABEL, exactly as `turn-pipeline-adapter.ts` does on the live path, or the candidate
    // would be answering a different question than production answered.
    const chipMessage = await insertMessage(f.ctx, {
      conversationId: f.conversationId,
      sender: "Customer",
      contentType: "QuickReply",
      payload: { contentType: "QuickReply", text: "Pick one", chips: [{ id: "c1", label: "Track my order" }], selectedChipId: "c1" },
    });
    const enqueued = await insertShadowRun(f.ctx, {
      shadowEvaluationId: evaluation.id,
      conversationId: f.conversationId,
      liveAgentRunId: f.liveAgentRunId,
      liveMessageId: chipMessage.id,
      candidateVersionId: f.candidateVersionId,
    });

    await runDeploymentShadowRunPump();

    expect(await getShadowRun(f.ctx, enqueued.id)).toMatchObject({ status: "Completed" });
    expect(generateStructuredMock).toHaveBeenCalledWith(expect.objectContaining({ messages: [{ role: "user", content: "Track my order" }] }));
  });

  it("terminates a run whose source message carries no usable customer text as `Skipped(SourceGone)` rather than replaying an empty turn", async () => {
    const f = await setUp();
    const evaluation = await startShadowEvaluation(
      f.ctx,
      f.agentDefinitionId,
      { environment: "Production", candidateVersionId: f.candidateVersionId, samplePct: 100, maxRuns: 10, maxCostUsd: 100 },
      null,
    );
    const emptyForm = await insertMessage(f.ctx, {
      conversationId: f.conversationId,
      sender: "Customer",
      contentType: "Form",
      payload: { contentType: "Form", formId: "f1", fields: [], values: {} },
    });
    const enqueued = await insertShadowRun(f.ctx, {
      shadowEvaluationId: evaluation.id,
      conversationId: f.conversationId,
      liveAgentRunId: f.liveAgentRunId,
      liveMessageId: emptyForm.id,
      candidateVersionId: f.candidateVersionId,
    });

    const result = await runDeploymentShadowRunPump();
    expect(result.failed).toBe(0);
    expect(await getShadowRun(f.ctx, enqueued.id)).toMatchObject({ status: "Skipped", skipReason: "SourceGone" });
  });

  it("the lease reaper returns a stranded `Claimed` run to `Pending` so a crashed replica can never strand it forever", async () => {
    const f = await setUp();
    const evaluation = await startShadowEvaluation(
      f.ctx,
      f.agentDefinitionId,
      { environment: "Production", candidateVersionId: f.candidateVersionId, samplePct: 100, maxRuns: 10, maxCostUsd: 100 },
      null,
    );
    const run = await insertShadowRun(f.ctx, {
      shadowEvaluationId: evaluation.id,
      conversationId: f.conversationId,
      liveAgentRunId: f.liveAgentRunId,
      liveMessageId: f.liveMessageId,
      candidateVersionId: f.candidateVersionId,
    });

    // Simulate a replica that claimed the row and then died: `Claimed` with an already
    // expired lease.
    await withTenant(f.ctx, async (db) => {
      await db
        .update(schema.shadowRun)
        .set({ status: "Claimed", leaseOwner: "worker-that-crashed", leaseExpiresAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.shadowRun.id, run.id));
    });

    const reaped = await runDeploymentShadowLeaseReaper();
    expect(reaped.reclaimed).toBeGreaterThanOrEqual(1);
    expect(await getShadowRun(f.ctx, run.id)).toMatchObject({ status: "Pending", leaseOwner: null, leaseExpiresAt: null });
  });
});

async function countMessages(ctx: TenantContext, conversationId: string): Promise<number> {
  return withTenant(ctx, async (db) => (await db.select().from(schema.message).where(eq(schema.message.conversationId, conversationId))).length);
}

async function countRows(ctx: TenantContext, table: "escalation"): Promise<number> {
  return withTenant(ctx, async (db) => (await db.select().from(schema[table]).where(eq(schema[table].tenantId, ctx.tenantId))).length);
}

/** A minimal real definition+version written directly — this suite is about the work
 *  table, not about the promotion gate (which `traffic-split-service.int.test.ts` covers
 *  against the real gate). */
async function seedDefinitionAndVersion(ctx: TenantContext): Promise<{ agentDefinitionId: string; versionId: string }> {
  return withTenant(ctx, async (db) => {
    const agentDefinitionId = generateId();
    const versionId = generateId();
    const routeId = generateId();
    const routeVersionId = generateId();
    await db.insert(schema.agentDefinition).values({ id: agentDefinitionId, tenantId: ctx.tenantId, name: `shadow-pump-${agentDefinitionId.slice(0, 8)}-${crypto.randomUUID().slice(0, 8)}` });
    await db.insert(schema.modelRoute).values({ id: routeId, tenantId: ctx.tenantId, name: `chat.primary.${routeId.slice(0, 8)}-${crypto.randomUUID().slice(0, 8)}` });
    await db.insert(schema.modelRouteVersion).values({
      id: routeVersionId,
      tenantId: ctx.tenantId,
      routeId,
      version: 1,
      chainJson: { hops: [] } as never,
      policyJson: {} as never,
      advertisedCapabilities: {} as never,
      strictestDataHandling: { retainsPrompts: false, trainsOnData: false },
      createdByUserId: null,
    });
    await db.insert(schema.agentDefinitionVersion).values({
      id: versionId,
      tenantId: ctx.tenantId,
      agentDefinitionId,
      version: "1.0.0",
      graphType: "CustomFSM",
      status: "Production",
      definitionYaml: "kind: AgentDefinition",
      definitionHash: "sha256:fixture",
      modelRouteKey: "chat.primary",
      modelRouteVersionId: routeVersionId,
    });
    return { agentDefinitionId, versionId };
  });
}
