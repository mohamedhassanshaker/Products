import type { DataSource, Repository } from 'typeorm';
import { ExamTypeEntity, ExamModuleEntity, ExamTypeQuestionEntity, ExamTypeCurriculumEntity, AttemptEntity } from '@/server/infrastructure/database';

/** Everything needed to persist one fully-validated Exam Type in a single database transaction —
 * assembled by `ExamAuthoringService` only after ZIP parsing/validation has fully succeeded, so this
 * repository never has to reject a partially-built input. */
export interface ExamTypeInsert {
  examType: ExamTypeEntity;
  modules: ExamModuleEntity[];
  questions: ExamTypeQuestionEntity[];
}

/**
 * Data access for `exam_type`/`exam_module`/`exam_type_question` — ported logic from
 * `legacy/api/src/modules/exam-authoring/infrastructure/repositories/exam-authoring.repository.ts`,
 * adapted to this app's plain-class composition convention (no NestJS DI, no `TenantContextService` —
 * every collaborator is constructed with the current request's tenant `DataSource` directly, matching
 * `CurriculaRepository`/`StageRepository`'s identical shape). Every lookup uses the literal table-name
 * string form (`getRepository<Entity>('table_name')`), never the entity class, per this app's
 * cross-webpack-bundle TypeORM fix (see `docs/plans/nextjs-rewrite-phase1-plan.md`'s "Decisions made"
 * #3).
 */
export class ExamAuthoringRepository {
  private readonly examTypes: Repository<ExamTypeEntity>;

  constructor(private readonly dataSource: DataSource) {
    this.examTypes = dataSource.getRepository<ExamTypeEntity>('exam_type');
  }

  /**
   * Persists an Exam Type and its modules/questions as one all-or-nothing database transaction
   * (FR-AUTH-1: "no partial Exam Type is left behind"). A duplicate `name` surfaces as TypeORM's
   * `QueryFailedError` with MySQL's `ER_DUP_ENTRY` code (translated to `ExamTypeNameExistsError` by
   * `ExamAuthoringService`, mirroring `TaxonomyService`'s identical `isDuplicateKeyError` pattern) —
   * this method does not pre-check uniqueness itself (the same TOCTOU-avoidance reason
   * `TaxonomyService.createOrFetch*`'s doc comment documents).
   *
   * Uses `dataSource.transaction()` (not three separate `insert()` calls against the plain
   * `DataSource`) specifically so a failure partway through (e.g. the `exam_type` insert succeeding but
   * a module/question insert failing on some other constraint) rolls back the `exam_type` row too — the
   * caller (`ExamAuthoringService`) never sees a half-created Exam Type from this method, regardless of
   * which insert failed.
   */
  async insertExamType(input: ExamTypeInsert): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository<ExamTypeEntity>('exam_type').insert(input.examType);
      if (input.modules.length > 0) {
        await manager.getRepository<ExamModuleEntity>('exam_module').insert(input.modules);
      }
      if (input.questions.length > 0) {
        await manager.getRepository<ExamTypeQuestionEntity>('exam_type_question').insert(input.questions);
      }
    });
  }

  async findById(id: string): Promise<ExamTypeEntity | null> {
    return this.examTypes.findOne({ where: { id } });
  }

  async findModules(examTypeId: string): Promise<ExamModuleEntity[]> {
    return this.dataSource
      .getRepository<ExamModuleEntity>('exam_module')
      .find({ where: { examTypeId }, order: { moduleName: 'ASC' } });
  }

  async findAll(): Promise<ExamTypeEntity[]> {
    return this.examTypes.find({ order: { createdAt: 'DESC' } });
  }

  /**
   * FR-AUTH-4's read side — the `exam_type_curriculum` rows linking this Exam Type to one or more
   * Curricula (contextWeight + optional applicable-modules scoping). Written for real by
   * `FinalizeExamService.finalize` (migration plan Phase 6, sub-slice "6c") but, until this method
   * existed, never read back anywhere — `ExamAuthoringService.get`'s own `ExamTypeSummary` had no field
   * for it at all, so a finalized Curriculum link was durable in the database yet invisible on the Exam
   * Type detail screen. Closed here (6c's Playwright-closure follow-up) rather than left as a permanent
   * write-only column, the same "half-built, dead-end" anti-pattern this project already rejects
   * elsewhere (see `exam_type_curriculum`'s own migration history and `idempotency_key`'s).
   */
  async findCurriculumLinks(examTypeId: string): Promise<ExamTypeCurriculumEntity[]> {
    return this.dataSource.getRepository<ExamTypeCurriculumEntity>('exam_type_curriculum').find({ where: { examTypeId } });
  }

  /** Hard-deletes the `exam_type` row; `ON DELETE CASCADE` removes every `exam_module`/
   * `exam_type_question` row scoped to it in the same statement's referential-action pass — no
   * separate delete calls needed here (FR-AUTH-5: "removes its configuration [and] its stored question
   * content"). */
  async delete(id: string): Promise<void> {
    await this.examTypes.delete({ id });
  }

  /**
   * FR-AUTH-5's active-attempts check — closes Phase 4/6's documented `hasActiveAttempts` stub forward
   * reference now that Phase 7's `attempt` table exists. Queries the `attempt` table directly (a plain
   * table-name-string `getRepository` lookup, the same cross-module "read a table this module doesn't
   * own, without importing the owning module's service/repository" pattern
   * `server/attempts/infrastructure/attempts.repository.ts` itself uses in reverse for `exam_type`) —
   * `server/exam-authoring` never imports `server/attempts`'s barrel, avoiding a circular module
   * dependency (Phase 7 depends on Phase 4's tables; Phase 4 must not depend back on Phase 7's module).
   */
  async hasActiveAttempts(examTypeId: string): Promise<boolean> {
    const row = await this.dataSource.getRepository<AttemptEntity>('attempt').findOne({ where: { examTypeId, status: 'InProgress' } });
    return row !== null;
  }
}
