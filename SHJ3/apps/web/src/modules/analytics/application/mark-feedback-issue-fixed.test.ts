import { describe, expect, it } from "vitest";
import { FakeFeedbackIssueRepository } from "../testing/fakes.js";
import { FeedbackIssueNotFoundError, MarkFeedbackIssueFixed } from "./mark-feedback-issue-fixed.js";

const now = new Date("2026-09-10T10:00:00.000Z");

function seedOpenIssue(issues: FakeFeedbackIssueRepository) {
  issues.seed({
    id: "issue_1",
    questionText: "Why was my SEWA bill higher this month?",
    clusterKey: "a".repeat(64),
    volume: 34,
    rootCause: "MissingKnowledge",
    status: "Open",
    linkedKnowledgeSourceId: null,
    linkedFlowId: null,
    linkedGoldenCaseId: null,
    firstSeenAt: now,
    lastSeenAt: now,
    fixedByStaffUserId: null,
    fixedAt: null,
  });
}

describe("MarkFeedbackIssueFixed", () => {
  it("sets status Fixed with fixedAt/fixedByStaffUserId set together", async () => {
    const issues = new FakeFeedbackIssueRepository();
    seedOpenIssue(issues);

    const result = await new MarkFeedbackIssueFixed({ issues }).execute({
      issueId: "issue_1",
      staffUserId: "staff_1",
      now,
    });

    expect(result.status).toBe("Fixed");
    expect(result.fixedByStaffUserId).toBe("staff_1");
    expect(result.fixedAt).toEqual(now);
  });

  it("throws FeedbackIssueNotFoundError for an unknown id", async () => {
    const issues = new FakeFeedbackIssueRepository();
    await expect(
      new MarkFeedbackIssueFixed({ issues }).execute({
        issueId: "missing",
        staffUserId: "staff_1",
        now,
      }),
    ).rejects.toThrow(FeedbackIssueNotFoundError);
  });
});
