import { tenantFetch } from './http-client';

/**
 * Tenant dashboard client (migration plan Phase 9 sub-slice "9c"). Local mirror of
 * `server/dashboard`'s `DashboardSummary`/`AttemptHistoryItem`/`PracticeSessionSummary` wire types —
 * matches `billing-api.ts`/`branding-api.ts`'s own established "each `lib/tenant-console/*-api.ts`
 * module keeps its own copy rather than importing server types directly" convention.
 */

export type AttemptStatus = 'InProgress' | 'Submitted' | 'TimedOut';

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

export type PracticeSessionKind = 'Prompt' | 'LessonDocument' | 'LessonSubject' | 'LessonCurriculum';
export type PracticeSessionStatus = 'Generating' | 'Completed' | 'Failed';

export interface PracticeSessionSummary {
  id: string;
  kind: PracticeSessionKind;
  status: PracticeSessionStatus;
  requestedCount: number;
  createdAt: string;
}

/** Every section is optional — present only when the acting user's own permissions entitle them to see
 * it (see `server/dashboard/domain/dashboard.types.ts`'s own doc comment for the full rationale). */
export interface DashboardSummary {
  curricula?: { count: number };
  examTypes?: { count: number };
  attempts?: { recent: AttemptHistoryItem[]; inProgress: AttemptHistoryItem | null };
  practice?: { recent: PracticeSessionSummary[] };
}

/** `GET /api/dashboard` — no dedicated permission required; each section self-gates (see route's own
 * doc comment). */
export function getDashboardSummary(): Promise<DashboardSummary> {
  return tenantFetch<DashboardSummary>('/api/dashboard', { method: 'GET' });
}
