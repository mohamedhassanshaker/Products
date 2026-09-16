import { describe, expect, it } from "vitest";
import {
  FakeFeedbackIssueRepository,
  FakeFeedbackSignalRepository,
  FakeUnansweredQuestionRepository,
} from "../testing/fakes.js";
import { ClusterFeedbackAndGaps } from "./cluster-feedback-and-gaps.js";

const since = new Date("2026-09-01T00:00:00.000Z");
const seenAt = new Date("2026-09-10T10:00:00.000Z");

describe("ClusterFeedbackAndGaps", () => {
  it("clusters two near-duplicate downvotes into one FeedbackIssue with volume 2", async () => {
    const signals = new FakeFeedbackSignalRepository();
    signals.seedDownvotedTurns([
      {
        turnId: "turn_1",
        conversationId: "conv_1",
        questionText: "Why was my SEWA bill higher this month?",
        wasRefused: false,
        hasFailedToolCall: false,
        groundingConfidence: 0.2,
        feedbackUpdatedAt: seenAt,
      },
      {
        turnId: "turn_2",
        conversationId: "conv_2",
        questionText: "  Why was my SEWA bill higher this month?  ",
        wasRefused: false,
        hasFailedToolCall: false,
        groundingConfidence: 0.1,
        feedbackUpdatedAt: seenAt,
      },
    ]);
    const issues = new FakeFeedbackIssueRepository();
    const questions = new FakeUnansweredQuestionRepository();

    const result = await new ClusterFeedbackAndGaps({ signals, issues, questions }).execute({
      since,
    });

    expect(result.feedbackIssuesSeen).toBe(2);
    const allIssues = await issues.list();
    expect(allIssues).toHaveLength(1);
    expect(allIssues[0]?.volume).toBe(2);
    expect(allIssues[0]?.rootCause).toBe("MissingKnowledge");
  });

  it("classifies GuardrailRefusal for a refused down-voted turn", async () => {
    const signals = new FakeFeedbackSignalRepository();
    signals.seedDownvotedTurns([
      {
        turnId: "turn_1",
        conversationId: "conv_1",
        questionText: "Can I pay someone else's bill?",
        wasRefused: true,
        hasFailedToolCall: false,
        groundingConfidence: 0.9,
        feedbackUpdatedAt: seenAt,
      },
    ]);
    const issues = new FakeFeedbackIssueRepository();
    const questions = new FakeUnansweredQuestionRepository();

    await new ClusterFeedbackAndGaps({ signals, issues, questions }).execute({ since });
    expect((await issues.list())[0]?.rootCause).toBe("GuardrailRefusal");
  });

  it("clusters refused turns into UnansweredQuestions by askCount", async () => {
    const signals = new FakeFeedbackSignalRepository();
    signals.seedRefusedTurns([
      {
        turnId: "turn_1",
        conversationId: "conv_1",
        questionText: "Do you accept Apple Pay?",
        refusedAt: seenAt,
      },
      {
        turnId: "turn_2",
        conversationId: "conv_2",
        questionText: "Do you accept Apple Pay?",
        refusedAt: seenAt,
      },
    ]);
    const issues = new FakeFeedbackIssueRepository();
    const questions = new FakeUnansweredQuestionRepository();

    const result = await new ClusterFeedbackAndGaps({ signals, issues, questions }).execute({
      since,
    });

    expect(result.unansweredQuestionsSeen).toBe(2);
    const allQuestions = await questions.list();
    expect(allQuestions).toHaveLength(1);
    expect(allQuestions[0]?.askCount).toBe(2);
  });

  it("skips a signal with no preceding citizen question to cluster on", async () => {
    const signals = new FakeFeedbackSignalRepository();
    signals.seedDownvotedTurns([
      {
        turnId: "turn_1",
        conversationId: "conv_1",
        questionText: "",
        wasRefused: false,
        hasFailedToolCall: false,
        groundingConfidence: 0.9,
        feedbackUpdatedAt: seenAt,
      },
    ]);
    const issues = new FakeFeedbackIssueRepository();
    const questions = new FakeUnansweredQuestionRepository();

    await new ClusterFeedbackAndGaps({ signals, issues, questions }).execute({ since });
    expect(await issues.list()).toEqual([]);
  });
});
