import type { PermissionResolutionService } from '@/server/rbac';
import type { CurriculaService } from '@/server/curricula';
import type { ExamAuthoringService } from '@/server/exam-authoring';
import type { AttemptsService } from '@/server/attempts';
import type { PracticeSessionRepository } from '@/server/practice';
import type { DashboardSummary, PracticeSessionSummary } from '../domain/dashboard.types';

/** Bounds on the "recent" lists this read-only aggregate surfaces — proportionate to a dashboard's own
 * "at a glance" purpose, not a full paginated history (each section already links out to its own real
 * list screen: `/curricula`, `/exam-types`, `/attempts`, `/practice`). */
const RECENT_ATTEMPTS_LIMIT = 5;
const RECENT_PRACTICE_LIMIT = 3;

/** The permission each section's data actually requires — deliberately the *same* permission string
 * `tenant-shell.tsx`'s own `NAV_ITEMS` gates that section's nav item/route on, so a user who can already
 * reach a feature via its own nav item sees its summary here too, and no more. */
const CURRICULA_PERMISSION = 'curricula.manage_own';
const EXAM_TYPES_PERMISSION = 'exams.read';
const ATTEMPTS_PERMISSION = 'attempts.read_own';
/** Practice's dashboard section reuses the same permission Prompt Practice's own nav item/route
 * requires (`curricula.manage_own` — see `tenant-shell.tsx`'s own doc comment for why Practice is gated
 * on this permission rather than a dedicated one). */
const PRACTICE_PERMISSION = 'curricula.manage_own';

/**
 * `server/dashboard`'s only business logic (migration plan Phase 9 sub-slice "9c") — a genuinely new
 * feature (legacy never built a real aggregating dashboard; see this module's own barrel doc comment
 * and `docs/plans/nextjs-rewrite-phase9-plan.md`'s "Sub-slice 9c" section for the full judgment-call
 * write-up), so there is no legacy service to port logic from.
 *
 * **Deliberately read-only and additive-query-only**: every number/list here is produced by calling
 * another module's *already-existing* service/repository method (`CurriculaService.list`,
 * `ExamAuthoringService.list`, `AttemptsService.listOwnHistory`, the one new
 * `PracticeSessionRepository.findRecentByUser`) — this class owns zero query logic of its own beyond
 * "ask each module for what it already knows, then reshape/truncate/permission-gate the result." This is
 * the "reuse existing repositories/services... do not duplicate their query logic" instruction taken
 * literally.
 *
 * **Five collaborators, not the usual ≤4-5** — flagged deliberately: an aggregator whose entire purpose
 * is "summarize across Phases 3-8" structurally needs one collaborator per aggregated module (plus
 * `PermissionResolutionService` for the per-section visibility gate below); splitting it further would
 * just move the same five calls into a second, equally-coupled class with no real decoupling benefit.
 */
export class DashboardService {
  constructor(
    private readonly permissions: PermissionResolutionService,
    private readonly curricula: CurriculaService,
    private readonly examAuthoring: ExamAuthoringService,
    private readonly attempts: AttemptsService,
    private readonly practiceSessions: PracticeSessionRepository,
  ) {}

  /**
   * Builds the acting user's dashboard summary — see {@link DashboardSummary}'s own doc comment for the
   * "each section is optional, gated on the same permission its own nav item uses" design.
   */
  async getSummary(actingUserId: string): Promise<DashboardSummary> {
    const summary: DashboardSummary = {};

    if (await this.permissions.hasPermission(actingUserId, CURRICULA_PERMISSION)) {
      const owned = await this.curricula.list(actingUserId);
      summary.curricula = { count: owned.length };
    }

    if (await this.permissions.hasPermission(actingUserId, EXAM_TYPES_PERMISSION)) {
      const examTypes = await this.examAuthoring.list();
      summary.examTypes = { count: examTypes.length };
    }

    if (await this.permissions.hasPermission(actingUserId, ATTEMPTS_PERMISSION)) {
      // `AttemptsService.listOwnHistory` already applies the lazy-timeout path and resolves the caller's
      // own attempts sorted newest-first — nothing here re-derives any of that.
      const history = await this.attempts.listOwnHistory();
      const inProgress = history.find((attempt) => attempt.status === 'InProgress') ?? null;
      const recent = history.filter((attempt) => attempt.status !== 'InProgress').slice(0, RECENT_ATTEMPTS_LIMIT);
      summary.attempts = { recent, inProgress };
    }

    if (await this.permissions.hasPermission(actingUserId, PRACTICE_PERMISSION)) {
      const sessions = await this.practiceSessions.findRecentByUser(actingUserId, RECENT_PRACTICE_LIMIT);
      summary.practice = { recent: sessions.map(toPracticeSessionSummary) };
    }

    return summary;
  }
}

function toPracticeSessionSummary(entity: {
  id: string;
  kind: PracticeSessionSummary['kind'];
  status: PracticeSessionSummary['status'];
  requestedCount: number;
  createdAt: Date;
}): PracticeSessionSummary {
  return {
    id: entity.id,
    kind: entity.kind,
    status: entity.status,
    requestedCount: entity.requestedCount,
    createdAt: entity.createdAt,
  };
}
