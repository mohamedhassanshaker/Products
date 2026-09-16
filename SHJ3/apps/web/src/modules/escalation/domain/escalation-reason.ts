/**
 * `EscalationTickets.reason` — the three real triggers (`CK_EscalationTickets_reason`,
 * `prisma/sql/001_constraints.sql` §2.9). Deliberately the same closed set
 * `conversation/ports/escalation-repository.ts` already writes from, and the same set
 * `FlowNodes.handoverReason` draws two of its three values from — see that port's own
 * doc comment ("the SAME closed set... two triggers of the flow node, three reasons in
 * the queue"). This module never invents a fourth value.
 */
export const ESCALATION_REASONS = ["ToolFailure", "UserRequest", "LowConfidence"] as const;
export type EscalationReason = (typeof ESCALATION_REASONS)[number];

/** B8 per-ticket detail's plain-language reason line — "each requires different agent
 *  handling, which is why the reason is shown prominently rather than buried" (wireframe
 *  [rule]). */
export const ESCALATION_REASON_LABELS: Readonly<Record<EscalationReason, string>> = {
  ToolFailure: "Tool call failed twice — auto-escalated per guardrail policy",
  UserRequest: "User requested escalation directly",
  LowConfidence: "Low grounding confidence on the citizen's question",
};

export function isEscalationReason(value: string): value is EscalationReason {
  return (ESCALATION_REASONS as readonly string[]).includes(value);
}
