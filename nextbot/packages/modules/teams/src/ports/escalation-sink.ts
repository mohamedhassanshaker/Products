import type { DelegationChainEntry } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-06, LLD §14.7.3) — the
 * delegation runtime's escalation seam.
 *
 * **Why a port and not a direct `@nextbot/escalations` import.** FR-ORC-06 requires
 * that "one conversation raises exactly one active `Escalation` record even when
 * multiple team members independently trip an escalation condition in the same
 * run". That guarantee already exists, correctly, in `escalations`: its
 * create-or-attach service (`triggerEscalation`) is backed by the partial unique
 * index `(tenant_id, conversation_id) WHERE status IN ('Waiting','InProgress')` and
 * returns `created: false` for a second concurrent trigger rather than throwing.
 * This module must REUSE that, never re-derive it.
 *
 * `orchestration` already established this exact seam for the identical reason (it
 * returns an `escalationSignal` to the composition root instead of importing
 * `escalations`), and the composition root — the one place both modules are wired
 * together — supplies the adapter. Keeping the seam here means the
 * one-escalation-per-conversation invariant physically cannot be reimplemented in
 * `teams`: there is no code path in this module that could.
 */

/** What a delegation run hands the sink when it escalates. */
export interface DelegationEscalationRequest {
  conversationId: string;
  /** The `agent_run` the delegation ran under — written to
   * `escalation.delegation_run_id` (the column Phase 13 already reserved for
   * exactly this). */
  delegationRunId: string;
  /** FR-ORC-06: "the escalation record carries the full delegation chain, and the
   * human takeover panel renders the whole delegation tree, not just the terminal
   * agent." Merged into `escalation.ai_context_snapshot.delegationChain`. */
  delegationChain: DelegationChainEntry[];
  /** Why the run escalated, in the vocabulary `escalations` already understands. */
  reason: "LowConfidence" | "ToolFailure" | "CustomerRequest" | "SensitiveTopic";
  reasonDetail: Record<string, unknown>;
  /** Everything else the takeover panel shows — merged with `delegationChain` into
   * the escalation's `ai_context_snapshot`. */
  aiContextSnapshot: Record<string, unknown>;
}

export interface DelegationEscalationResult {
  escalationId: string;
  /** `false` when an active escalation already existed for this conversation and was
   * attached to instead — the FR-ORC-06 case. Never an error. */
  created: boolean;
}

/**
 * Implemented by the composition root against `@nextbot/escalations`'
 * `triggerEscalation`. A run configured with NO sink (a pure sandbox dry run with
 * no conversation, say) simply records the `Escalated` outcome on the
 * `delegation_event` and stops — it never invents a second escalation mechanism,
 * and it never lets the supervisor answer in the specialist's place (FR-ORC-10).
 */
export interface EscalationSink {
  escalate(request: DelegationEscalationRequest): Promise<DelegationEscalationResult>;
}
