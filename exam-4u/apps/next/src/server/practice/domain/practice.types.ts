/** Framework-free types for FR-CUR-5/FR-CUR-6 (migration plan Phase 8), independent of any Route
 * Handler/DTO concern. Ported from `legacy/api/src/modules/practice/domain/practice.types.ts`. */

/** Validated input to `PromptPracticeService.generate`. */
export interface PromptPracticeInput {
  curriculumId: string;
  prompt: string;
  count: number;
}

/** One generated practice question, deliberately WITHOUT a confidence field on the wire —
 * `docs/design/UX_GUIDELINES.md`'s "Confidence — deliberately not surfaced to the Member" decision
 * (§13.2 in legacy's own guidelines, mirrored here) means `calibrateConfidence` runs internally but
 * its score never reaches the client. */
export interface PromptPracticeQuestion {
  questionText: string;
  options: { key: string; text: string }[];
  correctAnswer: string;
  explanation: string;
  bloomsLevel: number;
}

/** FR-CUR-5: "If generation yields zero usable questions... the session is marked failed with a
 * message... rather than silently returning nothing." A discriminated union (never `questions: []`
 * with no explanation) so a caller can never confuse "zero questions, no comment" with a genuine,
 * actionable failed-session outcome. */
export type PromptPracticeResult =
  | { status: 'completed'; questions: PromptPracticeQuestion[] }
  | { status: 'failed'; message: string };

/**
 * FR-CUR-6's Adaptive Lesson Practice request shape, validated by `LessonPracticeService.generate` —
 * see that class's own doc comment for the exact document-scoped vs. Curriculum-scoped vs.
 * subject-scoped selection rules. `documentId` present means document-scoped (takes precedence over
 * `curriculumId` if both are sent); `curriculumId` present (and `documentId` absent) means
 * Curriculum-scoped multi-document synthesis; neither present means subject-scoped.
 */
export interface LessonPracticeInput {
  stageId: number;
  subjectId: number;
  documentId?: string;
  curriculumId?: string;
  count: number;
}

/** One persisted `practice_question` row, shaped for the wire — includes `position` (unlike
 * {@link PromptPracticeQuestion}, which has no persisted row) since `POST /api/practice/sessions/:id/
 * answer` needs a `position` to answer against. Deliberately still omits `confidenceScore` from the
 * wire shape. */
export interface LessonPracticeQuestion {
  position: number;
  questionText: string;
  options: { key: string; text: string }[];
  correctAnswer: string;
  explanation: string | null;
  selectedOption: string | null;
  isCorrect: boolean | null;
}

/** FR-CUR-6's synchronous generation response — always `'completed'` once
 * `LessonPracticeService.generate` returns (an `EmptyQuestionBankError` is thrown, not returned, for
 * the zero-bank case). */
export interface LessonPracticeResult {
  sessionId: string;
  status: 'completed';
  questions: LessonPracticeQuestion[];
}
