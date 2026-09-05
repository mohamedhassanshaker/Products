import type { AgentVersionStatusValue, EvalRunStatusValue, GraphTypeValue } from "@nextbot/contracts";

/**
 * LLD §3.10 promotion-policy state machine (FR-AGT-01/04/06). Pure, dependency-free —
 * no `@nextbot/db` import (dependency-cruiser's `no-db-inside-domain` rule) — so every
 * branch is unit-testable without a database, and the same function backs both the
 * `_allowedTransitions` hint returned to the console (so it can *hide*, not merely
 * disable, an unavailable action) and the actual enforcement inside the application
 * service's transaction (never trusted from the client alone).
 */
export interface PromotionCheckInput {
  currentStatus: AgentVersionStatusValue;
  targetStatus: AgentVersionStatusValue;
  createdByUserId: string | null;
  /** The user attempting this specific transition. `null` represents a system/webhook
   * actor (a Git PR/MR merge event) — always treated as distinct from `createdByUserId`
   * since the actual "did someone else review this" guarantee for that path already
   * came from the tenant's own Git provider's PR/MR review UI (branch protection,
   * required approvals, etc.), which is exactly what triggered the merge webhook in
   * the first place; re-deriving it from webhook payload data is out of this phase's
   * scope (see `git-connection-service.ts`'s doc comment). */
  actingUserId: string | null;
  lastEvalRun: { status: EvalRunStatusValue; definitionHash: string } | null;
  definitionHash: string;
  graphType: GraphTypeValue;
  /** Graph types this deployment can actually execute (ADR-0003 / NFR-12 seam) — only
   * `ADK` and `CustomFSM` in this codebase; `LangGraph`/`PydanticAI` are schema-valid
   * but not installed. */
  installedGraphTypes: readonly GraphTypeValue[];
  /** True if any `deployment` row for this agent/environment still has
   * `trafficSplitPct > 0` and `isActive` — blocks `Deprecated` per LLD §3.10. */
  hasActiveTraffic: boolean;
  /** Phase 7 (client-feedback-batch item 6) — timestamp of this version's first
   * real, completed sandbox conversation turn (`null` if none yet). Required
   * (non-null) for `Approved -> Production`: real customer traffic is the
   * consequence of that specific transition, so it's the one gated here — earlier
   * transitions (e.g. `HumanReview -> Approved`) are unaffected. */
  lastSandboxTestAt: Date | null;
}

export type PromotionCheckResult = { allowed: true } | { allowed: false; reason: string };

/** Required predecessor status for each target (LLD §3.10's arrows) — `Deprecated` is
 * reachable from any non-terminal status ("any -> Deprecated"). */
const REQUIRED_PREDECESSOR: Partial<Record<AgentVersionStatusValue, AgentVersionStatusValue>> = {
  EvalGated: "Draft",
  HumanReview: "EvalGated",
  Approved: "HumanReview",
  Production: "Approved",
};

export function canPromote(input: PromotionCheckInput): PromotionCheckResult {
  const { currentStatus, targetStatus } = input;

  if (currentStatus === targetStatus) {
    return { allowed: false, reason: `Version is already '${targetStatus}'.` };
  }

  if (targetStatus === "Deprecated") {
    if (currentStatus === "Deprecated") return { allowed: false, reason: "Version is already Deprecated." };
    if (input.hasActiveTraffic) {
      return { allowed: false, reason: "This version still has active traffic — reduce its traffic split to 0% before deprecating it." };
    }
    return { allowed: true };
  }

  const requiredPredecessor = REQUIRED_PREDECESSOR[targetStatus];
  if (!requiredPredecessor) {
    return { allowed: false, reason: `'${targetStatus}' is not a valid promotion target.` };
  }
  if (currentStatus !== requiredPredecessor) {
    return { allowed: false, reason: `Cannot promote to '${targetStatus}' from '${currentStatus}' — must be '${requiredPredecessor}' first.` };
  }

  switch (targetStatus) {
    case "EvalGated":
      return { allowed: true };

    case "HumanReview": {
      if (!input.lastEvalRun) {
        return { allowed: false, reason: "No eval run has been submitted for this version yet." };
      }
      if (input.lastEvalRun.definitionHash !== input.definitionHash) {
        return { allowed: false, reason: "The version's content has changed since its last eval run — submit a new eval run first." };
      }
      if (input.lastEvalRun.status !== "Passed") {
        return { allowed: false, reason: `The bound eval suite has not passed (last run status: '${input.lastEvalRun.status}').` };
      }
      return { allowed: true };
    }

    case "Approved": {
      // Eval gate must still hold (a version could sit in HumanReview long enough for
      // a later change to have invalidated the eval run in principle — this codebase
      // never re-hashes an already-committed version, but the check is kept for
      // defense in depth against a future path that could).
      if (!input.lastEvalRun || input.lastEvalRun.definitionHash !== input.definitionHash || input.lastEvalRun.status !== "Passed") {
        return { allowed: false, reason: "The bound eval suite is no longer green for this version's content." };
      }
      // reviewer != author check. ADR-0009's 2026-08-23 amendment (§7(b)) makes this
      // THE approval mechanism — not merely a defense-in-depth backstop alongside PR
      // review — for any version with no `gitPrNumber` (i.e. no Git connection was
      // configured, or PR/MR review was otherwise never opened for it): this check is
      // Git-independent by construction (no field read here comes from git state), so
      // it enforces "a teammate other than the author approved this" exactly the same
      // way whether or not a PR/MR ever existed for the version. When a version *does*
      // have a Git-hosted PR/MR, this check still runs unchanged, alongside whatever
      // review the tenant's own Git provider UI already required before merge — this
      // was always allowed to be a Git-disconnected check, that fact is just now
      // load-bearing rather than incidental.
      if (input.actingUserId !== null && input.actingUserId === input.createdByUserId) {
        return { allowed: false, reason: "The reviewer approving this version must be different from the person who created it." };
      }
      return { allowed: true };
    }

    case "Production": {
      if (!input.installedGraphTypes.includes(input.graphType)) {
        return { allowed: false, reason: `Graph type '${input.graphType}' is not installed in this deployment.` };
      }
      // Phase 7 (client-feedback-batch item 6): this specific transition is the one
      // with real customer-traffic consequence, so it's the one that requires proof
      // a real conversation was actually exercised against this exact version's
      // sandbox preview first — not merely that the Sandbox tab was opened
      // (`lastSandboxTestAt` is only ever set by a genuinely completed turn, see
      // `agent-definition-service.ts`'s `recordSandboxTest` doc comment).
      if (!input.lastSandboxTestAt) {
        return { allowed: false, reason: "Run at least one sandbox test conversation against this version before promoting it to Production." };
      }
      return { allowed: true };
    }

    default:
      return { allowed: false, reason: `'${targetStatus}' is not a valid promotion target.` };
  }
}

/** The full set of statuses `canPromote` would currently allow from `currentStatus` —
 * backs the API's `_allowedTransitions` hint (LLD §3.10: "so the console hides — not
 * merely disables — unavailable actions"). */
export function allowedTransitions(input: Omit<PromotionCheckInput, "targetStatus">): AgentVersionStatusValue[] {
  const candidates: AgentVersionStatusValue[] = ["EvalGated", "HumanReview", "Approved", "Production", "Deprecated"];
  return candidates.filter((targetStatus) => canPromote({ ...input, targetStatus }).allowed);
}
