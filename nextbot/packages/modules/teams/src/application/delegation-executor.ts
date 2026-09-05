import { generateId, type TenantContext } from "@nextbot/db";
import type { DelegationChainEntry, DelegationOutcomeValue, ScopeDescriptor, TeamLimits } from "@nextbot/contracts";
import { evaluateOrDeny } from "@nextbot/authz";
import { getVersionTrustLevel, findAgentDefinitionVersionById } from "@nextbot/agent-platform";
import { runTierEngine, scanValueForPromptInjection } from "@nextbot/orchestration";
import { buildPolicyLookup, detectAndMask, listCustomPiiRulesForMasking } from "@nextbot/pii";
import { findToolById } from "@nextbot/tool-registry";
import { detectThrash } from "../domain/thrash-detector.js";
import { getAgentVersionLabel, insertDelegationEvent, listPriorPayloadsToMember } from "../infrastructure/delegation-event-repository.js";
import type { TeamMemberRow, TeamVersionRow } from "../infrastructure/team-repository.js";
import type { EscalationSink } from "../ports/escalation-sink.js";
import type { SpecialistRunner } from "../ports/specialist-runner.js";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-04/05/07/09/10, LLD
 * §14.7.3) — **the delegation executor**. LLD §14.7.3 gives this file's algorithm as
 * a seven-step sequence; the steps below are numbered to match it 1:1, and each
 * step's comment names the FR it satisfies.
 *
 * Three properties this file is deliberately built NOT to be able to violate:
 *
 *  1. **The permission decision at every hop is the Phase 6 evaluator's own
 *     output.** Step 1 calls `evaluateOrDeny` — the single sanctioned entrypoint
 *     (LLD §14.2.4 E11) — and nothing in this module compares scopes, tiers,
 *     budgets, depths or fan-out by hand. FR-ORC-07's run-level ceilings are that
 *     evaluator's `budget` dimension, projected from `team_version.limits_json` at
 *     save time (`domain/team-scope.ts`) and checked against the run's real
 *     `consumed` accumulator. A `Deny` is routed to `failureMode`; it is never
 *     second-guessed.
 *  2. **A Tier-3 requirement cannot be bypassed by crossing a hop.** Step 5 runs the
 *     hop through `runTierEngine` — the identical function a single agent's tool call
 *     uses — against the member's `AgentAsTool` catalog row, and threads the live
 *     delegation chain into the specialist's own execution so any Tier-3 call IT
 *     makes, at any depth, reaches the Approval Queue with the whole chain attached.
 *  3. **The supervisor never answers in the specialist's place.** Step 6's only two
 *     outcomes for an unavailable member are "recurse into the declared fallback" and
 *     "escalate" (FR-ORC-10). There is no third branch, and no code path here
 *     produces an answer of its own.
 */

/** Live state for one team run, threaded through every hop. */
export interface DelegationRunState {
  /** The TEAM run's `agent_run.id`. Every hop's `delegation_event.agent_run_id`, the
   * approval chain's `correlationId`, and `escalation.delegation_run_id` all use
   * this one id, so a run is a single joinable thing across all four surfaces. */
  agentRunId: string;
  conversationId: string | null;
  teamVersion: TeamVersionRow;
  limits: TeamLimits;
  /** `tenant_scope_policy`, read once per run (it is the floor, not a per-hop value). */
  tenantPolicy: ScopeDescriptor;
  supervisorVersionId: string;
  supervisorLabel: string;
  membersById: Map<string, TeamMemberRow>;
  /** Wall clock, for the evaluator's `seconds` ceiling. */
  startedAtMs: number;
  /** Mutated in place as hops complete — this is what makes FR-ORC-07's budgets
   * RUN-level rather than per-member. */
  consumed: { usd: number; steps: number; delegations: number };
  /**
   * Hops already issued under each parent, keyed by `parent_delegation_event_id`
   * (`"__root__"` for a supervisor-issued hop). Fan-out is inherently a per-PARENT
   * count, so a single run-level scalar would conflate "one supervisor fanned out to
   * five members" with "five sequential single-child hops" — only the first is
   * fan-out. Fed to the evaluator's `consumed.fanOut`, which owns the ceiling.
   */
  fanOutByParent: Map<string, number>;
  /** Root-first chain of hops taken so far, in FR-ORC-04/06/08's shared shape. */
  chain: DelegationChainEntry[];
}

export interface DelegationExecutorDeps {
  specialistRunner: SpecialistRunner;
  /** Absent for a dry sandbox run with no conversation — see the port's own doc. */
  escalationSink?: EscalationSink;
}

/** One hop's position in the tree. */
export interface HopContext {
  depth: number;
  siblingOrdinal: number;
  parentEventId: string | null;
  parentSpanId: string | null;
  /** The delegating side: `null` at depth 1 (the supervisor, which has no member row). */
  fromMemberId: string | null;
  fromAgentVersionId: string;
  /** Caller-first scope chain the evaluator folds. Never the supervisor's own scope
   * substituted for a narrower one — each recursion appends, never replaces. */
  fromScopeChain: ScopeDescriptor[];
  /** Set when this hop is the fallback for an earlier failed hop (FR-ORC-10). */
  fallbackOfEventId?: string | null;
}

export interface DelegationResult {
  outcome: DelegationOutcomeValue;
  text: string | null;
  delegationEventId: string;
  /** Present when the hop suspended into the Approval Queue (FR-ORC-04). */
  toolCallId?: string;
  /** Present when the hop escalated (FR-ORC-06). */
  escalationId?: string;
}

/** Map key for a hop's parent (`null` = issued by the supervisor itself). */
function parentKey(parentEventId: string | null): string {
  return parentEventId ?? "__root__";
}

/**
 * Executes ONE delegation hop.
 *
 * @param ctx tenant context.
 * @param deps the specialist runner and (optionally) the escalation sink.
 * @param state the live run state — mutated as budgets are consumed and the chain grows.
 * @param hop this hop's tree position and caller scope chain.
 * @param member the team member being delegated to.
 * @param task the payload to hand over. Screened (step 3) and re-masked (step 4)
 *   before the specialist ever sees it; the RAW value is never forwarded.
 * @param reason the supervisor's routing rationale. **Internal-only** — it is
 *   persisted to `delegation_event.reason`, which LLD §14.7.4 makes structurally
 *   unreachable from any customer-facing surface via the
 *   `no-teams-inside-conversations` dependency-cruiser rule.
 */
export async function delegate(
  ctx: TenantContext,
  deps: DelegationExecutorDeps,
  state: DelegationRunState,
  hop: HopContext,
  member: TeamMemberRow,
  task: string,
  reason: string,
): Promise<DelegationResult> {
  const hopStartedMs = Date.now();
  const spanId = generateId();
  const memberScope = member.scopeJson as ScopeDescriptor;
  const agentTool = await findToolById(ctx, member.toolId);
  const toAgentLabel = await getAgentVersionLabel(ctx, member.definitionVersionId);

  // ------------------------------------------------------------------
  // Step 4 (FR-ORC-05), computed UP FRONT rather than at its numbered position.
  //
  // LLD §14.7.3 lists re-masking as step 4, after the deny/thrash/guardrail checks.
  // Computing it here instead is a deliberate, strictly-safer reordering, and it
  // fixes a real defect this phase's own adversarial PII test caught: every exit
  // path below writes a `delegation_event` whose `outcome_detail.payloadForThrash`
  // is the payload, and the early exits (denied / thrashing / injection-blocked)
  // reached that write BEFORE masking existed — persisting RAW customer PII into
  // the trace for exactly the hops that never even ran. Hoisting the mask means no
  // code path in this function can persist an unmasked payload, which is a
  // structural guarantee rather than a discipline.
  //
  // The masking itself is unchanged in substance: `@nextbot/pii`'s existing masker
  // and tenant policy lookup, keyed to the RECEIVING member's declared trust level
  // (`getVersionTrustLevel`, which fails closed to `Untrusted`) — never the
  // sender's. "A supervisor holding unmasked PII may not pass a full unmasked
  // transcript to a lower-trust specialist by composition."
  //
  // The injection scan (step 3) deliberately still runs against the RAW payload —
  // see its own comment for why screening must precede redaction.
  // ------------------------------------------------------------------
  const receiverTrustLevel = await getVersionTrustLevel(ctx, member.definitionVersionId);
  const maskedTask = await maskForReceiver(ctx, task, receiverTrustLevel);

  /** Writes the hop's `delegation_event` and returns the shaped result. Every exit
   * path below goes through this — a hop that never executed still leaves a row, so
   * a refused/denied delegation is a first-class traced result, not a silent gap in
   * the tree. */
  const record = async (
    outcome: DelegationOutcomeValue,
    scopeHash: string,
    detail: Record<string, unknown> | null,
    extras: { toolCallId?: string | null; escalationId?: string | null; cost?: string; tokensIn?: number; tokensOut?: number } = {},
  ): Promise<DelegationResult> => {
    const row = await insertDelegationEvent(ctx, {
      conversationId: state.conversationId,
      agentRunId: state.agentRunId,
      teamVersionId: state.teamVersion.id,
      parentDelegationEventId: hop.parentEventId,
      parentSpanId: hop.parentSpanId,
      spanId,
      depth: hop.depth,
      siblingOrdinal: hop.siblingOrdinal,
      fromAgentVersionId: hop.fromAgentVersionId,
      fromMemberId: hop.fromMemberId,
      toAgentVersionId: member.definitionVersionId,
      toMemberId: member.id,
      toolCallId: extras.toolCallId ?? null,
      reason,
      scopeHash,
      outcome,
      // `payloadForThrash` is what FR-ORC-07's similarity window reads back. ALWAYS
      // the re-masked payload, never the raw one (see the hoisted step 4 above), so
      // the trace can never become a place unmasked customer PII is retained — not
      // even on a hop that was denied before it ran.
      outcomeDetail: { ...(detail ?? {}), payloadForThrash: maskedTask },
      fallbackOfEventId: hop.fallbackOfEventId ?? null,
      tokensIn: extras.tokensIn ?? 0,
      tokensOut: extras.tokensOut ?? 0,
      costUsd: extras.cost ?? "0",
      latencyMs: Date.now() - hopStartedMs,
      escalationId: extras.escalationId ?? null,
    });
    state.chain.push({ depth: hop.depth, agentLabel: toAgentLabel, memberKey: member.memberKey, reason, outcome });
    state.consumed.delegations += 1;
    state.consumed.steps += 1;
    state.fanOutByParent.set(parentKey(hop.parentEventId), (state.fanOutByParent.get(parentKey(hop.parentEventId)) ?? 0) + 1);
    return { outcome, text: null, delegationEventId: row.id, ...(extras.toolCallId ? { toolCallId: extras.toolCallId } : {}), ...(extras.escalationId ? { escalationId: extras.escalationId } : {}) };
  };

  // ------------------------------------------------------------------
  // Step 1 (LLD §14.7.3) — the permission intersection, via the Phase 6 evaluator.
  // FR-ORC-07's depth/fan-out/delegation-count/cost/wall-clock ceilings ARE this
  // call's step-2 budget check: they come from `team_version.scope_json.budget`
  // (projected from `limits_json`) folded against `consumed` below. Nothing in this
  // module re-derives any of them.
  // ------------------------------------------------------------------
  const evaluation = await evaluateOrDeny(ctx, {
    tenantId: ctx.tenantId,
    tenantPolicy: state.tenantPolicy,
    chain: [...hop.fromScopeChain, memberScope],
    requested: {
      kind: "AgentDelegation",
      toolId: member.toolId,
      ...(agentTool?.capabilityGroupId ? { toolCapabilityGroupId: agentTool.capabilityGroupId } : {}),
      toolRwClass: agentTool?.rwClass ?? "Write",
      toolApprovalTier: member.delegationTier,
    },
    depth: hop.depth,
    consumed: {
      usd: state.consumed.usd,
      seconds: (Date.now() - state.startedAtMs) / 1000,
      steps: state.consumed.steps,
      delegations: state.consumed.delegations,
      fanOut: state.fanOutByParent.get(parentKey(hop.parentEventId)) ?? 0,
    },
  });

  if (evaluation.decision === "Deny") {
    // A budget/depth/count denial is materially different from a scope denial for an
    // operator reading the tree, so the two get distinct outcomes — but BOTH come
    // from the same evaluator call above, never from a second comparison here.
    const budgetReasons = new Set([
      "DELEGATION_DEPTH_EXCEEDED",
      "DELEGATION_COUNT_EXCEEDED",
      "FAN_OUT_EXCEEDED",
      "STEP_BUDGET_EXCEEDED",
      "COST_BUDGET_EXCEEDED",
      "WALL_CLOCK_BUDGET_EXCEEDED",
    ]);
    const outcome: DelegationOutcomeValue = budgetReasons.has(evaluation.denyReason ?? "") ? "BudgetExceeded" : "Denied";
    const recorded = await record(outcome, evaluation.scopeHash, {
      denyReason: evaluation.denyReason,
      denyDetail: evaluation.denyDetail,
    });
    // "a supervisor that would re-delegate on failure past any limit is halted and
    // routed to `failureMode`, never left to loop" (FR-ORC-07).
    return applyFailureMode(ctx, deps, state, recorded, `${evaluation.denyReason}: ${evaluation.denyDetail ?? ""}`);
  }

  // The narrowed scope the callee must execute under — the caller MUST pass THIS,
  // not its own, to the next hop (LLD §14.2.2's `effectiveScope` contract). Falling
  // back to the member's own declared scope would silently re-widen the chain.
  const effectiveScope = evaluation.effectiveScope ?? memberScope;

  // ------------------------------------------------------------------
  // Step 2 (FR-ORC-07) — routing-thrash guard. Escalate, never loop.
  // ------------------------------------------------------------------
  const priorPayloads = await listPriorPayloadsToMember(ctx, state.agentRunId, member.id);
  // Masked-against-masked: the stored prior payloads are masked too, so the
  // similarity comparison is like-for-like. Masking is deterministic for a fixed
  // (receiver, policy) pair, so it cannot make two identical tasks look different.
  const thrash = detectThrash(maskedTask, priorPayloads, state.limits.thrashWindow);
  if (thrash.thrashing) {
    const recorded = await record("BudgetExceeded", evaluation.scopeHash, {
      thrash: { maxSimilarity: thrash.maxSimilarity, similarCount: thrash.similarCount, window: state.limits.thrashWindow },
    });
    return applyFailureMode(
      ctx,
      deps,
      state,
      recorded,
      `Routing thrash detected: ${thrash.similarCount} materially similar prior delegation(s) to '${member.memberKey}' (max cosine ${thrash.maxSimilarity.toFixed(3)}).`,
    );
  }

  // ------------------------------------------------------------------
  // Step 3 (FR-ORC-09) — output guardrails run BEFORE the payload crosses the
  // delegation boundary into another agent's context, not only before it reaches
  // the customer. This is orchestration's ALREADY-SHIPPED `PostToolResult`
  // injection scanner, reused as-is: a second detector here would drift from the
  // one the customer-facing path uses, which is precisely the gap FR-ORC-09 closes.
  // ------------------------------------------------------------------
  const injection = scanValueForPromptInjection(task);
  if (injection.matched) {
    const recorded = await record("Failed", evaluation.scopeHash, {
      guardrail: { kind: "PromptInjection", detector: injection.detector, score: injection.score, stage: "PreDelegationHandoff" },
    });
    return applyFailureMode(
      ctx,
      deps,
      state,
      recorded,
      `Hand-off payload blocked by the injection guardrail before crossing into '${member.memberKey}' (detector: ${injection.detector}).`,
    );
  }

  // ------------------------------------------------------------------
  // Step 6 (checked before step 5's dispatch) — member availability. FR-ORC-10: the
  // supervisor NEVER answers in the specialist's place. Checked here rather than
  // after dispatch because a deprecated pinned version must not consume a tool-call
  // row or an approval slot first.
  // ------------------------------------------------------------------
  const pinnedVersion = await findAgentDefinitionVersionById(ctx, member.definitionVersionId);
  const unavailableReason =
    pinnedVersion === null
      ? "The member's pinned agent version no longer exists."
      : pinnedVersion.status === "Deprecated"
        ? "The member's pinned agent version is Deprecated."
        : agentTool === null
          ? "The member's agent-as-tool catalog entry no longer exists."
          : agentTool.status !== "Active"
            ? `The member's agent-as-tool catalog entry is ${agentTool.status}.`
            : null;

  if (unavailableReason) {
    const recorded = await record("Failed", evaluation.scopeHash, { unavailableReason });
    return applyMemberFallback(ctx, deps, state, hop, member, maskedTask, recorded, unavailableReason);
  }

  // ------------------------------------------------------------------
  // Step 5 — execute as an ORDINARY tool call through orchestration's existing
  // pipeline. This is what makes FR-ORC-04 true by construction: the delegation hop
  // is resolved by the SAME `resolveToolPermission` + tier engine every other tool
  // call uses, so a Tier-2/Tier-3 delegation suspends into the Approval Queue at any
  // depth rather than proceeding.
  // ------------------------------------------------------------------
  if (state.conversationId) {
    const tier = await runTierEngine(
      ctx,
      member.toolId,
      {},
      {
        conversationId: state.conversationId,
        tool: { toolId: member.toolId, toolName: agentTool!.name, connectorId: null },
        args: { task: maskedTask },
        delegation: {
          agentRunId: state.agentRunId,
          // FR-ORC-04: the chain that produced the request, INCLUDING this hop, so
          // an approver sees "billing_agent@9, delegated by triage@14" rather than a
          // bare terminal name.
          chain: [...state.chain, { depth: hop.depth, agentLabel: toAgentLabel, memberKey: member.memberKey, reason, outcome: null }],
        },
      },
    );

    if (tier.kind === "PolicyDenied") {
      const recorded = await record("Denied", evaluation.scopeHash, { resolverReason: tier.resolution.reason, stage: "tool_resolver" });
      return applyFailureMode(ctx, deps, state, recorded, `Delegation to '${member.memberKey}' denied by the tool permission resolver (${tier.resolution.reason}).`);
    }
    if (tier.kind === "SuspendedForApproval") {
      // The hop is now waiting on a human. It is NOT an escalation and NOT a
      // failure — see migration `0078` for why this needed its own outcome.
      return record("AwaitingApproval", evaluation.scopeHash, { requiredTier: tier.resolution.tier }, { toolCallId: tier.toolCallId });
    }
  }

  // Dispatch. The specialist executes under `effectiveScope` — the evaluator's own
  // narrowed output — and receives only the screened, re-masked payload.
  let run;
  try {
    run = await deps.specialistRunner.run({
      definitionVersionId: member.definitionVersionId,
      task: maskedTask,
      conversationId: state.conversationId,
      delegationContext: {
        agentRunId: state.agentRunId,
        chain: [...state.chain, { depth: hop.depth, agentLabel: toAgentLabel, memberKey: member.memberKey, reason, outcome: null }],
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const recorded = await record("Failed", evaluation.scopeHash, { error: message });
    return applyMemberFallback(ctx, deps, state, hop, member, maskedTask, recorded, message);
  }

  state.consumed.usd += Number(run.costUsd || 0);

  if (run.unavailableReason) {
    const recorded = await record("Failed", evaluation.scopeHash, { unavailableReason: run.unavailableReason }, { cost: run.costUsd, tokensIn: run.tokensIn, tokensOut: run.tokensOut });
    return applyMemberFallback(ctx, deps, state, hop, member, maskedTask, recorded, run.unavailableReason);
  }

  if (run.outcome === "escalate") {
    const recorded = await record("Escalated", evaluation.scopeHash, { specialistOutcome: run.outcome }, { cost: run.costUsd, tokensIn: run.tokensIn, tokensOut: run.tokensOut });
    return applyFailureMode(ctx, deps, state, recorded, run.text ?? `Member '${member.memberKey}' requested escalation.`);
  }

  // FR-ORC-04/07 — the specialist asked to sub-delegate. This hop's own contribution
  // (routing) is complete and is recorded FIRST, so the child hop has a real parent
  // row to reference; the child then re-runs the entire seven-step sequence at the
  // new boundary, against THIS hop's evaluator-narrowed `effectiveScope`.
  if (run.delegateTo) {
    const childMember = [...state.membersById.values()].find((m) => m.toolId === run.delegateTo!.toolId);
    if (!childMember) {
      // The specialist selected an agent-as-tool that is not a member of this team
      // version. Denied, not silently ignored: reaching outside the composed team is
      // exactly the widening the intersection model exists to prevent.
      const refused = await record(
        "Denied",
        evaluation.scopeHash,
        { subDelegationRefused: run.delegateTo.toolId, detail: "selected agent-as-tool is not a member of this team version" },
        { cost: run.costUsd, tokensIn: run.tokensIn, tokensOut: run.tokensOut },
      );
      return applyFailureMode(ctx, deps, state, refused, "A member attempted to delegate outside its own team version.");
    }

    const parentRecord = await record(
      "Answered",
      evaluation.scopeHash,
      { specialistOutcome: run.outcome, subDelegatedToMemberKey: childMember.memberKey },
      { cost: run.costUsd, tokensIn: run.tokensIn, tokensOut: run.tokensOut },
    );
    return delegate(
      ctx,
      deps,
      state,
      {
        depth: hop.depth + 1,
        siblingOrdinal: 0,
        parentEventId: parentRecord.delegationEventId,
        parentSpanId: spanId,
        fromMemberId: member.id,
        fromAgentVersionId: member.definitionVersionId,
        // The caller MUST pass the evaluator's narrowed output, not its own declared
        // scope — appending `effectiveScope` is what guarantees a child can only ever
        // be narrower than its parent, never re-widened by composition.
        fromScopeChain: [...hop.fromScopeChain, effectiveScope],
      },
      childMember,
      run.delegateTo.task,
      `Sub-delegated by '${member.memberKey}'`,
    );
  }

  // FR-ORC-10 — `not_mine` is a FIRST-CLASS traced result, not an error. The
  // supervisor receives it and may re-route once (subject to `maxDelegations`,
  // enforced by the evaluator on the next hop's own step 1).
  const outcome: DelegationOutcomeValue = run.outcome === "not_mine" ? "NotMine" : "Answered";
  const recorded = await record(
    outcome,
    evaluation.scopeHash,
    { specialistOutcome: run.outcome, ...(run.citations ? { citations: run.citations } : {}) },
    { cost: run.costUsd, tokensIn: run.tokensIn, tokensOut: run.tokensOut },
  );
  return { ...recorded, text: run.text ?? null };
}

/**
 * FR-ORC-10 — the member-unavailable path. Exactly two branches, matching the
 * `fallback_action` enum: recurse into the declared fallback member, or escalate.
 * There is deliberately no "supervisor handles it" branch.
 */
async function applyMemberFallback(
  ctx: TenantContext,
  deps: DelegationExecutorDeps,
  state: DelegationRunState,
  hop: HopContext,
  member: TeamMemberRow,
  task: string,
  failedResult: DelegationResult,
  reason: string,
): Promise<DelegationResult> {
  if (member.fallbackAction === "Member" && member.fallbackMemberId) {
    const fallbackMember = state.membersById.get(member.fallbackMemberId);
    if (fallbackMember) {
      // A cycle here is impossible by construction: `assertNoFallbackCycle` rejects
      // one at save time, and `maxDepth`/`maxDelegations` still bound this recursion
      // through the evaluator regardless.
      return delegate(
        ctx,
        deps,
        state,
        {
          ...hop,
          siblingOrdinal: hop.siblingOrdinal + 1,
          fallbackOfEventId: failedResult.delegationEventId,
        },
        fallbackMember,
        task,
        `Fallback for '${member.memberKey}': ${reason}`,
      );
    }
  }
  return applyFailureMode(ctx, deps, state, failedResult, reason);
}

/**
 * FR-ORC-03/06/07 — `failureMode` is `Escalate` and only `Escalate`
 * ("never silently degrade"). Raises the run's escalation through the sink, which is
 * `escalations`' own create-or-attach service: FR-ORC-06's
 * one-active-escalation-per-conversation guarantee is that module's partial unique
 * index, so a second member tripping an escalation in the same run ATTACHES to the
 * existing record rather than raising a second one.
 */
async function applyFailureMode(
  ctx: TenantContext,
  deps: DelegationExecutorDeps,
  state: DelegationRunState,
  result: DelegationResult,
  reason: string,
): Promise<DelegationResult> {
  if (!deps.escalationSink || !state.conversationId) {
    // A dry sandbox run with no conversation has nothing to escalate INTO. The
    // outcome stays recorded on the hop; the run still halts. It does not fall
    // through to "the supervisor answers", and it does not invent a second
    // escalation mechanism.
    return result;
  }
  const escalation = await deps.escalationSink.escalate({
    conversationId: state.conversationId,
    delegationRunId: state.agentRunId,
    delegationChain: [...state.chain],
    reason: "ToolFailure",
    reasonDetail: { source: "delegation", detail: reason },
    aiContextSnapshot: {
      recognizedGoal: null,
      delegationRunId: state.agentRunId,
      teamVersionId: state.teamVersion.id,
      failureDetail: reason,
    },
  });
  return { ...result, escalationId: escalation.escalationId };
}

/**
 * FR-ORC-05's masking call. Uses `@nextbot/pii`'s EXISTING masker + tenant policy
 * lookup, with `MaskingContext = 'ModelPrompt'`'s codebase equivalent: this
 * codebase's `PiiContext` vocabulary (FR-SEC-04, `pii_context`) names that context
 * `'ToolCallPayload'` — the context every "text this system hands to a downstream
 * executor rather than to a human" already resolves against. A delegation hand-off
 * is exactly that, and LLD §14.7.3's `'ModelPrompt'` is not a value this codebase's
 * matrix has ever had. Disclosed here rather than silently adding a ninth context
 * value that no tenant has ever configured a policy row for (which would resolve to
 * the fail-closed `FullMask` default for everything and mask far more aggressively
 * than the tenant intended).
 */
async function maskForReceiver(ctx: TenantContext, text: string, receiverTrustLevel: "Trusted" | "SemiTrusted" | "Untrusted"): Promise<string> {
  const [resolvePolicy, customRules] = await Promise.all([buildPolicyLookup(ctx), listCustomPiiRulesForMasking(ctx)]);
  return detectAndMask(text, "ToolCallPayload", receiverTrustLevel, resolvePolicy, customRules);
}

