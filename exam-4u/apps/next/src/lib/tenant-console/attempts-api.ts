import { tenantFetch } from './http-client';

/** Local mirror of `server/attempts`'s `AvailableExamSummary` (FR-TAKE-1). */
export interface AvailableExamSummary {
  id: string;
  name: string;
  description: string | null;
  totalQuestions: number;
  totalMinutes: number;
  moduleCount: number;
}

/** Local mirror of `ExamInstructions`. */
export interface ExamInstructions {
  examTypeId: string;
  name: string;
  description: string | null;
  totalQuestions: number;
  totalMinutes: number;
  modules: { moduleName: string; questionCount: number }[];
}

export type AttemptStatus = 'InProgress' | 'Submitted' | 'TimedOut';

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

/** Local mirror of `StartAttemptResult` — `startTime`/`deadlineAt`/`serverNow` arrive as ISO strings
 * over the wire (JSON has no native `Date`); every consumer parses them with `new Date(...)`. */
export interface StartAttemptResult {
  attemptId: string;
  examTypeId: string;
  examTypeName: string;
  totalQuestions: number;
  startTime: string;
  deadlineAt: string;
  serverNow: string;
  firstQuestion: AttemptQuestionView;
}

export interface AttemptHeader {
  attemptId: string;
  examTypeName: string;
  status: AttemptStatus;
  totalQuestions: number;
  answeredCount: number;
  startTime: string;
  deadlineAt: string;
  serverNow: string;
}

export interface SubmitResult {
  attemptId: string;
  status: AttemptStatus;
  answeredCount: number;
  correctCount: number;
  wrongCount: number;
  totalQuestions: number;
  scorePercent: number | null;
}

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
  startTime: string;
  endTime: string | null;
}

/** `GET /api/attempts/available-exams` (FR-TAKE-1's discovery listing). */
export function listAvailableExams(): Promise<AvailableExamSummary[]> {
  return tenantFetch<AvailableExamSummary[]>('/api/attempts/available-exams', { method: 'GET' });
}

/** `GET /api/exam-types/:id/instructions`. */
export function getInstructions(examTypeId: string): Promise<ExamInstructions> {
  return tenantFetch<ExamInstructions>(`/api/exam-types/${examTypeId}/instructions`, { method: 'GET' });
}

/** `POST /api/attempts` (FR-TAKE-2/FR-TAKE-3). Throws `TenantApiError` with code
 * `ATTEMPT_ALREADY_IN_PROGRESS` (carrying `details.attemptId`) when the caller already has one
 * in-flight — the caller's own resume-dialog trigger. */
export function startAttempt(examTypeId: string): Promise<StartAttemptResult> {
  return tenantFetch<StartAttemptResult>('/api/attempts', { method: 'POST', body: JSON.stringify({ examTypeId }) });
}

/** `GET /api/attempts/:id` — the countdown-anchor header, re-fetched on demand to re-sync the
 * client's display-only timer against the server (HLD §10.4: never client-trusted). */
export function getAttemptHeader(attemptId: string): Promise<AttemptHeader> {
  return tenantFetch<AttemptHeader>(`/api/attempts/${attemptId}`, { method: 'GET' });
}

/** `GET /api/attempts/:id/questions/:index`. */
export function getQuestion(attemptId: string, index: number): Promise<AttemptQuestionView> {
  return tenantFetch<AttemptQuestionView>(`/api/attempts/${attemptId}/questions/${index}`, { method: 'GET' });
}

/** `POST /api/attempts/:id/questions/:index/answer`. */
export function answerQuestion(attemptId: string, index: number, selectedOption: string): Promise<{ questionIndex: number; selectedOption: string }> {
  return tenantFetch(`/api/attempts/${attemptId}/questions/${index}/answer`, { method: 'POST', body: JSON.stringify({ selectedOption }) });
}

/** `POST /api/attempts/:id/submit`. */
export function submitAttempt(attemptId: string): Promise<SubmitResult> {
  return tenantFetch<SubmitResult>(`/api/attempts/${attemptId}/submit`, { method: 'POST' });
}

/** `GET /api/attempts/:id/review?filter=`. */
export function getReview(attemptId: string, filter: 'all' | 'wrong'): Promise<AttemptReview> {
  return tenantFetch<AttemptReview>(`/api/attempts/${attemptId}/review?filter=${filter}`, { method: 'GET' });
}

/** `GET /api/attempts` (FR-TAKE-9's own-history view). */
export function listOwnHistory(examTypeId?: string): Promise<AttemptHistoryItem[]> {
  const qs = examTypeId ? `?examTypeId=${encodeURIComponent(examTypeId)}` : '';
  return tenantFetch<AttemptHistoryItem[]>(`/api/attempts${qs}`, { method: 'GET' });
}
