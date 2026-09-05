/**
 * ADR-0017 §2.1's boundary, stated as a pure predicate — mirrors
 * `promotion-policy.ts`'s existing convention (dependency-free, DB-free, exhaustively
 * unit-testable) so the same function backs both the console's "is this button even
 * shown" hint and the actual server-side enforcement inside the application service's
 * transaction (never trusted from the client alone).
 *
 * The three clauses of ADR-0017's invariant map onto this function's inputs:
 *   - "existing and immutable" — trivially true by construction; this function is
 *     never given a path to create or mutate a version.
 *   - "of the same agent definition" — `sameAgentDefinition`, checked by the caller
 *     against the route's own path-scoped `agentDefinitionId` (never trusted from the
 *     request body alone — see `emergency-rollback-service.ts`).
 *   - "previously Production, with a recorded passing gate outcome" —
 *     `wasEverProductionWithPassingGate`, re-derived live from `deployment_history`
 *     by the caller (never from the version's *current* status alone — a version that
 *     was Production and has since been superseded still qualifies, per ADR-0017).
 */
export interface EmergencyRollbackCheckInput {
  sameAgentDefinition: boolean;
  wasEverProductionWithPassingGate: boolean;
  /** Trimmed reason string — the caller trims before this check so a whitespace-only
   * reason is rejected the same as an empty one (TypeBox's `minLength` alone would
   * accept `"   "`). */
  trimmedReason: string;
}

export type EmergencyRollbackCheckResult =
  | { allowed: true }
  | { allowed: false; code: "EMERGENCY_ROLLBACK_NOT_ELIGIBLE" | "EMERGENCY_ROLLBACK_REASON_REQUIRED" };

/**
 * ADR-0017's exact eligibility rule. Order matters for which error a caller with
 * multiple problems sees: cross-definition/never-Production is checked first because
 * it's the security-relevant boundary (§2.1); the reason requirement is checked last
 * so a caller who fixes eligibility still hears about a missing reason rather than the
 * two errors alternating depending on request shape.
 */
export function checkEmergencyRollbackEligibility(input: EmergencyRollbackCheckInput): EmergencyRollbackCheckResult {
  if (!input.sameAgentDefinition) {
    return { allowed: false, code: "EMERGENCY_ROLLBACK_NOT_ELIGIBLE" };
  }
  // Draft / EvalGated / HumanReview / Approved-but-never-promoted are all excluded by
  // requiring a recorded passing-gate Production history entry — a version's *current*
  // status is deliberately NOT read here (ADR-0017 §2.1: "checked against the
  // deployment history — not against the version's current status").
  if (!input.wasEverProductionWithPassingGate) {
    return { allowed: false, code: "EMERGENCY_ROLLBACK_NOT_ELIGIBLE" };
  }
  if (input.trimmedReason.length === 0) {
    return { allowed: false, code: "EMERGENCY_ROLLBACK_REASON_REQUIRED" };
  }
  return { allowed: true };
}
