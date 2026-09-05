/**
 * LLD §3.7's exact idle-sweep rule, isolated as pure decision logic (no I/O) so it is
 * unit-testable without a database: a conversation the sweep picks up (already
 * `Active` and idle past the timeout — that filtering is the I/O-bound part, done in
 * `application/idle-sweeper.ts`) is marked **Abandoned** if the customer never sent a
 * single message, otherwise **Resolved** (attributed to `AI` — this phase has no
 * human-handoff concept yet, so every non-abandoned closure is AI-resolved).
 */
export interface IdleSweepDecision {
  status: "Abandoned" | "Resolved";
  resolutionType: "Abandoned" | "AI";
}

/** @param customerMessageCount total `message` rows for this conversation with `sender = 'Customer'`. */
export function decideIdleResolution(customerMessageCount: number): IdleSweepDecision {
  return customerMessageCount === 0
    ? { status: "Abandoned", resolutionType: "Abandoned" }
    : { status: "Resolved", resolutionType: "AI" };
}
