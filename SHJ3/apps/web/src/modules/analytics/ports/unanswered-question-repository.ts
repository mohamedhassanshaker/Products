export const UNANSWERED_QUESTION_STATUSES = [
  "Open",
  "ResolvedAsKnowledge",
  "ResolvedAsFlow",
  "Dismissed",
] as const;
export type UnansweredQuestionStatus = (typeof UNANSWERED_QUESTION_STATUSES)[number];

export interface UnansweredQuestionRow {
  readonly id: string;
  readonly questionText: string;
  readonly clusterKey: string;
  readonly askCount: number;
  readonly firstAskedAt: Date;
  readonly lastAskedAt: Date;
  readonly status: UnansweredQuestionStatus;
  readonly resolutionKnowledgeSourceId: string | null;
  readonly resolutionFlowId: string | null;
  readonly resolvedByStaffUserId: string | null;
  readonly resolvedAt: Date | null;
}

export interface UnansweredQuestionRepository {
  list(status?: UnansweredQuestionStatus): Promise<readonly UnansweredQuestionRow[]>;
  findById(id: string): Promise<UnansweredQuestionRow | null>;
  findByClusterKey(clusterKey: string): Promise<UnansweredQuestionRow | null>;

  /** `ClusterFeedbackAndGaps`'s own upsert — same "never un-resolve on re-seen" rule as
   *  `FeedbackIssueRepository.upsertSeen`. */
  upsertSeen(input: {
    readonly questionText: string;
    readonly clusterKey: string;
    readonly askedAt: Date;
  }): Promise<UnansweredQuestionRow>;

  /** `CK_UnansweredQuestions_resolutionPaired`: exactly one of
   *  `resolutionKnowledgeSourceId`/`resolutionFlowId` is set together with `status` and
   *  `resolvedAt`/`resolvedByStaffUserId`, in one call — "resolved, pointing at nothing"
   *  is unrepresentable through this port, matching the database constraint rather than
   *  merely hoping a caller remembers it. */
  resolve(
    id: string,
    input:
      | {
          readonly status: "ResolvedAsKnowledge";
          readonly resolutionKnowledgeSourceId: string;
          readonly resolvedByStaffUserId: string;
          readonly now: Date;
        }
      | {
          readonly status: "ResolvedAsFlow";
          readonly resolutionFlowId: string;
          readonly resolvedByStaffUserId: string;
          readonly now: Date;
        }
      | {
          readonly status: "Dismissed";
          readonly resolvedByStaffUserId: string;
          readonly now: Date;
        },
  ): Promise<UnansweredQuestionRow>;
}
