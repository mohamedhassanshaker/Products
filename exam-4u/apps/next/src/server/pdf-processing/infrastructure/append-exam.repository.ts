import type { DataSource } from 'typeorm';
import { ExamModuleEntity, ExamTypeCurriculumEntity, ExamTypeEntity, ExamTypeQuestionEntity, GeneratedQuestionEntity } from '@/server/infrastructure/database';
import { OutboxRepository } from '@/server/reliability';

/** One existing `exam_module` row whose `question_count` must be incremented (a new question's
 * grouped module name already exists on the target Exam Type). */
export interface ModuleIncrement {
  moduleName: string;
  increment: number;
}

/** Everything `AppendExamService.append` assembles, after every validation/idempotency check has
 * already passed, for one atomic append write. */
export interface AppendInsert {
  examTypeId: string;
  /** Brand-new `exam_module` rows — grouped module names with no existing row on this Exam Type. */
  newModules: ExamModuleEntity[];
  /** Existing `exam_module` rows whose `question_count` must grow by `increment`. */
  moduleIncrements: ModuleIncrement[];
  questions: ExamTypeQuestionEntity[];
  /** The `generated_question.id`s being appended — every one gets `linked_exam_type_id` set to
   * `examTypeId` in the same transaction as the inserts above. */
  appendedGeneratedQuestionIds: string[];
  /** `exam_type.total_questions`'s new value — always the real, recomputed total (existing + appended),
   * never a delta applied blindly at the SQL layer. */
  newTotalQuestions: number;
}

/**
 * Data access for FR-PDF-10's append write (LLD §7.6). Deliberately its own repository (not folded into
 * `FinalizeExamRepository` or `ExamAuthoringRepository`) — append's write shape genuinely differs from
 * finalize's (it *updates* `exam_type.total_questions` and may *increment* an already-existing
 * `exam_module.question_count` rather than only ever inserting brand-new rows).
 *
 * **Why this is a separate transaction from `IdempotencyKeyRepository.record`, not one combined
 * transaction (the core idempotency design decision this sub-slice's exit gate depends on)** —
 * ported verbatim rationale from legacy: `AppendExamService.append` decides which questions are "new"
 * by checking `generated_question.linked_exam_type_id IS NULL` *before* this transaction runs. If the
 * idempotency-key bookkeeping write were inside the SAME transaction as the data write, a failure in
 * that bookkeeping step would roll back the entire append — including parts the caller has no way to
 * know failed. Keeping the two writes in genuinely separate transactions means: (1) the authoritative
 * data write (modules, questions, counts, `generated_question` links, the `examType.appended` outbox
 * event) either fully commits or fully rolls back on its own, and (2) a failure *after* that commit
 * (recording the idempotency key) never re-runs the data write on retry — `AppendExamService.append`'s
 * own re-derivation of "which ids are still unlinked" naturally finds zero on a retry against
 * already-committed data, so the second attempt becomes a genuine no-op that only needs to (re)record
 * the bookkeeping row. This is the "genuine partial failure survives a retry without duplicating
 * questions" guarantee this sub-slice's exit gate names.
 */
export class AppendExamRepository {
  private readonly outbox: OutboxRepository;

  constructor(private readonly dataSource: DataSource) {
    this.outbox = new OutboxRepository(dataSource);
  }

  async findExamType(id: string): Promise<ExamTypeEntity | null> {
    return this.dataSource.getRepository<ExamTypeEntity>('exam_type').findOne({ where: { id } });
  }

  async findModules(examTypeId: string): Promise<ExamModuleEntity[]> {
    return this.dataSource.getRepository<ExamModuleEntity>('exam_module').find({ where: { examTypeId } });
  }

  /** Read-side counterpart of `ExamAuthoringRepository.findCurriculumLinks` — append never mutates
   * `exam_type_curriculum` itself, but `currentSummary`'s `ExamTypeSummary` must still reflect any links
   * a prior finalize already created, the same "closed the write-only gap" fix this dispatch applied on
   * the finalize side. */
  async findCurriculumLinks(examTypeId: string): Promise<ExamTypeCurriculumEntity[]> {
    return this.dataSource.getRepository<ExamTypeCurriculumEntity>('exam_type_curriculum').find({ where: { examTypeId } });
  }

  /**
   * The authoritative append write — see this class's own doc comment for why it is deliberately its
   * own transaction, separate from the idempotency-key bookkeeping write.
   */
  async appendQuestions(input: AppendInsert): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      if (input.newModules.length > 0) {
        await em.getRepository<ExamModuleEntity>('exam_module').insert(input.newModules);
      }
      for (const increment of input.moduleIncrements) {
        await em
          .getRepository<ExamModuleEntity>('exam_module')
          .createQueryBuilder()
          .update(ExamModuleEntity)
          .set({ questionCount: () => `question_count + ${Number(increment.increment)}` })
          .where('exam_type_id = :examTypeId', { examTypeId: input.examTypeId })
          .andWhere('module_name = :moduleName', { moduleName: increment.moduleName })
          .execute();
      }
      if (input.questions.length > 0) {
        // Defense-in-depth backstop, mirroring `FinalizeExamRepository`'s identical convention: the
        // real duplicate-prevention guard is `AppendExamService`'s own `linked_exam_type_id IS NULL`
        // pre-filter, but `uq_etq_key` still guards against an impossible-in-practice race between two
        // concurrent append calls targeting the same generated_question id.
        await em.getRepository<ExamTypeQuestionEntity>('exam_type_question').insert(input.questions);
      }
      await em.getRepository<ExamTypeEntity>('exam_type').update({ id: input.examTypeId }, { totalQuestions: input.newTotalQuestions });
      if (input.appendedGeneratedQuestionIds.length > 0) {
        await em
          .getRepository<GeneratedQuestionEntity>('generated_question')
          .createQueryBuilder()
          .update(GeneratedQuestionEntity)
          .set({ linkedExamTypeId: input.examTypeId })
          .where('id IN (:...ids)', { ids: input.appendedGeneratedQuestionIds })
          .execute();
      }
      await this.outbox.enqueue(em, 'examType.appended', {
        examTypeId: input.examTypeId,
        appendedQuestionCount: input.questions.length,
        newTotalQuestions: input.newTotalQuestions,
      });
    });
  }
}
