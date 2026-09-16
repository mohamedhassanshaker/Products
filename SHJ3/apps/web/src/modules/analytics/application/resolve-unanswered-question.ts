import type {
  UnansweredQuestionRepository,
  UnansweredQuestionRow,
} from "../ports/unanswered-question-repository.js";

export class UnansweredQuestionNotFoundError extends Error {
  readonly code = "analytics.unanswered_question_not_found";
  constructor() {
    super("No unanswered question with this id.");
    this.name = "UnansweredQuestionNotFoundError";
  }
}

export type ResolveUnansweredQuestionInput =
  | {
      readonly questionId: string;
      readonly resolution: "Knowledge";
      readonly knowledgeSourceId: string;
      readonly staffUserId: string;
      readonly now: Date;
    }
  | {
      readonly questionId: string;
      readonly resolution: "Flow";
      readonly flowId: string;
      readonly staffUserId: string;
      readonly now: Date;
    }
  | {
      readonly questionId: string;
      readonly resolution: "Dismiss";
      readonly staffUserId: string;
      readonly now: Date;
    };

/**
 * B1 tab 3's two resolution actions on an unanswered question, plus a dismiss.
 * `CK_UnansweredQuestions_resolutionPaired` requires exactly one of
 * `resolutionKnowledgeSourceId`/`resolutionFlowId` for the two real resolutions and
 * neither for a dismissal — this input's own discriminated-union shape makes "resolved,
 * pointing at nothing" a type error here, before it could ever reach the database as a
 * constraint violation (schema's own rule, enforced a second time, earlier, for a
 * cleaner error message than a raw `CHECK` failure would give a caller).
 */
export class ResolveUnansweredQuestion {
  constructor(private readonly deps: { readonly questions: UnansweredQuestionRepository }) {}

  async execute(input: ResolveUnansweredQuestionInput): Promise<UnansweredQuestionRow> {
    const existing = await this.deps.questions.findById(input.questionId);
    if (!existing) throw new UnansweredQuestionNotFoundError();

    if (input.resolution === "Knowledge") {
      return this.deps.questions.resolve(input.questionId, {
        status: "ResolvedAsKnowledge",
        resolutionKnowledgeSourceId: input.knowledgeSourceId,
        resolvedByStaffUserId: input.staffUserId,
        now: input.now,
      });
    }
    if (input.resolution === "Flow") {
      return this.deps.questions.resolve(input.questionId, {
        status: "ResolvedAsFlow",
        resolutionFlowId: input.flowId,
        resolvedByStaffUserId: input.staffUserId,
        now: input.now,
      });
    }
    return this.deps.questions.resolve(input.questionId, {
      status: "Dismissed",
      resolvedByStaffUserId: input.staffUserId,
      now: input.now,
    });
  }
}
