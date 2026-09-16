import type {
  FeedbackIssueRepository,
  FeedbackIssueRow,
  FeedbackIssueStatus,
} from "../ports/feedback-issue-repository.js";

/** B1 tab 3's thumbs-down review queue. */
export class ListFeedbackIssues {
  constructor(private readonly deps: { readonly issues: FeedbackIssueRepository }) {}

  async execute(status?: FeedbackIssueStatus): Promise<readonly FeedbackIssueRow[]> {
    return this.deps.issues.list(status);
  }
}
