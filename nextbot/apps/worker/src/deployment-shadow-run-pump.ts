import { createHash } from "node:crypto";
import { listActiveTenantContexts, claimConcurrentRunSlot } from "@nextbot/tenancy";
import { QuotaExceededError, type MessagePayload } from "@nextbot/contracts";
import {
  claimDueShadowRuns,
  completeShadowRun,
  deferShadowRun,
  failShadowRun,
  getAgentRun,
  getShadowEvaluation,
  recordShadowSpendAndMaybeAutoStop,
  skipShadowRun,
  SHADOW_RUN_MAX_ATTEMPTS,
  type ShadowRunRow,
} from "@nextbot/agent-platform";
import { findMessageById, listMessagesUpToSequence, listMessagesSince } from "@nextbot/conversations";
import { countToolCallsForAgentRun, runTurnPipeline } from "@nextbot/orchestration";
import { listEnabledGuardrailRules } from "@nextbot/pii";
import type { TenantContext } from "@nextbot/db";
import { createShadowEgressPort } from "./lib/shadow-egress.js";

/**
 * **`deployment.shadow-run-pump`** — shadow evaluation's executor (Target Architecture
 * Blueprint Phase 17, BL-48, ADR-0019 §2.5, LLD §15.5).
 *
 * Drains the `shadow_run` work table using the `knowledge_ingestion_job` /
 * `claimDueJobs()` / `reclaimExpiredLeases()` claim-lease-reclaim idiom (Phase 7b,
 * QA-approved) — `FOR UPDATE SKIP LOCKED`, `lease_owner` + `lease_expires_at`, an
 * `attempts` counter — which ADR-0013 §7 established as this codebase's durable-executor
 * pattern. 5s tick, mirroring `knowledge.ingestion-pump` and `workflow.run-pump`.
 *
 * **Asynchronous replay, not a synchronous dual-run.** ADR-0019 §2.5 rejected running the
 * candidate inside the customer's own turn: it would double the NFR-2 latency exposure and
 * the failure surface of the live path, consume two `tenant_runtime_quota` concurrent slots
 * per turn (so enabling an experiment could 429 real customers), and turn a shadow bug into
 * a live-path bug.
 *
 * ---
 *
 * **Why this file lives in `apps/worker` rather than inside a module.** The replay crosses
 * three modules — `agent-platform` (the work table), `conversations` (the transcript the
 * pointers dereference to) and `orchestration` (the real pipeline) — and LLD §14.1's
 * allow-list gives no single module all three edges. A composition root is the only legal
 * home, exactly as it is for `apps/gateway`'s `turn-pipeline-adapter.ts`.
 *
 * **The "no customer exposure" containment is structural here, not conventional.** This
 * file never calls `insertMessage`, never publishes an SSE event and never calls
 * `triggerEscalation` — and that is *enforced*, not merely true today:
 * `eslint.config.mjs` carries a `no-restricted-imports` block scoped to
 * `apps/worker/src/deployment-shadow-*.ts` and `apps/worker/src/lib/shadow-egress.ts`
 * which forbids `@nextbot/escalations` outright, forbids the `insertMessage` /
 * `publishConversationEvent` named imports, and forbids `createMcpEgressPort` and
 * `@nextbot/mcp-client`'s networking exports. A future edit that tried to add any of them
 * fails the lint gate rather than shipping — the same "make the property structural"
 * approach this project adopted for ADR-0004's egress choke point.
 */

/** How many shadow runs one tenant may have in flight per tick. Deliberately small: a
 *  shadow experiment is background evidence-gathering and must never contend with real
 *  customer traffic for the tenant's concurrency budget. */
const MAX_SHADOW_RUNS_PER_TENANT_PER_TICK = 2;

/** Lease TTL. Comfortably longer than a turn's own 20s pipeline timeout, so a healthy
 *  replay never has its lease reaped out from under it, and short enough that a crashed
 *  replica's row is retryable within a couple of reaper ticks. */
const SHADOW_LEASE_SECONDS = 120;

export interface ShadowPumpResult {
  tenantsChecked: number;
  claimed: number;
  completed: number;
  skipped: number;
  deferred: number;
  failed: number;
}

/**
 * One pump tick across every active tenant.
 *
 * Per-tenant so `withTenant`'s RLS holds for every claim, read and write — the same
 * instruction `pumpIngestionJobs` follows. One tenant's (or one run's) failure never stops
 * the pump for the rest: a shadow run is evidence, never an obligation.
 */
export async function runDeploymentShadowRunPump(): Promise<ShadowPumpResult> {
  const leaseOwner = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const tenants = await listActiveTenantContexts();
  const result: ShadowPumpResult = { tenantsChecked: tenants.length, claimed: 0, completed: 0, skipped: 0, deferred: 0, failed: 0 };

  for (const ctx of tenants) {
    let runs: ShadowRunRow[];
    try {
      runs = await claimDueShadowRuns(ctx, MAX_SHADOW_RUNS_PER_TENANT_PER_TICK, leaseOwner, SHADOW_LEASE_SECONDS);
    } catch (err) {
      console.error(`NextBot worker: shadow-run claim failed for tenant "${ctx.tenantId}"`, err);
      continue;
    }
    result.claimed += runs.length;

    for (const run of runs) {
      try {
        const outcome = await executeShadowRun(ctx, run);
        result[outcome] += 1;
      } catch (err) {
        result.failed += 1;
        await failShadowRun(ctx, run.id, { code: "SHADOW_REPLAY_FAILED", message: err instanceof Error ? err.message : String(err) }).catch((e) =>
          console.error("NextBot worker: failed to record shadow-run failure", e),
        );
      }
    }
  }
  return result;
}

/**
 * Executes one claimed replay.
 *
 * @returns which terminal bucket the run landed in, for the tick's summary.
 */
async function executeShadowRun(ctx: TenantContext, run: ShadowRunRow): Promise<"completed" | "skipped" | "deferred" | "failed"> {
  // 1. The experiment may have been stopped (by an admin, or auto-stopped by a ceiling)
  //    between enqueue and now. Spending more of a stopped experiment's budget would make
  //    "stop" not mean stop.
  const evaluation = await getShadowEvaluation(ctx, run.shadowEvaluationId);
  if (!evaluation || evaluation.status !== "Active") {
    await skipShadowRun(ctx, run.id, "EvaluationStopped");
    return "skipped";
  }

  // 2. Dereference the pointers. `shadow_run` deliberately stores no transcript copy
  //    (ADR-0019 §2.5 item 2 — no new PII sink), so the source may legitimately be gone:
  //    a retention purge or a DSR erasure between enqueue and now. That is
  //    `Skipped(SourceGone)`, never an error and never a resurrection of purged content.
  const liveMessage = await findMessageById(ctx, run.conversationId, run.liveMessageId);
  if (!liveMessage) {
    await skipShadowRun(ctx, run.id, "SourceGone");
    return "skipped";
  }
  const history = await listMessagesUpToSequence(ctx, run.conversationId, liveMessage.sequence);
  const customerText = extractCustomerText(liveMessage.payload as unknown as MessagePayload);
  if (customerText.length === 0 || history.length === 0) {
    await skipShadowRun(ctx, run.id, "SourceGone");
    return "skipped";
  }

  // 3. The live side of the comparison, captured now while the conversation still exists.
  //    A hash and a count, never the customer's text — so this adds no PII surface.
  const liveReply = (await listMessagesSince(ctx, run.conversationId, liveMessage.sequence)).find((m) => m.sender === "AI") ?? null;
  const liveReplyPayloadHash = liveReply ? hashPayload(liveReply.payload) : null;
  const liveToolCallCount = await countToolCallsForAgentRun(ctx, run.liveAgentRunId);

  // 4. Claim a concurrency slot exactly like any other run — a shadow run is real load on
  //    real providers. `QuotaExceededError` is treated as "defer to the next tick", never
  //    as a failure: a shadow experiment must never be able to 429 a real customer, and it
  //    must never consume its own retry budget losing a race it was always going to lose.
  //    After `SHADOW_RUN_MAX_ATTEMPTS` deferrals the row is skipped rather than deferred
  //    forever, so a permanently saturated tenant does not accumulate an unbounded backlog.
  let releaseQuotaSlot: (() => Promise<void>) | null = null;
  try {
    releaseQuotaSlot = await claimConcurrentRunSlot(ctx);
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      if (run.attempts >= SHADOW_RUN_MAX_ATTEMPTS) {
        await skipShadowRun(ctx, run.id, "QuotaDeferredTooLong");
        return "skipped";
      }
      await deferShadowRun(ctx, run.id);
      return "deferred";
    }
    throw err;
  }

  const startedAt = Date.now();
  try {
    // 5. The REAL pipeline, with the REAL candidate version, against the REAL conversation
    //    — under `executionMode: "Shadow"` and behind the non-executing egress port. Every
    //    containment lives on the other side of this call (see `createShadowEgressPort`
    //    and `runTierEngine`'s `ShadowSuppressed` outcome); nothing here has to remember
    //    to avoid a side effect, because nothing here can cause one.
    const dbGuardrailRules = await listEnabledGuardrailRules(ctx);
    const guardrailRules = dbGuardrailRules
      .filter((r) => r.conditions.toolName)
      .map((r) => ({ id: r.id, toolName: r.conditions.toolName!, effect: r.effect, reason: r.reason }));

    const result = await runTurnPipeline(
      ctx,
      { egress: createShadowEgressPort(ctx) },
      {
        customerText,
        conversationId: run.conversationId,
        guardrailRules,
        agentDefinitionVersionId: run.candidateVersionId,
        executionMode: "Shadow",
      },
    );

    // 6. Attribute the candidate's real spend. `agent_run.cost_usd` is written by the
    //    pipeline's own tracing; re-reading it here is what keeps the experiment's
    //    `spend_usd` honest rather than estimated, and is what auto-stops the experiment
    //    once `max_cost_usd` is reached.
    const shadowRunRecord = result.runId ? await getAgentRun(ctx, result.runId) : null;
    const costUsd = shadowRunRecord?.costUsd ?? null;

    await completeShadowRun(ctx, run.id, {
      shadowAgentRunId: result.runId,
      durationMs: Date.now() - startedAt,
      costUsd,
      tokensIn: shadowRunRecord?.tokensIn ?? null,
      tokensOut: shadowRunRecord?.tokensOut ?? null,
      replyText: renderReplyText(result.payload),
      replyPayloadHash: hashPayload(result.payload as unknown as Record<string, unknown>),
      liveReplyPayloadHash,
      liveToolCallCount,
      wouldHaveToolCalls: result.shadowObservations?.wouldHaveToolCalls ?? [],
      // Captured as DATA. The worker does not — and, per the lint block on this file,
      // cannot — call `triggerEscalation`.
      escalationSignal: result.escalationSignal,
      guardrailOutcome: result.shadowObservations?.guardrailOutcome ?? null,
    });
    await recordShadowSpendAndMaybeAutoStop(ctx, run.shadowEvaluationId, costUsd ?? "0");
    return "completed";
  } finally {
    await releaseQuotaSlot();
  }
}

/** Stable hash of a rendered payload, for cheap divergence counting without storing or
 *  re-reading the text on either side. */
function hashPayload(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/** The candidate's reply, flattened for the reviewer's per-run drilldown. Only ever the
 *  CANDIDATE's own generated text — never the customer's message and never the live
 *  reply — so `shadow_run` still holds no copy of customer-authored content. */
function renderReplyText(payload: MessagePayload): string | null {
  if (payload.contentType === "Text") return payload.text;
  return JSON.stringify(payload);
}

/** Mirrors `apps/gateway`'s `turn-pipeline-adapter.ts` extraction so a replay feeds the
 *  pipeline exactly what the live turn fed it. Kept as a local copy rather than exported
 *  from `conversations`/`orchestration` because it is a four-case switch over a contract
 *  type, and neither module owns it today; if a third caller appears it should move to
 *  `@nextbot/contracts` rather than be copied again. */
function extractCustomerText(payload: MessagePayload): string {
  switch (payload.contentType) {
    case "Text":
      return payload.text;
    case "QuickReply": {
      const chip = payload.chips.find((c) => c.id === payload.selectedChipId);
      return chip ? chip.label : (payload.text ?? "");
    }
    case "List": {
      const item = payload.items.find((i) => i.id === payload.selectedItemId);
      return item ? item.label : (payload.title ?? "");
    }
    case "Form":
      return Object.values(payload.values ?? {}).join(" ");
    default:
      return "";
  }
}
