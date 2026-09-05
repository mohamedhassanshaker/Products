/**
 * `server/attempts`'s wire/domain read shapes (FR-TAKE-1..9) — ported verbatim (field-for-field) from
 * `legacy/api/src/modules/attempts/domain/attempts.types.ts`.
 */

export type AttemptStatus = 'InProgress' | 'Submitted' | 'TimedOut';

/** FR-TAKE-1: discovery listing item. */
export interface AvailableExamSummary {
  id: string;
  name: string;
  description: string | null;
  totalQuestions: number;
  totalMinutes: number;
  moduleCount: number;
}

/** FR-TAKE-1: instructions screen. */
export interface ExamInstructions {
  examTypeId: string;
  name: string;
  description: string | null;
  totalQuestions: number;
  totalMinutes: number;
  modules: { moduleName: string; questionCount: number }[];
}

/** Dev-25b/BL-24 addendum: one associated image, resolved from `server/media`'s
 * `QuestionImageView` at the module boundary (never re-exported directly — see `toImageViews`'s own
 * doc comment in `attempts.service.ts`). */
export interface AttemptQuestionImage {
  id: string;
  storageKey: string;
  altText: string;
  caption: string | null;
  position: 'question_text' | 'option' | 'explanation';
  optionKey: string | null;
  width: number | null;
  height: number | null;
}

export interface AttemptQuestionView {
  questionIndex: number;
  questionText: string;
  options: Record<string, string>;
  selectedOption: string | null;
  images: AttemptQuestionImage[];
}

/** FR-TAKE-2/FR-TAKE-3: `POST /attempts`'s result — the server-authoritative `startTime`/`deadlineAt`/
 * `serverNow` triple the client's display-only countdown timer derives from (HLD §10.4). */
export interface StartAttemptResult {
  attemptId: string;
  examTypeId: string;
  examTypeName: string;
  totalQuestions: number;
  startTime: Date;
  deadlineAt: Date;
  serverNow: Date;
  firstQuestion: AttemptQuestionView;
}

export interface AttemptHeader {
  attemptId: string;
  examTypeName: string;
  status: AttemptStatus;
  totalQuestions: number;
  answeredCount: number;
  startTime: Date;
  deadlineAt: Date;
  serverNow: Date;
}

export interface AnswerResult {
  questionIndex: number;
  selectedOption: string;
}

/** FR-TAKE-6/FR-TAKE-7: `POST /attempts/:id/submit`'s result. */
export interface SubmitResult {
  attemptId: string;
  status: AttemptStatus;
  answeredCount: number;
  correctCount: number;
  wrongCount: number;
  totalQuestions: number;
  scorePercent: number | null;
}

/** FR-TAKE-8: one review-screen row. */
export interface AttemptReviewItem {
  questionIndex: number;
  questionText: string;
  options: Record<string, string>;
  correctAnswer: string;
  selectedOption: string | null;
  isCorrect: boolean | null;
  explanation: string | null;
  images: AttemptQuestionImage[];
}

export interface AttemptReview {
  attemptId: string;
  status: AttemptStatus;
  filter: 'all' | 'wrong';
  items: AttemptReviewItem[];
}

/** FR-TAKE-9: one history-list row (own or admin-wide). */
export interface AttemptHistoryItem {
  attemptId: string;
  userId: string;
  examTypeId: string;
  examTypeName: string;
  status: AttemptStatus;
  totalQuestions: number;
  answeredCount: number;
  correctCount: number;
  wrongCount: number;
  scorePercent: number | null;
  startTime: Date;
  endTime: Date | null;
}
