import { requireTenantDataSource } from '@/server/context';
import { getPermissionResolutionService } from '@/server/rbac';
import { getCurriculaService } from '@/server/curricula';
import { getExamAuthoringService } from '@/server/exam-authoring';
import { getAttemptsService } from '@/server/attempts';
import { PracticeSessionRepository } from '@/server/practice';
import { DashboardService } from './application/dashboard.service';

export { DashboardService };
export type { DashboardSummary, PracticeSessionSummary } from './domain/dashboard.types';

/**
 * `server/dashboard`'s public barrel (migration plan Phase 9 sub-slice "9c" — the migration plan's own
 * "dashboard, aggregates across 3-8, deliberately last" phase-line). Nothing outside this module may
 * import `./domain/**`/`./application/**` directly (enforced by `apps/next/.eslintrc.cjs`'s `dashboard`
 * module-boundary rule).
 *
 * {@link getDashboardService} builds a fresh instance per call, bound to the *current request's*
 * tenant-scoped `DataSource` — must be called inside `withTenantContext`, matching every other
 * tenant-scoped module's composition-root convention. Every collaborator is consumed through its own
 * module's public barrel (`server/curricula`, `server/exam-authoring`, `server/attempts`,
 * `server/practice`) — this module boundary rule cuts both ways, and this is deliberately the one module
 * in the app that legitimately depends on four sibling feature modules at once, since aggregating across
 * them is its entire purpose.
 */
export function getDashboardService(): DashboardService {
  const dataSource = requireTenantDataSource();
  return new DashboardService(
    getPermissionResolutionService(),
    getCurriculaService(),
    getExamAuthoringService(),
    getAttemptsService(),
    new PracticeSessionRepository(dataSource),
  );
}
