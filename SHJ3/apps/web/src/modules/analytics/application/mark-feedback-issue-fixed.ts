import type {
  FeedbackIssueRepository,
  FeedbackIssueRow,
} from "../ports/feedback-issue-repository.js";

export class FeedbackIssueNotFoundError extends Error {
  readonly code = "analytics.feedback_issue_not_found";
  constructor() {
    super("No feedback issue with this id.");
    this.name = "FeedbackIssueNotFoundError";
  }
}

/** B1 tab 3's **Mark fixed** action — sets `status='Fixed'` with `fixedAt`/
 *  `fixedByStaffUserId` in the same write `CK_FeedbackIssues_fixedPaired` requires. */
export class MarkFeedbackIssueFixed {
  constructor(private readonly deps: { readonly issues: FeedbackIssueRepository }) {}

  async execute(input: {
    readonly issueId: string;
    readonly staffUserId: string;
    readonly now: Date;
  }): Promise<FeedbackIssueRow> {
    const existing = await this.deps.issues.findById(input.issueId);
    if (!existing) throw new FeedbackIssueNotFoundError();
    return this.deps.issues.setStatus(input.issueId, {
      status: "Fixed",
      fixedByStaffUserId: input.staffUserId,
      now: input.now,
    });
  }
}
