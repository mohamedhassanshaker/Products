/**
 * The `escalation.status` lifecycle (LLD §3.9). Deliberately small compared to
 * `tool-call-fsm.ts`'s 9-state machine — only 4 states, but the same "pure, exhaustive,
 * DB-free" convention: a transition table plus a validator so illegal transitions
 * (e.g. approving an already-`Resolved` escalation twice) are rejected before any
 * write is attempted, not discovered by a later `WHERE status = ...` update matching
 * zero rows.
 */
export type EscalationStatusValue = "Waiting" | "InProgress" | "Resolved" | "ReturnedToBot";

export const TERMINAL_ESCALATION_STATUSES: readonly EscalationStatusValue[] = ["Resolved", "ReturnedToBot"];

/** `InProgress -> InProgress` is a legal self-loop: "Reassign" (to a different queue
 * or agent) while a human is still actively working the escalation. */
const EDGES: Record<EscalationStatusValue, EscalationStatusValue[]> = {
  Waiting: ["InProgress"],
  InProgress: ["InProgress", "Resolved", "ReturnedToBot"],
  Resolved: [],
  ReturnedToBot: [],
};

export class IllegalEscalationTransition extends Error {
  constructor(from: EscalationStatusValue, to: EscalationStatusValue) {
    super(`Illegal escalation transition: ${from} -> ${to}`);
    this.name = "IllegalEscalationTransition";
  }
}

export function isTerminalEscalationStatus(status: EscalationStatusValue): boolean {
  return TERMINAL_ESCALATION_STATUSES.includes(status);
}

/** Validates one proposed transition; throws `IllegalEscalationTransition` rather
 * than returning a boolean, matching `tool-call-fsm.ts`'s convention (a caller that
 * forgets to check a boolean silently proceeds; a caller that forgets to catch a
 * thrown error does not). */
export function assertValidEscalationTransition(from: EscalationStatusValue, to: EscalationStatusValue): void {
  if (!EDGES[from].includes(to)) {
    throw new IllegalEscalationTransition(from, to);
  }
}
