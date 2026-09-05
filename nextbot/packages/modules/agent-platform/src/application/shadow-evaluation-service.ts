import { createHash } from "node:crypto";
import type { TenantContext } from "@nextbot/db";
import {
  ShadowEvaluationAlreadyActiveError,
  ShadowEvaluationNotFoundError,
  VersionNotInDefinitionError,
} from "@nextbot/contracts";
import { getAgentDefinitionVersion } from "../infrastructure/agent-definition-repository.js";
import {
  findActiveShadowEvaluation,
  getShadowEvaluation,
  insertShadowEvaluation,
  insertShadowRun,
  listShadowEvaluations,
  listShadowRuns,
  stopShadowEvaluation,
  tryClaimEnqueueSlot,
  type ShadowEvaluationRow,
  type ShadowRunRow,
} from "../infrastructure/shadow-evaluation-repository.js";

/**
 * Shadow evaluation's application layer (Target Architecture Blueprint Phase 17, BL-48,
 * ADR-0019 §2.5, LLD §15.5).
 *
 * What lives here: starting/stopping an experiment, the enqueue decision made on the live
 * turn's path, and the aggregate comparison report. What deliberately does **not** live
 * here: the replay itself. The replay crosses `agent-platform` (this work table),
 * `conversations` (the transcript read) and `orchestration` (the real turn pipeline), and
 * LLD §14.1's allow-list gives no single module all three edges — so it lives in the
 * composition root (`apps/worker/src/deployment-shadow-run-pump.ts`), for the same reason
 * `turn-pipeline-adapter.ts` lives in `apps/gateway`.
 */

/**
 * Starts an experiment. Off-by-default is the schema's own doing (no row = no shadowing);
 * this is the only way one comes into existence.
 *
 * @throws {ShadowEvaluationAlreadyActiveError} one is already running for this
 *   `(agent definition, environment)` — surfaced as a friendly 409 rather than letting
 *   migration `0084`'s partial unique index raise a raw duplicate-key 500.
 * @throws {VersionNotInDefinitionError} the candidate belongs to a different agent
 *   definition than the route path scopes this call to.
 */
export async function startShadowEvaluation(
  ctx: TenantContext,
  agentDefinitionId: string,
  input: {
    environment: "Sandbox" | "Staging" | "Production";
    candidateVersionId: string;
    samplePct: number;
    maxRuns: number;
    maxCostUsd: number;
  },
  actorUserId: string | null,
): Promise<ShadowEvaluationRow> {
  const candidate = await getAgentDefinitionVersion(ctx, input.candidateVersionId);
  if (candidate.agentDefinitionId !== agentDefinitionId) {
    throw new VersionNotInDefinitionError(input.candidateVersionId);
  }
  // Deliberately NOT gated on the candidate holding `Production` status. Shadow
  // evaluation exists precisely to gather evidence about a version *before* deciding to
  // promote it, and it can reach no customer by construction (ADR-0019 §2.5's four
  // containments) — so requiring the promotion gate first would defeat the feature while
  // protecting nothing. The canary traffic path is where the Production precondition
  // genuinely matters, and it enforces it (`traffic-split-service.ts`).
  const existing = await findActiveShadowEvaluation(ctx, agentDefinitionId, input.environment);
  if (existing) throw new ShadowEvaluationAlreadyActiveError();

  try {
    return await insertShadowEvaluation(ctx, {
      agentDefinitionId,
      environment: input.environment,
      candidateVersionId: input.candidateVersionId,
      samplePct: input.samplePct,
      maxRuns: input.maxRuns,
      maxCostUsd: input.maxCostUsd.toFixed(4),
      createdByUserId: actorUserId,
    });
  } catch (err) {
    // The pre-check above is a fast path for the sequential case; the partial unique index
    // is the actual correctness mechanism against two concurrent starts (the same
    // insert-then-catch discipline `insertMessage` uses for `clientMessageId`).
    if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505") {
      throw new ShadowEvaluationAlreadyActiveError();
    }
    throw err;
  }
}

/** Stops a running experiment. Idempotent by predicate (the repository's `UPDATE` only
 *  matches an `Active` row), so a double-click cannot overwrite the original stop reason. */
export async function stopShadowEvaluationById(ctx: TenantContext, id: string, reason: string, actorUserId: string | null): Promise<void> {
  const evaluation = await getShadowEvaluation(ctx, id);
  if (!evaluation) throw new ShadowEvaluationNotFoundError(id);
  await stopShadowEvaluation(ctx, id, { status: "Stopped", stopReason: reason.trim(), stoppedByUserId: actorUserId });
}

/**
 * The sampling roll (ADR-0019 §2.5 step 1).
 *
 * Deterministic on the live run id rather than `Math.random()`, for the same reasons the
 * traffic-split bucket is: reproducible in tests, and stable if the same live turn is ever
 * re-examined. `sample_pct = 100` always samples; `sample_pct = 1` samples ~1%.
 *
 * Exported for direct unit testing — the distribution of a spend-controlling roll is worth
 * pinning rather than trusting.
 */
export function shouldSampleForShadow(liveAgentRunId: string, samplePct: number): boolean {
  if (samplePct >= 100) return true;
  if (samplePct <= 0) return false;
  const digest = createHash("sha256").update(`shadow:${liveAgentRunId}`).digest("hex");
  return parseInt(digest.slice(0, 8), 16) % 100 < samplePct;
}

/**
 * Called from the composition root **after** the customer's reply has already been
 * computed, inside the same best-effort `try/catch` idiom `triggerEscalation` and
 * `recordSandboxTest` already use: a bookkeeping failure here must never mask a reply the
 * customer is waiting on.
 *
 * Enqueues nothing unless (a) an `Active` experiment exists for this
 * `(agent definition, environment)`, (b) the deterministic sampling roll passes, and
 * (c) `tryClaimEnqueueSlot` atomically wins a slot under the `max_runs`/`max_cost_usd`
 * ceilings. (c) is a conditional `UPDATE`, not a read-then-write, so N concurrent live
 * turns cannot each observe "under the cap" and collectively overshoot it.
 *
 * @returns the enqueued row, or `null` when any of the three conditions declined.
 */
export async function maybeEnqueueShadowRun(
  ctx: TenantContext,
  input: {
    agentDefinitionId: string;
    environment: "Sandbox" | "Staging" | "Production";
    conversationId: string;
    liveAgentRunId: string;
    liveMessageId: string;
  },
): Promise<ShadowRunRow | null> {
  const evaluation = await findActiveShadowEvaluation(ctx, input.agentDefinitionId, input.environment);
  if (!evaluation) return null;
  if (!shouldSampleForShadow(input.liveAgentRunId, evaluation.samplePct)) return null;
  if (!(await tryClaimEnqueueSlot(ctx, evaluation.id))) return null;

  return insertShadowRun(ctx, {
    shadowEvaluationId: evaluation.id,
    conversationId: input.conversationId,
    liveAgentRunId: input.liveAgentRunId,
    liveMessageId: input.liveMessageId,
    candidateVersionId: evaluation.candidateVersionId,
  });
}

/** The aggregate comparison a reviewer reads (LLD §15.7's GET-by-id response). */
export interface ShadowEvaluationReport {
  evaluation: ShadowEvaluationRow;
  completedRuns: number;
  skippedRuns: number;
  failedRuns: number;
  /** Share of completed runs whose candidate reply differed from the live reply, compared
   *  by the two hashes both captured at replay time. */
  replyDivergencePct: number | null;
  /** Share of completed runs where the candidate's INTENDED tool-call count differed from
   *  what the live turn actually did. Counted from recorded intents on the candidate side,
   *  never from a real execution — none happened, by construction. */
  toolCallDivergencePct: number | null;
  /** Share of completed runs where the candidate would have escalated. Reported so a
   *  reviewer can see an escalation-rate regression before it reaches a customer. */
  escalationRatePct: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  totalCostUsd: number;
}

/**
 * Builds the comparison report.
 *
 * **Evidence, never a gate** (ADR-0019 §2.5's closing rule): nothing this function returns
 * can promote a version, satisfy the sandbox-test-before-promote requirement, or shorten
 * `canPromote`. There is deliberately no code path from a shadow result to a deployment
 * write anywhere in this module.
 */
export async function getShadowEvaluationReport(ctx: TenantContext, id: string): Promise<ShadowEvaluationReport> {
  const evaluation = await getShadowEvaluation(ctx, id);
  if (!evaluation) throw new ShadowEvaluationNotFoundError(id);
  const runs = await listShadowRuns(ctx, id, 1000);

  const completed = runs.filter((r) => r.status === "Completed");
  const durations = completed.map((r) => r.durationMs).filter((d): d is number => d !== null).sort((a, b) => a - b);

  return {
    evaluation,
    completedRuns: completed.length,
    skippedRuns: runs.filter((r) => r.status === "Skipped").length,
    failedRuns: runs.filter((r) => r.status === "Failed").length,
    // Both hashes are captured at replay time, so divergence is countable without pulling
    // any reply's full text (and therefore without re-reading customer content).
    // `null` when nothing has completed yet, which is honestly different from 0%.
    replyDivergencePct: percentOf(completed.length, completed.filter((r) => r.replyPayloadHash !== r.liveReplyPayloadHash).length),
    toolCallDivergencePct: percentOf(completed.length, completed.filter((r) => (r.wouldHaveToolCalls?.length ?? 0) !== (r.liveToolCallCount ?? 0)).length),
    escalationRatePct: percentOf(completed.length, completed.filter((r) => r.escalationSignal !== null).length),
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    totalCostUsd: completed.reduce((sum, r) => sum + Number(r.costUsd ?? 0), 0),
  };
}

function percentOf(total: number, count: number): number | null {
  if (total === 0) return null;
  return Math.round((count / total) * 10000) / 100;
}

function percentile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[index] ?? null;
}

export { getShadowEvaluation, listShadowEvaluations, listShadowRuns };
