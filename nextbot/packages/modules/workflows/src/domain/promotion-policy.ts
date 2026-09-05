import type { EvalRunStatusValue, WorkflowVersionStatusValue } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 15 (BL-47a, FR-WF-01/02/04, LLD §14.6.1) —
 * the workflow-version promotion FSM. Pure, dependency-free (mirrors
 * `agent-platform/domain/promotion-policy.ts` EXACTLY, per this phase's own dispatch
 * brief) — one function backs both the `allowedTransitions` hint the console uses to
 * HIDE (not merely disable) an unavailable action, and the real enforcement inside
 * the application service's transaction, so the two can never disagree and the
 * client's opinion is never trusted.
 *
 * **The one addition over agent-platform's ladder, and the one deliberate omission**:
 *  - Addition: `HumanReview -> Approved` additionally requires a real, verified sandbox
 *    run (LLD §14.6.1).
 *
 *    **Target Architecture Blueprint Phase 16 (BL-47b) completes this check.** Phase 15
 *    could only test `sandboxRunId !== null`, because `workflow_run` did not exist and
 *    the column was therefore NULL for every version — which correctly made `Approved`
 *    unreachable, as that phase disclosed. Now that runs are real, the full LLD §14.6.1
 *    check is enforced through `sandboxRun` below: the referenced run must belong to
 *    **this exact version**, must have `state = 'Succeeded'`, and must have
 *    **exercised the whole graph** (FR-WF-02(c): "a run of the *whole graph*", ADR-0013
 *    §2.2: "the sandbox run is a completed run of the whole graph, not of nodes in
 *    isolation").
 *
 *    *The exact coverage bar, stated explicitly because the LLD leaves the threshold to
 *    judgement:* **every node reachable from the `Trigger` in the version's own authored
 *    graph must have at least one `workflow_run_step` row in that sandbox run** — any
 *    status, including `Skipped`. Counting `Skipped` is deliberate: a Router branch not
 *    taken is legitimately not executed, and requiring it to run would make any graph
 *    with a Router unpromotable. What the bar does reject is the real failure mode —
 *    a trivial Trigger-to-End run that never touched the rest of the graph. Unreachable
 *    nodes cannot exist to skew the count, because V3 rejects them at save time.
 *  - Omission: agent-platform's `Approved -> Production` check
 *    (`installedGraphTypes.includes(graphType)` + `lastSandboxTestAt`) has no
 *    workflow-version equivalent — `workflow_version` has neither a `graph_type`
 *    column (workflows have no pluggable-engine seam; there is exactly one
 *    executor, Phase 16's) nor a second sandbox-timestamp column distinct from
 *    `sandboxRunId` (already consumed by the `Approved` gate above) — so
 *    `Approved -> Production` here is unconditional once the predecessor state
 *    matches, exactly as agent-platform's own `EvalGated` case is unconditional.
 *
 * **Disclosed, additional consequence of mirroring the eval-gate check exactly**:
 * this phase's own API surface (see `application/workflow-service.ts`) has no
 * endpoint that ever populates `lastEvalRunId` (no eval-run-trigger endpoint is in
 * this phase's scope) — so in THIS phase's build, `EvalGated -> HumanReview` is
 * ALSO unreachable, not merely `HumanReview -> Approved`. Only `Draft` and
 * `<any> -> Deprecated` are reachable end-to-end today. This mirrors the same
 * "schema/gate built correctly now, the mechanism that satisfies it ships later"
 * pattern `team_version`'s own `eval_suite_id`/`last_eval_run_id` columns already
 * established in Phase 14 (its own promotion policy does not implement an eval-run
 * check at all; this phase's brief explicitly asks for the stricter, faithful
 * mirror of agent-platform's real check instead, so that is what is built here).
 */
export interface WorkflowPromotionCheckInput {
  currentStatus: WorkflowVersionStatusValue;
  targetStatus: WorkflowVersionStatusValue;
  /** This version's own id — compared against `sandboxRun.workflowVersionId` so a
   *  sandbox run of a SIBLING version can never satisfy this version's gate. */
  versionId: string;
  createdByUserId: string;
  /** The user attempting this specific transition. `null` represents a system/
   * webhook actor (a Git PR/MR merge event), always treated as distinct from
   * `createdByUserId` — same convention `agent-platform`'s own policy uses. */
  actingUserId: string | null;
  lastEvalRun: { status: EvalRunStatusValue; artifactHash: string } | null;
  /** This version's own `yaml_hash` — compared against `lastEvalRun.artifactHash`
   * so a content change since the last eval run invalidates the gate (same
   * defense-in-depth `agent-platform`'s own check documents). */
  yamlHash: string;
  /** LLD §14.6.1 — required non-null before `Approved`. */
  sandboxRunId: string | null;
  /**
   * Target Architecture Blueprint Phase 16 (BL-47b) — the RESOLVED sandbox run, or
   * `null` when `sandboxRunId` does not resolve to a run of this tenant.
   *
   * Passed in already-resolved (rather than having this function fetch it) so the policy
   * stays pure and dependency-free, exactly like `lastEvalRun` above — one pure function
   * still backs both the console's `allowedTransitions` hint and the real enforcement
   * inside the application service's transaction, so the two can never disagree.
   */
  sandboxRun: {
    workflowVersionId: string;
    state: string;
    /** Distinct `node_id`s that have a `workflow_run_step` row in this run (any status). */
    coveredNodeIds: string[];
  } | null;
  /** Every node id reachable from the `Trigger` in THIS version's authored graph — the
   *  denominator of the coverage bar. Computed from `graph_json`, never from the run. */
  reachableNodeIds: string[];
  /** True when a `Production` deployment of this workflow still has live traffic —
   * blocks `Deprecated`, mirroring the agent-version/team-version rule. This build
   * has no workflow deployment/traffic-split surface of its own yet, so every
   * caller in this phase passes `false`; the parameter exists so the policy is
   * correct the day one exists, without a signature change. */
  hasActiveTraffic: boolean;
}

export type WorkflowPromotionCheckResult = { allowed: true } | { allowed: false; reason: string };

/** Required predecessor status for each target (`Deprecated` is reachable from any
 * non-terminal status — "any -> Deprecated"). */
const REQUIRED_PREDECESSOR: Partial<Record<WorkflowVersionStatusValue, WorkflowVersionStatusValue>> = {
  EvalGated: "Draft",
  HumanReview: "EvalGated",
  Approved: "HumanReview",
  Production: "Approved",
};

export function canPromoteWorkflowVersion(input: WorkflowPromotionCheckInput): WorkflowPromotionCheckResult {
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
      if (input.lastEvalRun.artifactHash !== input.yamlHash) {
        return { allowed: false, reason: "The version's content has changed since its last eval run — submit a new eval run first." };
      }
      if (input.lastEvalRun.status !== "Passed") {
        return { allowed: false, reason: `The bound eval suite has not passed (last run status: '${input.lastEvalRun.status}').` };
      }
      return { allowed: true };
    }

    case "Approved": {
      // Eval gate must still hold (defense in depth — this codebase never re-hashes
      // an already-committed version, but the check mirrors agent-platform's own).
      if (!input.lastEvalRun || input.lastEvalRun.artifactHash !== input.yamlHash || input.lastEvalRun.status !== "Passed") {
        return { allowed: false, reason: "The bound eval suite is no longer green for this version's content." };
      }
      // Reviewer != author (four-eyes), mirroring agent-platform's own check —
      // Git-independent by construction, so it enforces "someone other than the
      // author approved this" identically whether or not a PR/MR exists.
      if (input.actingUserId !== null && input.actingUserId === input.createdByUserId) {
        return { allowed: false, reason: "The reviewer approving this version must be different from the person who created it." };
      }
      // LLD §14.6.1's own addition over the agent-version ladder, in full (Phase 16) —
      // see this module's doc for the exact coverage bar and why it counts `Skipped`.
      if (!input.sandboxRunId) {
        return { allowed: false, reason: "This workflow version has no recorded sandbox run. Run it in the sandbox before approving it." };
      }
      if (!input.sandboxRun) {
        return { allowed: false, reason: "This version's recorded sandbox run no longer exists." };
      }
      // A run of a DIFFERENT version proves nothing about this one. Checked before the
      // state check so a misattributed run is reported as misattributed rather than as
      // "not succeeded", which would send a reviewer looking in the wrong place.
      if (input.sandboxRun.workflowVersionId !== input.versionId) {
        return { allowed: false, reason: "The recorded sandbox run belongs to a different version of this workflow." };
      }
      if (input.sandboxRun.state !== "Succeeded") {
        return { allowed: false, reason: `The recorded sandbox run did not succeed (state: '${input.sandboxRun.state}').` };
      }
      const covered = new Set(input.sandboxRun.coveredNodeIds);
      const uncovered = input.reachableNodeIds.filter((id) => !covered.has(id));
      if (uncovered.length > 0) {
        return {
          allowed: false,
          reason:
            `The recorded sandbox run did not exercise the whole graph — ${uncovered.length} reachable node(s) were never reached ` +
            `(${uncovered.slice(0, 5).join(", ")}${uncovered.length > 5 ? ", …" : ""}). FR-WF-02(c) requires a run of the whole graph.`,
        };
      }
      return { allowed: true };
    }

    case "Production":
      // No workflow-version equivalent of agent-platform's graphType/
      // lastSandboxTestAt checks exists (see module doc) — unconditional once the
      // predecessor state matches.
      return { allowed: true };

    default:
      return { allowed: false, reason: `'${targetStatus}' is not a valid promotion target.` };
  }
}

/** The full set of statuses `canPromoteWorkflowVersion` would currently allow from
 * `currentStatus` — backs the API's `allowedTransitions` hint. */
export function allowedWorkflowVersionTransitions(input: Omit<WorkflowPromotionCheckInput, "targetStatus">): WorkflowVersionStatusValue[] {
  const candidates: WorkflowVersionStatusValue[] = ["EvalGated", "HumanReview", "Approved", "Production", "Deprecated"];
  return candidates.filter((targetStatus) => canPromoteWorkflowVersion({ ...input, targetStatus }).allowed);
}
