import type { TenantContext } from "@nextbot/db";
import { attachDelegationContextToEscalation, triggerEscalation } from "@nextbot/escalations";
import { createTurnPipelineSpecialistRunner, type DelegationExecutorDeps, type EscalationSink } from "@nextbot/teams";
import { createAdminMcpEgressPort } from "./mcp-egress.js";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-06, LLD §14.7.3) — the
 * composition root's wiring for a team delegation run.
 *
 * `apps/web` is the ONLY place `@nextbot/teams` and `@nextbot/escalations` are wired
 * together. That is deliberate and structural, not incidental: `teams` declares an
 * `EscalationSink` PORT precisely so it cannot grow its own
 * one-escalation-per-conversation check. FR-ORC-06's guarantee stays exactly where
 * it already lives and is already proven — `escalations`' create-or-attach service,
 * backed by the partial unique index `(tenant_id, conversation_id) WHERE status IN
 * ('Waiting','InProgress')`.
 */

/**
 * The real escalation sink: `triggerEscalation` (create-or-attach) followed by
 * attaching the delegation run id + full chain to whichever escalation won.
 *
 * `created: false` — a second team member escalating in the same run — is NOT an
 * error path: the existing record is returned and the chain is merged into it, which
 * is the FR-ORC-06 case ("one conversation raises exactly one active `Escalation`
 * record even when multiple team members independently trip an escalation condition
 * in the same run").
 *
 * `skipConnectingMessage` is left at its default (post the message): unlike the turn
 * pipeline — which already posted the same copy itself before calling
 * `triggerEscalation` — a delegation run posts no customer-facing message of its own
 * (LLD §14.7.4: delegation is internal-only and adds no `message` row), so without
 * this the customer would see nothing at all when a team run hands off.
 */
export function createDelegationEscalationSink(ctx: TenantContext): EscalationSink {
  return {
    async escalate(request) {
      const { escalation, created } = await triggerEscalation(ctx, {
        conversationId: request.conversationId,
        reason: request.reason,
        reasonDetail: request.reasonDetail,
        aiContextSnapshot: request.aiContextSnapshot,
      });
      await attachDelegationContextToEscalation(ctx, escalation.id, {
        delegationRunId: request.delegationRunId,
        delegationChain: request.delegationChain,
      });
      return { escalationId: escalation.id, created };
    },
  };
}

/**
 * Everything the delegation executor needs, assembled for one request.
 *
 * @param conversationId when absent, no escalation sink is supplied — a run with no
 *   conversation has nothing to escalate INTO, and inventing a conversation to
 *   escalate against would be worse than recording the refusal on the hop.
 */
export function createDelegationDeps(ctx: TenantContext, conversationId: string | null): DelegationExecutorDeps {
  return {
    specialistRunner: createTurnPipelineSpecialistRunner(ctx, { egress: createAdminMcpEgressPort(ctx) }),
    ...(conversationId ? { escalationSink: createDelegationEscalationSink(ctx) } : {}),
  };
}
