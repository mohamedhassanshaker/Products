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

/** B1 tab 3's **Reopen** action — clears `fixedAt`/`fixedByStaffUserId` together with
 *  `status`, the other side of `CK_FeedbackIssues_fixedPaired`. */
export class ReopenFeedbackIssue {
  constructor(private readonly deps: { readonly issues: FeedbackIssueRepository }) {}

  async execute(issueId: string): Promise<FeedbackIssueRow> {
    const existing = await this.deps.issues.findById(issueId);
    if (!existing) throw new FeedbackIssueNotFoundError();
    return this.deps.issues.setStatus(issueId, { status: "Reopened" });
  }
}
