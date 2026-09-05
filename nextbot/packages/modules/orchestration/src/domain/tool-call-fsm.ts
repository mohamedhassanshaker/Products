import type { ToolCallStatusValue } from "@nextbot/contracts";

/** Thrown when code attempts a transition not on the LLD §6.1 diagram. This is
 * always a defect, never a caller-input error — every legitimate business
 * rejection (already decided, expired, ...) is its own typed application-layer
 * error raised *before* calling `transition()`. */
export class IllegalToolCallTransition extends Error {
  constructor(from: ToolCallStatusValue, to: ToolCallStatusValue) {
    super(`Illegal tool_call transition: ${from} -> ${to}`);
    this.name = "IllegalToolCallTransition";
  }
}

/** The exact edge set from LLD §6.1/§6.2's state diagram — the single source of
 * truth every FSM-driving call site (tier-engine, approval-service) must go
 * through via `transitionToolCall()` below, never by writing `status` directly. */
const ALLOWED_TRANSITIONS: Record<ToolCallStatusValue, ToolCallStatusValue[]> = {
  Created: ["PolicyDenied", "Executing", "AwaitingCustomerConfirmation", "AwaitingHumanApproval"],
  PolicyDenied: [],
  AwaitingCustomerConfirmation: ["Executing", "Cancelled", "Expired"],
  AwaitingHumanApproval: ["Executing", "Cancelled", "AwaitingHumanApproval", "Expired"],
  Executing: ["Succeeded", "Failed"],
  Succeeded: [],
  Failed: [],
  Cancelled: [],
  Expired: [],
};

/** Terminal states — a decision/claim attempt against one of these is always a
 * business rejection (already decided / already executing), never an FSM defect. */
export const TERMINAL_STATUSES: ToolCallStatusValue[] = ["PolicyDenied", "Succeeded", "Failed", "Cancelled", "Expired"];

export function isTerminal(status: ToolCallStatusValue): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Validates one `tool_call` state transition against the LLD §6.1 diagram. Pure —
 * takes no dependency on persistence, so it can be exhaustively unit-tested against
 * every edge (and every *non*-edge) without a database.
 *
 * @throws {IllegalToolCallTransition} if `to` is not a documented successor of `from`.
 */
export function transition(from: ToolCallStatusValue, to: ToolCallStatusValue): ToolCallStatusValue {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new IllegalToolCallTransition(from, to);
  }
  return to;
}
