import { createHash } from 'node:crypto';
import { requireTenantId } from '@/server/context';
import { ExamModuleEntity, ExamTypeEntity, GeneratedQuestionEntity } from '@/server/infrastructure/database';
import { ExamTypeNotFoundError, type ExamTypeCurriculumLinkSummary, type ExamTypeSummary } from '@/server/exam-authoring';
import type { CurriculaRepository } from '@/server/curricula';
import { GeneratedQuestionRepository } from '../infrastructure/generated-question.repository';
import { AppendExamRepository, type AppendInsert, type ModuleIncrement } from '../infrastructure/append-exam.repository';
import { IdempotencyKeyRepository, APPEND_IDEMPOTENCY_SCOPE } from '../infrastructure/idempotency-key.repository';
import { groupIntoModules } from '../domain/group-into-modules';
import { AppendNotSupportedForLegacyZipError } from '../domain/errors';
import type { AppendExamInput } from '../domain/pdf-processing.types';
import { QuestionBankIndexingService } from './question-bank-indexing.service';

/**
 * FR-PDF-10's append-to-existing-Exam-Type business logic (migration plan Phase 6, sub-slice "6c", LLD
 * §7.6). Ported logic from `legacy/api/src/modules/pdf-processing/application/append-exam.service.ts`.
 * Reuses `FinalizeExamService`'s machinery rather than re-implementing it: {@link groupIntoModules} for
 * the source-section grouping algorithm, and the exact `question_key = 'gq_'||generated_question_id`
 * convention that makes append idempotent at the schema level.
 *
 * **Idempotency design (this sub-slice's own exit gate: "re-submitting the same append after a
 * simulated partial failure does not duplicate already-appended questions")** — two independent,
 * layered guards, deliberately not relying on either alone:
 *
 * 1. **Content-level (always active, no header required)**: {@link append} only ever treats a
 *    `generated_question` row as "new" when its own `linked_exam_type_id IS NULL` (mirroring
 *    `FinalizeExamService`'s identical `findEligibleForFinalize` filter). A retried call — whether
 *    because the client never received a response, or because it deliberately reused the same
 *    `Idempotency-Key` — re-derives "new" from the database's current state, not from anything the
 *    first call computed. If every requested id is already linked to *this* exam type (because the
 *    prior attempt's data write already committed), this call becomes a genuine no-op: it returns the
 *    current, already-correct summary and performs no insert at all.
 * 2. **Request-level (`Idempotency-Key` header, LLD §7.6)**: recorded via
 *    `IdempotencyKeyRepository.record`, deliberately NOT in the same transaction as
 *    `AppendExamRepository.appendQuestions`'s data-write transaction (see that repository's own doc
 *    comment for exactly why the split is what makes a genuinely-partial failure safe to retry). A key
 *    that has already been recorded short-circuits straight to the current summary without re-deriving
 *    anything.
 *
 * **Documented judgment call**: a caller that reuses the same `Idempotency-Key` with a *different*
 * `examTypeId`/`ids[]` is not rejected outright — `responseHash` is still computed and stored precisely
 * so a later phase can add that mismatch check without a schema change, but the LLD/spec do not name a
 * dedicated `ErrorCode` for it and this sub-slice's own scope is proving the "same request, retried"
 * case is safe, not building full misuse-detection (matches legacy's own identical deferral).
 *
 * **`APPEND_NOT_SUPPORTED_FOR_LEGACY_ZIP` (FR-PDF-10)**: checked before any other work, against
 * `ExamTypeEntity.origin`.
 */
export class AppendExamService {
  constructor(
    private readonly generatedQuestions: GeneratedQuestionRepository,
    private readonly appendRepository: AppendExamRepository,
    private readonly idempotencyKeys: IdempotencyKeyRepository,
    private readonly questionBankIndexing: QuestionBankIndexingService,
    private readonly curricula: CurriculaRepository,
  ) {}

  /**
   * @throws {ExamTypeNotFoundError} if no such Exam Type exists in this tenant.
   * @throws {AppendNotSupportedForLegacyZipError} if the target Exam Type's `origin` is `ZipImport`.
   */
  async append(sessionId: string, input: AppendExamInput, idempotencyKey?: string): Promise<ExamTypeSummary> {
    const examType = await this.requireExamType(input.examTypeId);
    if (examType.origin === 'ZipImport') {
      throw new AppendNotSupportedForLegacyZipError();
    }

    const requestHash = hashAppendRequest(input.examTypeId, input.ids);
    if (idempotencyKey) {
      const alreadyRecorded = await this.idempotencyKeys.findOne(APPEND_IDEMPOTENCY_SCOPE, idempotencyKey);
      if (alreadyRecorded) {
        return this.currentSummary(examType.id);
      }
    }

    // The content-level idempotency guard (see class doc comment, point 1): only genuinely-unlinked
    // questions are ever appended, so a retry against already-committed data appends nothing new.
    const candidates = await this.generatedQuestions.findManyInSession(sessionId, input.ids);
    const newOnes = candidates.filter((q) => q.linkedExamTypeId === null);

    if (newOnes.length > 0) {
      const existingModules = await this.appendRepository.findModules(examType.id);
      const insert = buildAppendInsert(examType, existingModules, newOnes);
      await this.appendRepository.appendQuestions(insert);

      // Same best-effort (awaited, not detached — see `FinalizeExamService`'s own doc comment
      // "Correction" note) question-bank write `FinalizeExamService` performs after its own transaction
      // commits — an append is exactly as much a "new packaged question" event as a finalize is.
      const tenantId = requireTenantId();
      await this.questionBankIndexing.indexQuestions(tenantId, examType.id, examType.name, insert.questions);
    }

    if (idempotencyKey) {
      await this.idempotencyKeys.record(APPEND_IDEMPOTENCY_SCOPE, idempotencyKey, requestHash);
    }

    return this.currentSummary(examType.id);
  }

  private async requireExamType(id: string): Promise<ExamTypeEntity> {
    const examType = await this.appendRepository.findExamType(id);
    if (!examType) throw new ExamTypeNotFoundError();
    return examType;
  }

  private async currentSummary(examTypeId: string): Promise<ExamTypeSummary> {
    const examType = await this.requireExamType(examTypeId);
    const modules = await this.appendRepository.findModules(examTypeId);
    const curriculumLinks = await this.resolveCurriculumLinks(examTypeId);
    return toSummary(examType, modules, curriculumLinks);
  }

  /** Same resolution `ExamAuthoringService.resolveCurriculumLinks` performs — kept as a duplicate,
   * small method here rather than a shared cross-module helper, since `server/pdf-processing` and
   * `server/exam-authoring` are separate module boundaries and neither owns the other. */
  private async resolveCurriculumLinks(examTypeId: string): Promise<ExamTypeCurriculumLinkSummary[]> {
    const links = await this.appendRepository.findCurriculumLinks(examTypeId);
    const summaries: ExamTypeCurriculumLinkSummary[] = [];
    for (const link of links) {
      const curriculum = await this.curricula.findById(link.curriculumId);
      if (!curriculum) continue;
      summaries.push({
        curriculumId: link.curriculumId,
        curriculumName: curriculum.name,
        contextWeight: link.contextWeight,
        applicableModules: link.applicableModulesJson,
      });
    }
    return summaries;
  }
}

/** SHA-256 of the request's own identity (`examTypeId` + sorted `ids[]`) — sorted so the same set of
 * ids submitted in a different order still hashes identically. */
function hashAppendRequest(examTypeId: string, ids: string[]): string {
  const canonical = JSON.stringify({ examTypeId, ids: [...ids].sort() });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Groups `newOnes` by source section (reusing {@link groupIntoModules}, undeclared modules — FR-PDF-10
 * names no caller-supplied `modules[]` override the way finalize's does), then splits the grouped
 * result into brand-new `exam_module` inserts vs increments against modules the target Exam Type
 * already has (matched by `moduleName`). */
function buildAppendInsert(examType: ExamTypeEntity, existingModules: ExamModuleEntity[], newOnes: GeneratedQuestionEntity[]): AppendInsert {
  const existingByName = new Map(existingModules.map((m) => [m.moduleName, m]));
  const { modules: groupedModules, questions } = groupIntoModules(examType.id, newOnes, undefined);

  const newModules: ExamModuleEntity[] = [];
  const moduleIncrements: ModuleIncrement[] = [];
  for (const grouped of groupedModules) {
    if (existingByName.has(grouped.moduleName)) {
      moduleIncrements.push({ moduleName: grouped.moduleName, increment: grouped.questionCount });
    } else {
      newModules.push(grouped);
    }
  }

  return {
    examTypeId: examType.id,
    newModules,
    moduleIncrements,
    questions,
    appendedGeneratedQuestionIds: newOnes.map((q) => q.id),
    // "Stored value always reflects reality": the real existing total plus the real number of
    // newly-appended questions, never a caller-supplied number.
    newTotalQuestions: examType.totalQuestions + newOnes.length,
  };
}

function toSummary(examType: ExamTypeEntity, modules: ExamModuleEntity[], curriculumLinks: ExamTypeCurriculumLinkSummary[]): ExamTypeSummary {
  return {
    id: examType.id,
    name: examType.name,
    description: examType.description,
    totalQuestions: examType.totalQuestions,
    totalMinutes: examType.totalMinutes,
    stageId: examType.stageId,
    kind: examType.kind,
    origin: examType.origin,
    storagePath: examType.storagePath,
    pendingDeleteAt: examType.pendingDeleteAt,
    createdAt: examType.createdAt,
    updatedAt: examType.updatedAt,
    modules: modules.map((m) => ({ id: m.id, moduleName: m.moduleName, questionCount: m.questionCount })),
    curriculumLinks,
  };
}
