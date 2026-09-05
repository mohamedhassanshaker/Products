import { requireTenantDataSource } from '@/server/context';
import { getStoragePortSingleton } from '@/server/files';
import { getSubjectClassificationService } from '@/server/pdf-processing';
import { CurriculaRepository } from '@/server/curricula';
import { ExamAuthoringService } from './application/exam-authoring.service';
import { ExamAuthoringRepository } from './infrastructure/exam-authoring.repository';

export { ExamAuthoringService, ExamAuthoringRepository };
export type { ExamTypeInsert } from './infrastructure/exam-authoring.repository';
export type {
  CreateExamTypeFromZipInput,
  DeclaredModuleInput,
  ExamModuleSummary,
  ExamTypeCurriculumLinkSummary,
  ExamTypeSummary,
} from './domain/exam-authoring.types';
export type { SubjectClassificationResult } from '@/server/pdf-processing';
export {
  ExamTypeHasActiveAttemptsError,
  ExamTypeNameExistsError,
  ExamTypeNotFoundError,
  FileTooLargeError,
  QuestionCountMismatchError,
} from './domain/errors';

/**
 * `server/exam-authoring`'s public barrel (Phase 4) — the manual-ZIP Exam Type authoring flow
 * (FR-AUTH-1/FR-AUTH-3/FR-AUTH-5). `fixSubjectMapping` (FR-AUTH-6) is now part of this module too
 * (Phase 6 sub-slice "6b" — Phase 4 deferred it whole until `AiServicePort` existed; it does now, and
 * so does the shared `SubjectClassificationService` it delegates to, consumed through
 * `server/pdf-processing`'s own public barrel). Nothing outside this module may import `./domain/**`/
 * `./infrastructure/**`/`./application/**` directly (enforced by `apps/next/.eslintrc.cjs`'s
 * `exam-authoring` module-boundary rule).
 *
 * {@link getExamAuthoringService} builds a fresh instance per call — every collaborator needs the
 * *current request's* tenant-scoped `DataSource`, matching every other tenant-scoped module's identical
 * composition-root convention. The `StoragePort` singleton is consumed through `server/files`'s own
 * public barrel (`getStoragePortSingleton`) — the same process-wide instance `POST /api/profile/picture`
 * and `GET /api/files/d/[...path]` already share — never a deep import into `server/infrastructure/
 * storage` directly, which this module boundary rule would reject.
 */
export function getExamAuthoringService(): ExamAuthoringService {
  const dataSource = requireTenantDataSource();
  return new ExamAuthoringService(
    new ExamAuthoringRepository(dataSource),
    getStoragePortSingleton(),
    getSubjectClassificationService(),
    new CurriculaRepository(dataSource),
  );
}
