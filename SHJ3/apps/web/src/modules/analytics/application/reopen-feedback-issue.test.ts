import { describe, expect, it } from "vitest";
import { FakeFeedbackIssueRepository } from "../testing/fakes.js";
import { FeedbackIssueNotFoundError, ReopenFeedbackIssue } from "./reopen-feedback-issue.js";

const now = new Date("2026-09-10T10:00:00.000Z");

describe("ReopenFeedbackIssue", () => {
  it("clears fixedAt/fixedByStaffUserId together with status", async () => {
    const issues = new FakeFeedbackIssueRepository();
    issues.seed({
      id: "issue_1",
      questionText: "Assistant gave wrong customs fee",
      clusterKey: "b".repeat(64),
      volume: 12,
      rootCause: "StaleSource",
      status: "Fixed",
      linkedKnowledgeSourceId: null,
      linkedFlowId: null,
      linkedGoldenCaseId: null,
      firstSeenAt: now,
      lastSeenAt: now,
      fixedByStaffUserId: "staff_1",
      fixedAt: now,
    });

    const result = await new ReopenFeedbackIssue({ issues }).execute("issue_1");
    expect(result.status).toBe("Reopened");
    expect(result.fixedByStaffUserId).toBeNull();
    expect(result.fixedAt).toBeNull();
  });

  it("throws FeedbackIssueNotFoundError for an unknown id", async () => {
    const issues = new FakeFeedbackIssueRepository();
    await expect(new ReopenFeedbackIssue({ issues }).execute("missing")).rejects.toThrow(
      FeedbackIssueNotFoundError,
    );
  });
});
