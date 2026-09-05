import type { TenantContext } from "@nextbot/db";
import type { MessagePayload } from "@nextbot/contracts";
import { runTurnPipeline, type EgressPort } from "@nextbot/orchestration";
import type { SpecialistRunInput, SpecialistRunResult, SpecialistRunner } from "../ports/specialist-runner.js";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, LLD §14.7.3 step 5) — the
 * PRODUCTION `SpecialistRunner`: a team member is executed by running its pinned
 * agent version through `@nextbot/orchestration`'s **existing** turn pipeline.
 *
 * This is the concrete thing LLD §14.7.3 step 5 asks for ("execute as an ORDINARY
 * tool call through orchestration's existing pipeline"), and it is what makes
 * FR-ORC-04 hold at every depth without a single delegation-specific branch in the
 * approval machinery: the pipeline's own `runTierEngine` call suspends a Tier-3 tool
 * call into the Approval Queue exactly as it does for a single agent, with
 * `delegationContext` carrying the chain that produced it.
 *
 * The `delegationContext` passed in is threaded through unchanged — this runner
 * neither constructs nor edits it, so the chain an approver sees is the executor's
 * own live chain, not a reconstruction.
 */
export function createTurnPipelineSpecialistRunner(ctx: TenantContext, deps: { egress: EgressPort }): SpecialistRunner {
  return {
    async run(input: SpecialistRunInput): Promise<SpecialistRunResult> {
      const result = await runTurnPipeline(ctx, deps, {
        customerText: input.task,
        agentDefinitionVersionId: input.definitionVersionId,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        delegation: input.delegationContext,
      });

      // A sub-delegation request short-circuits every other mapping below: the
      // specialist did not answer, it routed onward, and the executor owns what
      // happens next (depth ceiling, scope intersection, guardrail, re-mask).
      if (result.delegationRequest) {
        return {
          outcome: "answered",
          tokensIn: 0,
          tokensOut: 0,
          costUsd: "0",
          delegateTo: { toolId: result.delegationRequest.toolId, task: result.delegationRequest.task },
        };
      }

      // FR-ORC-10's three-way outcome, mapped from the turn's own already-established
      // signals rather than from a second classifier:
      //  - an escalation signal (any of FR-ESC-01's four triggers, including the
      //    guardrail-flagged sensitive-topic one) IS `escalate`;
      //  - the `GoalNotUnderstood` fallback — the pipeline's own "this agent has no
      //    goal matching the request" outcome — IS `not_mine`, which is precisely
      //    FR-ORC-10's "a specialist may return an explicit 'not mine' outcome when
      //    invoked outside its actual competence";
      //  - anything else is a real answer.
      const text = textOf(result.payload);
      if (result.escalationSignal) {
        return { outcome: "escalate", ...(text !== null ? { text } : {}), tokensIn: 0, tokensOut: 0, costUsd: "0" };
      }
      if (isGoalNotUnderstood(result.payload)) {
        return { outcome: "not_mine", ...(text !== null ? { text } : {}), tokensIn: 0, tokensOut: 0, costUsd: "0" };
      }
      return { outcome: "answered", ...(text !== null ? { text } : {}), tokensIn: 0, tokensOut: 0, costUsd: "0" };
    },
  };
}

/** The pipeline's FR-AI-05 `GoalNotUnderstood` fallback. Matched on the payload's
 * own machine-readable `reason` discriminant, never on its prose, so a copy change
 * cannot silently turn a "not mine" into an "answered". `MessagePayload` is a wide
 * discriminated union (cards, confirmations, errors, …) whose members mostly have no
 * `reason`, so this narrows structurally rather than by union member. */
function isGoalNotUnderstood(payload: MessagePayload): boolean {
  return payload.contentType === "Error" && (payload as { reason?: string }).reason === "GoalNotUnderstood";
}

/** Every payload variant that carries user-visible prose exposes it as `text`; the
 * card variants deliberately do not, and `null` is the honest answer there (a
 * delegated answer is text, not a rendered card). */
function textOf(payload: MessagePayload): string | null {
  const text = (payload as { text?: unknown }).text;
  return typeof text === "string" ? text : null;
}
