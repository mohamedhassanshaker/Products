import type {
  UnansweredQuestionRepository,
  UnansweredQuestionRow,
  UnansweredQuestionStatus,
} from "../ports/unanswered-question-repository.js";

/** B1 tab 3's "Unanswered questions" list. */
export class ListUnansweredQuestions {
  constructor(private readonly deps: { readonly questions: UnansweredQuestionRepository }) {}

  async execute(status?: UnansweredQuestionStatus): Promise<readonly UnansweredQuestionRow[]> {
    return this.deps.questions.list(status);
  }
}
