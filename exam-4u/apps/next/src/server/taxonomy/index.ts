import { requireTenantDataSource } from '@/server/context';
import { TaxonomyService } from './application/taxonomy.service';
import { EducationLevelRepository } from './infrastructure/education-level.repository';
import { StageRepository } from './infrastructure/stage.repository';
import { SubjectRepository } from './infrastructure/subject.repository';

export { TaxonomyService, EducationLevelRepository, StageRepository, SubjectRepository };
export type { CreateOrFetchResult, EducationLevelSummary, StageSummary, SubjectSummary } from './domain/taxonomy.types';
export { InvalidNameError, TaxonomyEntryInUseError, TaxonomyEntryNotFoundError } from './domain/errors';

/**
 * `server/taxonomy`'s public barrel (Phase 3) — the Education Level → Stage → Subject hierarchy
 * (FR-TAX-1..4). Nothing outside this module may import `./domain/**`/`./infrastructure/**`/
 * `./application/**` directly (enforced by `apps/next/.eslintrc.cjs`'s `taxonomy` module-boundary
 * rule). `SubjectRepository` is re-exported (not just used internally) because `server/curricula`
 * needs it for Subject-existence validation — the identical cross-module barrel-import pattern
 * `server/users` already establishes for `server/rbac`.
 *
 * {@link getTaxonomyService} builds a fresh instance per call — every collaborator needs the
 * *current request's* tenant-scoped `DataSource` (must only ever be called from inside a
 * `withTenantContext`-wrapped Route Handler), matching every other tenant-scoped module's identical
 * composition-root convention.
 */
export function getTaxonomyService(): TaxonomyService {
  const dataSource = requireTenantDataSource();
  return new TaxonomyService(new EducationLevelRepository(dataSource), new StageRepository(dataSource), new SubjectRepository(dataSource));
}
