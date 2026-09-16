import { describe, expect, it } from "vitest";
import { FakeUnansweredQuestionRepository } from "../testing/fakes.js";
import {
  ResolveUnansweredQuestion,
  UnansweredQuestionNotFoundError,
} from "./resolve-unanswered-question.js";

const now = new Date("2026-09-10T10:00:00.000Z");

function seedOpenQuestion(questions: FakeUnansweredQuestionRepository) {
  questions.seed({
    id: "gap_1",
    questionText: "Do you accept Apple Pay?",
    clusterKey: "c".repeat(64),
    askCount: 58,
    firstAskedAt: now,
    lastAskedAt: now,
    status: "Open",
    resolutionKnowledgeSourceId: null,
    resolutionFlowId: null,
    resolvedByStaffUserId: null,
    resolvedAt: null,
  });
}

describe("ResolveUnansweredQuestion", () => {
  it("resolves as knowledge with only the knowledge FK set", async () => {
    const questions = new FakeUnansweredQuestionRepository();
    seedOpenQuestion(questions);

    const result = await new ResolveUnansweredQuestion({ questions }).execute({
      questionId: "gap_1",
      resolution: "Knowledge",
      knowledgeSourceId: "ks_1",
      staffUserId: "staff_1",
      now,
    });

    expect(result.status).toBe("ResolvedAsKnowledge");
    expect(result.resolutionKnowledgeSourceId).toBe("ks_1");
    expect(result.resolutionFlowId).toBeNull();
  });

  it("resolves as flow with only the flow FK set", async () => {
    const questions = new FakeUnansweredQuestionRepository();
    seedOpenQuestion(questions);

    const result = await new ResolveUnansweredQuestion({ questions }).execute({
      questionId: "gap_1",
      resolution: "Flow",
      flowId: "flow_1",
      staffUserId: "staff_1",
      now,
    });

    expect(result.status).toBe("ResolvedAsFlow");
    expect(result.resolutionFlowId).toBe("flow_1");
    expect(result.resolutionKnowledgeSourceId).toBeNull();
  });

  it("dismisses with neither resolution FK set", async () => {
    const questions = new FakeUnansweredQuestionRepository();
    seedOpenQuestion(questions);

    const result = await new ResolveUnansweredQuestion({ questions }).execute({
      questionId: "gap_1",
      resolution: "Dismiss",
      staffUserId: "staff_1",
      now,
    });

    expect(result.status).toBe("Dismissed");
    expect(result.resolutionKnowledgeSourceId).toBeNull();
    expect(result.resolutionFlowId).toBeNull();
  });

  it("throws UnansweredQuestionNotFoundError for an unknown id", async () => {
    const questions = new FakeUnansweredQuestionRepository();
    await expect(
      new ResolveUnansweredQuestion({ questions }).execute({
        questionId: "missing",
        resolution: "Dismiss",
        staffUserId: "staff_1",
        now,
      }),
    ).rejects.toThrow(UnansweredQuestionNotFoundError);
  });
});
