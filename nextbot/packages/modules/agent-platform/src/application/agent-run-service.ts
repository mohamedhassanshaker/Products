import type { TenantContext } from "@nextbot/db";
import { endSpanError, endSpanOk, initTracing, startSpan, traceIdOf } from "@nextbot/observability";
import { createAgentRun, finishAgentRun, pauseAgentRunForApproval, getAgentRun, listAgentRunsForVersion, type AgentRunRow } from "../infrastructure/agent-run-repository.js";
import { getAgentDefinitionVersion } from "../infrastructure/agent-definition-repository.js";
import { enforceModelBudget } from "./model-gateway-service.js";

/**
 * FR-AGT-09 basic runtime observability — the `agent_run` write path plus its OTel
 * span, wired here so the mechanism is real from this phase on. The turn-runner that
 * actually *drives* a run (loading a `GraphRuntime`, calling the Model Gateway, tool
 * dispatch) is Phase 12's `orchestration` module; this service is what Phase 12 will
 * call at the start/end of a turn, not a replacement for it.
 *
 * **BE3 fix (QA 2026-08-15 backend pass):** this is the "new agent run boundary" LLD
 * §7.1 requires the Model Gateway budget check to run at — never mid-run. A `HardStop`
 * budget that's already exceeded blocks the run from ever starting
 * (`ModelBudgetExceededError` propagates to the caller); the `agent_run` row is not
 * created for a blocked attempt.
 * @throws {import("@nextbot/contracts").ModelBudgetExceededError} a `HardStop` budget
 * for this agent (or the tenant as a whole) has already been exceeded this period.
 */
export async function startAgentRun(
  ctx: TenantContext,
  input: { agentDefinitionVersionId: string; trigger: string; conversationId?: string },
): Promise<{ run: AgentRunRow; span: ReturnType<typeof startSpan> }> {
  const version = await getAgentDefinitionVersion(ctx, input.agentDefinitionVersionId);
  await enforceModelBudget(ctx, { agentDefinitionId: version.agentDefinitionId });

  initTracing("nextbot-agent-platform");
  const span = startSpan("agent_run", {
    "nextbot.tenant_id": ctx.tenantId,
    "nextbot.agent_definition_version_id": input.agentDefinitionVersionId,
    "nextbot.trigger": input.trigger,
  });
  const run = await createAgentRun(ctx, { ...input, otelTraceId: traceIdOf(span) });
  return { run, span };
}

export async function completeAgentRun(
  ctx: TenantContext,
  run: AgentRunRow,
  span: ReturnType<typeof startSpan>,
  input: { status: "Succeeded" | "Failed" | "Cancelled" | "TimedOut"; tokensIn?: number; tokensOut?: number; costUsd?: string; durationMs?: number },
): Promise<void> {
  await finishAgentRun(ctx, run.id, input);
  if (input.status === "Succeeded") endSpanOk(span);
  else endSpanError(span, `agent_run ended with status ${input.status}`);
}

export async function suspendAgentRunForApproval(
  ctx: TenantContext,
  run: AgentRunRow,
  span: ReturnType<typeof startSpan>,
  input: { pausedToolCallId: string; resumeToken: string; checkpoint: Record<string, unknown> },
): Promise<void> {
  await pauseAgentRunForApproval(ctx, run.id, input);
  // Not ended — a paused run's span stays open until resume completes it (LLD §7.4
  // step 8's non-blocking-suspension guarantee: the worker is released, not the span).
}

export { getAgentRun, listAgentRunsForVersion };
