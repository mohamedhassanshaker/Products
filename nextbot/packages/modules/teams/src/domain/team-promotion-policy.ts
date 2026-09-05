import type { TeamVersionStatusValue } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-11, LLD §14.7.2) — the team
 * version promotion FSM. Pure (`domain/`, no I/O), the same shape and rationale as
 * `agent-platform`'s own `canPromote`: one function backs both the
 * `allowedTransitions` hint the console uses to HIDE unavailable actions and the
 * real enforcement inside the application service's transaction, so the two can
 * never disagree, and the client's opinion is never trusted.
 *
 * The ladder is deliberately identical to the agent-version ladder
 * (`Draft -> EvalGated -> HumanReview -> Approved -> Production`, plus
 * `any -> Deprecated`) — LLD §14.7.2's own wording. A team is a promotable artifact
 * on exactly the same terms as an agent version; giving it a shorter ladder would be
 * a quieter gate for the *higher*-risk artifact.
 */

/** Required predecessor for each target (`Deprecated` is reachable from anything
 * non-terminal). */
const REQUIRED_PREDECESSOR: Partial<Record<TeamVersionStatusValue, TeamVersionStatusValue>> = {
  EvalGated: "Draft",
  HumanReview: "EvalGated",
  Approved: "HumanReview",
  Production: "Approved",
};

export interface TeamPromotionCheckInput {
  currentStatus: TeamVersionStatusValue;
  targetStatus: TeamVersionStatusValue;
  createdByUserId: string;
  /** The user attempting this transition — four-eyes on `HumanReview -> Approved`. */
  actingUserId: string | null;
  /**
   * FR-ORC-11 — the whole-topology sandbox gate. `null` when no `sandbox_run_id` is
   * recorded at all; otherwise the member keys the referenced run produced NO
   * `delegation_event` for. An empty array means the run exercised every member.
   * Resolved by the application service (it needs the database); the decision
   * itself stays here so it is unit-testable and cannot be forgotten by a caller.
   */
  sandboxCoverage: { runId: string; missingMemberKeys: string[] } | null;
  /** True when a `Production` team version already exists for this team and still
   * has live traffic — blocks `Deprecated`, mirroring the agent-version rule. */
  hasActiveTraffic: boolean;
}

export type TeamPromotionCheckResult = { allowed: true } | { allowed: false; reason: string };

/**
 * Decides whether one team-version status transition is permitted.
 *
 * @returns `{allowed: true}`, or `{allowed: false, reason}` with a reason written
 *   for the admin who will read it in the console, not for a log grep.
 */
export function canPromoteTeamVersion(input: TeamPromotionCheckInput): TeamPromotionCheckResult {
  const { currentStatus, targetStatus } = input;

  if (currentStatus === targetStatus) {
    return { allowed: false, reason: `This team version is already '${targetStatus}'.` };
  }
  if (currentStatus === "Deprecated") {
    return { allowed: false, reason: "A Deprecated team version cannot be promoted — author a new version instead." };
  }

  if (targetStatus === "Deprecated") {
    if (input.hasActiveTraffic) {
      return { allowed: false, reason: "This team version is still serving traffic — take it out of Production before deprecating it." };
    }
    return { allowed: true };
  }

  const requiredPredecessor = REQUIRED_PREDECESSOR[targetStatus];
  if (!requiredPredecessor) {
    return { allowed: false, reason: `'${targetStatus}' is not a valid promotion target.` };
  }
  if (currentStatus !== requiredPredecessor) {
    return { allowed: false, reason: `Cannot promote to '${targetStatus}' from '${currentStatus}' — it must be '${requiredPredecessor}' first.` };
  }

  if (targetStatus === "Approved") {
    // FR-ORC-11: "the promotion-gate sandbox-conversation requirement ... must
    // exercise the WHOLE team topology with a visible delegation tree — a
    // supervisor-only sandbox run does not satisfy the gate."
    if (!input.sandboxCoverage) {
      return {
        allowed: false,
        reason: "This team version has no sandbox run recorded. Run the whole team in the sandbox before approving it (FR-ORC-11).",
      };
    }
    if (input.sandboxCoverage.missingMemberKeys.length > 0) {
      return {
        allowed: false,
        reason: `The recorded sandbox run did not delegate to every member — no delegation was traced for: ${input.sandboxCoverage.missingMemberKeys.join(", ")}. A supervisor-only run does not satisfy the promotion gate (FR-ORC-11).`,
      };
    }
    // Four-eyes, matching `team_version_approver_distinct`'s DB CHECK. Enforced
    // here too so the caller gets a readable 422 rather than a raw constraint error.
    if (input.actingUserId !== null && input.actingUserId === input.createdByUserId) {
      return { allowed: false, reason: "A team version must be approved by someone other than its author." };
    }
  }

  return { allowed: true };
}

/** Every target reachable from `currentStatus` under the CURRENT gate state — the
 * console renders exactly these as available actions. */
export function allowedTeamVersionTransitions(input: Omit<TeamPromotionCheckInput, "targetStatus">): TeamVersionStatusValue[] {
  const all: TeamVersionStatusValue[] = ["Draft", "EvalGated", "HumanReview", "Approved", "Production", "Deprecated"];
  return all.filter((target) => canPromoteTeamVersion({ ...input, targetStatus: target }).allowed);
}
