import type { AttemptHistoryItem } from '@/server/attempts';
import type { PracticeSessionKind, PracticeSessionStatus } from '@/server/infrastructure/database';

/**
 * One row of {@link DashboardSummary}'s "recent practice" section — a deliberately thin projection of
 * `practice_session` (id/kind/requestedCount/status/timestamp only), not the full session detail
 * `GET /api/practice/sessions/:id` already returns. The dashboard is a summary/index surface, not a
 * second copy of Prompt/Lesson Practice's own detail screens.
 */
export interface PracticeSessionSummary {
  id: string;
  kind: PracticeSessionKind;
  status: PracticeSessionStatus;
  requestedCount: number;
  createdAt: Date;
}

/**
 * Migration plan Phase 9 sub-slice "9c" — the read-only tenant dashboard's aggregate shape.
 *
 * **Design judgment call (documented per this dispatch's own instruction, since legacy never built a
 * real dashboard to port — see `docs/plans/nextjs-rewrite-phase9-plan.md`'s "Sub-slice 9c" section for
 * the full write-up)**: every section is **optional**, present only when the acting user actually holds
 * the permission the underlying data requires — the same permission each section's own nav item/route
 * already gates on (`curricula.manage_own` for Curriculum/Practice, `exams.read` for Exam Types,
 * `attempts.read_own` for attempts). A Member with only `attempts.take`/`attempts.read_own` therefore
 * sees an attempts-only dashboard, never a 403 for the whole page and never an empty-looking curricula
 * count of `0` that isn't actually theirs to know. This mirrors `tenant-shell.tsx`'s own
 * `NAV_ITEMS.filter((item) => hasPermission(item.permission))` pattern applied to page *content* instead
 * of nav visibility.
 */
export interface DashboardSummary {
  curricula?: { count: number };
  examTypes?: { count: number };
  attempts?: {
    /** Up to 5 most recent non-in-progress attempts (Submitted/TimedOut), newest first. */
    recent: AttemptHistoryItem[];
    /** The caller's currently in-progress attempt, if any — the dashboard's "continue where you left
     * off" card. `null` when there is none (the ordinary case, not an error state). */
    inProgress: AttemptHistoryItem | null;
  };
  practice?: {
    /** Up to 3 most recent Lesson Practice sessions, newest first. */
    recent: PracticeSessionSummary[];
  };
}
