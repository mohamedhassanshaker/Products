import type { FeedbackRootCause } from "../domain/feedback-root-cause.js";

export const FEEDBACK_ISSUE_STATUSES = ["Open", "Fixed", "Reopened"] as const;
export type FeedbackIssueStatus = (typeof FEEDBACK_ISSUE_STATUSES)[number];

export interface FeedbackIssueRow {
  readonly id: string;
  readonly questionText: string;
  readonly clusterKey: string;
  readonly volume: number;
  readonly rootCause: FeedbackRootCause;
  readonly status: FeedbackIssueStatus;
  readonly linkedKnowledgeSourceId: string | null;
  readonly linkedFlowId: string | null;
  readonly linkedGoldenCaseId: string | null;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly fixedByStaffUserId: string | null;
  readonly fixedAt: Date | null;
}

export interface FeedbackIssueRepository {
  list(status?: FeedbackIssueStatus): Promise<readonly FeedbackIssueRow[]>;
  findById(id: string): Promise<FeedbackIssueRow | null>;
  findByClusterKey(clusterKey: string): Promise<FeedbackIssueRow | null>;

  /** `ClusterFeedbackAndGaps`'s own upsert: creates a new `Open` issue at `volume: 1`, or
   *  bumps `volume`/`lastSeenAt` on an existing one keyed by `clusterKey`. Never touches
   *  `status`/`fixedAt`/`fixedByStaffUserId` — a re-seen issue does not silently
   *  un-resolve a fix a staff member already recorded. */
  upsertSeen(input: {
    readonly questionText: string;
    readonly clusterKey: string;
    readonly rootCause: FeedbackRootCause;
    readonly seenAt: Date;
  }): Promise<FeedbackIssueRow>;

  /** `CK_FeedbackIssues_fixedPaired`: `status`/`fixedAt`/`fixedByStaffUserId` move
   *  together, in one call, so no caller can produce a row the constraint would reject. */
  setStatus(
    id: string,
    input:
      | { readonly status: "Fixed"; readonly fixedByStaffUserId: string; readonly now: Date }
      | { readonly status: "Reopened" },
  ): Promise<FeedbackIssueRow>;
}
