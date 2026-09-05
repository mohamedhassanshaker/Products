import { Type } from "@sinclair/typebox";
import type { TenantContext } from "@nextbot/db";
import type { DelegationChainEntry, ScopeDescriptor, TeamLimits } from "@nextbot/contracts";
import { TeamVersionNotFoundError } from "@nextbot/contracts";
import { getTenantScopePolicy } from "@nextbot/authz";
import { completeAgentRun, startAgentRun } from "@nextbot/agent-platform";
import { callModelGatewayStructuredPinned } from "@nextbot/model-gateway";
import { delegate, type DelegationExecutorDeps, type DelegationRunState } from "./delegation-executor.js";
import { getAgentVersionLabel } from "../infrastructure/delegation-event-repository.js";
import { bindTeamVersionSandboxRun, findTeamVersionById, listTeamMembers, type TeamMemberRow } from "../infrastructure/team-repository.js";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-03/07/10/11, LLD §14.7.3) —
 * the supervisor loop that drives a team run, and the whole-topology sandbox run the
 * promotion gate requires.
 *
 * The supervisor's ONLY job is classification/routing (FR-ORC-03: "a designated
 * cheap `chat.router`-class model route for classification/routing — never a
 * frontier model"). It picks a member by matching the task against each member's
 * `invokeWhen`, through the team version's PINNED `supervisor_route_version_id`, and
 * hands off. It never answers in a specialist's place — the only outcomes of a run
 * are a specialist's answer, an escalation, or a traced refusal.
 */

/** The router model's constrained output. TypeBox + the gateway's structured-output
 * facility (ADR-0006/LLD §7.2) — never a hand-parsed free-text completion. */
const RoutingDecisionSchema = Type.Object({
  /** A `team_member.member_key`, or `"none"` when no member's `invokeWhen` matches. */
  memberKey: Type.String(),
  /** The supervisor's stated rationale — persisted to `delegation_event.reason`,
   * which is INTERNAL-ONLY (LLD §14.7.4). */
  reason: Type.String(),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
});

export interface TeamRunInput {
  teamVersionId: string;
  task: string;
  /** `null` for a dry run with no conversation. FR-ORC-06's single-escalation
   * guarantee and FR-ORC-04's Approval Queue suspension both need a real
   * conversation, so a run without one records outcomes but raises neither. */
  conversationId: string | null;
  trigger?: "CustomerMessage" | "SandboxTest" | "EvalCase" | "A2ATask";
}

export interface TeamRunResult {
  agentRunId: string;
  /** Root-first, one entry per hop — the same shape the Approval Queue, the
   * escalation snapshot and the audit entry all carry. */
  chain: DelegationChainEntry[];
  /** The answering specialist's text, or `null` when the run escalated/was refused.
   * The supervisor never substitutes one of its own (FR-ORC-10). */
  answerText: string | null;
  outcome: "Answered" | "NotMine" | "Escalated" | "Refused" | "AwaitingApproval";
}

/**
 * Runs one team turn.
 *
 * @param deps the specialist runner and (optionally) the escalation sink — supplied
 *   by the composition root, which is the only place `teams` and `escalations` are
 *   wired together (see `ports/escalation-sink.ts` for why).
 */
export async function runTeamTurn(ctx: TenantContext, deps: DelegationExecutorDeps, input: TeamRunInput): Promise<TeamRunResult> {
  const teamVersion = await findTeamVersionById(ctx, input.teamVersionId);
  if (!teamVersion) throw new TeamVersionNotFoundError(input.teamVersionId);
  const members = await listTeamMembers(ctx, teamVersion.id);
  const supervisorLabel = await getAgentVersionLabel(ctx, teamVersion.supervisorDefinitionVersionId);

  const { run, span } = await startAgentRun(ctx, {
    agentDefinitionVersionId: teamVersion.supervisorDefinitionVersionId,
    trigger: input.trigger ?? "CustomerMessage",
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
  });

  const state: DelegationRunState = {
    agentRunId: run.id,
    conversationId: input.conversationId,
    teamVersion,
    limits: teamVersion.limitsJson as TeamLimits,
    tenantPolicy: await getTenantScopePolicy(ctx),
    supervisorVersionId: teamVersion.supervisorDefinitionVersionId,
    supervisorLabel,
    membersById: new Map(members.map((m) => [m.id, m])),
    startedAtMs: Date.now(),
    consumed: { usd: 0, steps: 0, delegations: 0 },
    fanOutByParent: new Map(),
    // FR-ORC-04 — the chain starts at the SUPERVISOR (depth 0, no member row, hence
    // `memberKey: null`), so every downstream surface can render "billing_agent@9,
    // delegated by triage@14" rather than a bare terminal name. This is exactly the
    // case `DelegationChainEntrySchema.memberKey`'s nullability exists for.
    chain: [{ depth: 0, agentLabel: supervisorLabel, memberKey: null, reason: "Team supervisor (routing)", outcome: null }],
  };

  try {
    const result = await routeAndDelegate(ctx, deps, state, members, input.task, /* reRoutesLeft */ 1);
    await completeAgentRun(ctx, run, span, {
      status: result.outcome === "Answered" || result.outcome === "AwaitingApproval" ? "Succeeded" : "Failed",
      costUsd: state.consumed.usd.toFixed(8),
      durationMs: Date.now() - state.startedAtMs,
    });
    return result;
  } catch (err) {
    await completeAgentRun(ctx, run, span, { status: "Failed", durationMs: Date.now() - state.startedAtMs });
    throw err;
  }
}

/**
 * One routing decision plus its hop, with FR-ORC-10's single re-route on `NotMine`.
 *
 * `reRoutesLeft` bounds re-routing here, but it is NOT the safety mechanism: even
 * with re-routes remaining, the next hop's own `evaluateOrDeny` call enforces
 * `maxDelegations`/`maxDepth`/cost/wall-clock and denies rather than looping. This
 * counter is the product rule FR-ORC-10 states ("may re-route once"); the ceilings
 * are the guarantee.
 */
async function routeAndDelegate(
  ctx: TenantContext,
  deps: DelegationExecutorDeps,
  state: DelegationRunState,
  candidates: TeamMemberRow[],
  task: string,
  reRoutesLeft: number,
): Promise<TeamRunResult> {
  if (candidates.length === 0) {
    return { agentRunId: state.agentRunId, chain: state.chain, answerText: null, outcome: "Refused" };
  }

  const decision = await callModelGatewayStructuredPinned(ctx, {
    routeVersionId: state.teamVersion.supervisorRouteVersionId,
    routeKeyForLog: "team.supervisor.route",
    schema: RoutingDecisionSchema,
    system:
      "You are a support team supervisor. Your ONLY job is to route the request to exactly one specialist, " +
      "or answer 'none' if no specialist matches. You must never attempt to answer the request yourself. " +
      "Reply only with the required JSON shape. The specialists available to you are:\n" +
      candidates.map((m) => `- ${m.memberKey}: invoke when ${m.invokeWhen}`).join("\n"),
    messages: [{ role: "user", content: task }],
    agentRunId: state.agentRunId,
  });

  const chosen = candidates.find((m) => m.memberKey === decision.memberKey);
  if (!chosen) {
    // No specialist matched. FR-ORC-10: the supervisor does NOT answer in a
    // specialist's place, so this escalates rather than degrading to a supervisor
    // reply. Recorded as a refusal on the run; the sink (if any) raises/attaches the
    // single conversation escalation.
    if (deps.escalationSink && state.conversationId) {
      await deps.escalationSink.escalate({
        conversationId: state.conversationId,
        delegationRunId: state.agentRunId,
        delegationChain: [...state.chain],
        reason: "LowConfidence",
        reasonDetail: { source: "delegation", detail: `No team member matched: ${decision.reason}` },
        aiContextSnapshot: { recognizedGoal: null, delegationRunId: state.agentRunId, teamVersionId: state.teamVersion.id },
      });
    }
    return { agentRunId: state.agentRunId, chain: state.chain, answerText: null, outcome: "Escalated" };
  }

  const hopResult = await delegate(
    ctx,
    deps,
    state,
    {
      // A supervisor-issued hop is always depth 1 (the supervisor itself is depth 0,
      // the chain's own first entry). Deeper hops only ever come from a specialist's
      // sub-delegation, which `delegate` recurses into with `depth + 1` itself.
      depth: 1,
      siblingOrdinal: state.fanOutByParent.get("__root__") ?? 0,
      parentEventId: null,
      parentSpanId: null,
      fromMemberId: null,
      fromAgentVersionId: state.supervisorVersionId,
      // The supervisor hop's chain is the TEAM VERSION's own scope. The member's own
      // scope is appended by `delegate` itself — never here, so there is exactly one
      // place a chain level can be added.
      fromScopeChain: [state.teamVersion.scopeJson as ScopeDescriptor],
    },
    chosen,
    task,
    decision.reason,
  );

  if (hopResult.outcome === "NotMine" && reRoutesLeft > 0) {
    // FR-ORC-10 — "the supervisor receives it, may re-route once (subject to
    // maxDelegations), traced as a distinct outcome, not a failure". The already-tried
    // member is removed from the candidate set so a re-route cannot re-pick it.
    return routeAndDelegate(
      ctx,
      deps,
      state,
      candidates.filter((m) => m.id !== chosen.id),
      task,
      reRoutesLeft - 1,
    );
  }

  const outcome: TeamRunResult["outcome"] =
    hopResult.outcome === "Answered"
      ? "Answered"
      : hopResult.outcome === "NotMine"
        ? "NotMine"
        : hopResult.outcome === "AwaitingApproval"
          ? "AwaitingApproval"
          : hopResult.escalationId || hopResult.outcome === "Escalated"
            ? "Escalated"
            : "Refused";

  return { agentRunId: state.agentRunId, chain: state.chain, answerText: hopResult.text, outcome };
}

/**
 * FR-ORC-11 — the promotion-gate sandbox run. "Must exercise the WHOLE team topology
 * with a visible delegation tree — a supervisor-only sandbox run does not satisfy
 * the gate."
 *
 * This function therefore does NOT ask the router which member to use: it delegates
 * to every member in turn, under the same executor (same evaluator call, same
 * guardrail, same re-mask, same trace rows) as a production hop, so the recorded
 * `delegation_event` set genuinely covers the whole topology and the gate check
 * (`canPromoteTeamVersion`) is checking real evidence rather than a flag someone set.
 *
 * Records `team_version.sandbox_run_id` so the gate has something to check against.
 */
export async function runTeamSandbox(
  ctx: TenantContext,
  deps: DelegationExecutorDeps,
  input: { teamVersionId: string; task: string; conversationId: string | null },
): Promise<TeamRunResult> {
  const teamVersion = await findTeamVersionById(ctx, input.teamVersionId);
  if (!teamVersion) throw new TeamVersionNotFoundError(input.teamVersionId);
  const members = await listTeamMembers(ctx, teamVersion.id);
  const supervisorLabel = await getAgentVersionLabel(ctx, teamVersion.supervisorDefinitionVersionId);

  const { run, span } = await startAgentRun(ctx, {
    agentDefinitionVersionId: teamVersion.supervisorDefinitionVersionId,
    trigger: "SandboxTest",
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
  });

  const state: DelegationRunState = {
    agentRunId: run.id,
    conversationId: input.conversationId,
    teamVersion,
    // A sandbox run must be able to touch every member, so its ceilings are raised
    // to at least the member count. This does NOT bypass the evaluator — the raised
    // values are still projected into the scope the evaluator folds, so every hop is
    // still authorised, screened, re-masked and traced identically to production.
    limits: sandboxLimits(teamVersion.limitsJson as TeamLimits, members.length),
    tenantPolicy: await getTenantScopePolicy(ctx),
    supervisorVersionId: teamVersion.supervisorDefinitionVersionId,
    supervisorLabel,
    membersById: new Map(members.map((m) => [m.id, m])),
    startedAtMs: Date.now(),
    consumed: { usd: 0, steps: 0, delegations: 0 },
    fanOutByParent: new Map(),
    // FR-ORC-04 — the chain starts at the SUPERVISOR (depth 0, no member row, hence
    // `memberKey: null`), so every downstream surface can render "billing_agent@9,
    // delegated by triage@14" rather than a bare terminal name. This is exactly the
    // case `DelegationChainEntrySchema.memberKey`'s nullability exists for.
    chain: [{ depth: 0, agentLabel: supervisorLabel, memberKey: null, reason: "Team supervisor (routing)", outcome: null }],
  };
  // The sandbox's own raised ceilings must be what the evaluator sees, so they are
  // folded in as an extra, sandbox-only chain level rather than smuggled past it.
  const sandboxScope: ScopeDescriptor = {
    ...(teamVersion.scopeJson as ScopeDescriptor),
    budget: {
      ...((teamVersion.scopeJson as ScopeDescriptor).budget ?? {}),
      maxFanOut: state.limits.maxFanOut,
      maxDelegations: state.limits.maxDelegations,
    },
  };

  let answerText: string | null = null;
  try {
    for (const [index, member] of members.entries()) {
      const hop = await delegate(
        ctx,
        deps,
        state,
        {
          depth: 1,
          siblingOrdinal: index,
          parentEventId: null,
          parentSpanId: null,
          fromMemberId: null,
          fromAgentVersionId: teamVersion.supervisorDefinitionVersionId,
          fromScopeChain: [sandboxScope],
        },
        member,
        input.task,
        `Sandbox topology exercise for member '${member.memberKey}' (FR-ORC-11)`,
      );
      if (hop.text && answerText === null) answerText = hop.text;
    }
    await bindTeamVersionSandboxRun(ctx, teamVersion.id, run.id);
    await completeAgentRun(ctx, run, span, { status: "Succeeded", costUsd: state.consumed.usd.toFixed(8), durationMs: Date.now() - state.startedAtMs });
  } catch (err) {
    await completeAgentRun(ctx, run, span, { status: "Failed", durationMs: Date.now() - state.startedAtMs });
    throw err;
  }

  return { agentRunId: run.id, chain: state.chain, answerText, outcome: "Answered" };
}

/** The sandbox's ceilings: the authored ones, raised only where the topology
 * literally cannot be exercised otherwise. Never lowered, and `maxDepth`/`runBudget`
 * are left exactly as authored — a sandbox that would blow the real cost or depth
 * ceiling SHOULD fail, since that is a real defect in the team's configuration. */
function sandboxLimits(limits: TeamLimits, memberCount: number): TeamLimits {
  return {
    ...limits,
    maxFanOut: Math.max(limits.maxFanOut, memberCount),
    maxDelegations: Math.max(limits.maxDelegations, memberCount),
  };
}
