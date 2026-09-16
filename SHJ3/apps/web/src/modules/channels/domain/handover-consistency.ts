/**
 * The cross-entity invariant behind B10 tab 1's rule: "Assistant hours and human-agent
 * hours are separate. The assistant can run 24/7 while escalation is only offered during
 * staffed hours — otherwise users are promised a handover that cannot happen."
 *
 * `WorkingHoursProfile.assistantAvailable247` and `HandoverConfig.offerEscalationOutsideHours`
 * are deliberately separate columns on separate entities (`prisma/tenant/schema.prisma`'s own
 * doc comment on `HandoverConfig`) — there is no shared table row a single CHECK constraint
 * could span, so this invariant is enforced here, in the application layer, at the one moment
 * both values are known together: when the pair is saved.
 *
 * ## What the invalid combination actually is
 *
 * FR-CHAN-05's acceptance criteria are explicit about what each flag does:
 *  - `assistantAvailable247 = false` → "out-of-hours sessions are refused with that message."
 *    No live conversation exists outside working hours at all.
 *  - `assistantAvailable247 = true` → the assistant keeps answering outside hours, and "the
 *    configured message replaces the offer of a handover" (i.e. `offerEscalationOutsideHours`
 *    should be `false` in this shape — the message stands in for the offer).
 *
 * So the one combination that "promises a handover that cannot happen" is
 * `assistantAvailable247 = false` **and** `offerEscalationOutsideHours = true`: offering an
 * escalation outside working hours presupposes a live session to escalate *from*, and with
 * the assistant itself refusing sessions outside hours, that session structurally cannot
 * exist. `assistantAvailable247 = true` with `offerEscalationOutsideHours = true` is NOT
 * rejected here — a live conversation does exist in that shape, so an admin choosing to still
 * offer escalation (e.g. into an overflow/ticket queue answered next business day, rather than
 * a live pickup) is a legitimate configuration choice this function has no basis to refuse.
 *
 * `CK_HandoverConfigs_offerRequiresMessage` (the real SQL CHECK) separately guarantees a
 * `noAgentAvailableMessage` is always present when `offerEscalationOutsideHours = false` — that
 * constraint and this function check different things and both must hold.
 */

export interface HandoverConsistencyInput {
  readonly assistantAvailable247: boolean;
  readonly offerEscalationOutsideHours: boolean;
}

export type HandoverConsistencyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "channels.handover_requires_assistant_available" };

export function checkHandoverConsistency(
  input: HandoverConsistencyInput,
): HandoverConsistencyResult {
  if (!input.assistantAvailable247 && input.offerEscalationOutsideHours) {
    return { ok: false, reason: "channels.handover_requires_assistant_available" };
  }
  return { ok: true };
}
