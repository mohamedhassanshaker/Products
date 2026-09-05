import type { DataSource } from 'typeorm';
import {
  ExamModuleEntity,
  ExamTypeCurriculumEntity,
  ExamTypeEntity,
  ExamTypeQuestionEntity,
  GeneratedQuestionEntity,
} from '@/server/infrastructure/database';
import { OutboxRepository } from '@/server/reliability';

/** Everything `FinalizeExamService.finalize` assembles (entirely in memory, after every validation has
 * already passed) for one atomic finalize write. */
export interface FinalizeInsert {
  examType: ExamTypeEntity;
  modules: ExamModuleEntity[];
  questions: ExamTypeQuestionEntity[];
  curriculumLinks: ExamTypeCurriculumEntity[];
  /** The `generated_question.id`s being finalized — every one of them gets `linked_exam_type_id` set
   * to `examType.id` in the same transaction as the inserts above. */
  finalizedGeneratedQuestionIds: string[];
}

/**
 * Data access for FR-PDF-9's finalize write (LLD §8.5's sequence: "BEGIN; INSERT exam_type; INSERT
 * exam_module...; INSERT exam_type_question...; UPDATE generated_question SET linked_exam_type_id;
 * INSERT exam_type_curriculum...; COMMIT"). Deliberately its own repository (not folded into
 * `ExamAuthoringRepository` or `GeneratedQuestionRepository`) — this single method genuinely needs one
 * atomic transaction spanning FOUR tables across TWO modules' entities (`exam_type`/`exam_module`/
 * `exam_type_question`/`exam_type_curriculum` — conceptually owned by `server/exam-authoring` —
 * `generated_question`, owned by this module). Every tenant-schema entity in this app lives centrally
 * under `server/infrastructure/database`, so importing them here directly (rather than through
 * `server/exam-authoring`'s own barrel, which the module-boundary rule would reject) is the same "plain
 * data-mapping classes, not owned business objects" precedent `ExamAuthoringRepository`/
 * `AppendExamRepository` already rely on.
 *
 * **Why the `generated_question.linked_exam_type_id` update happens here, not via
 * `GeneratedQuestionRepository.update`**: a failure partway through this transaction (e.g. the
 * `exam_type_curriculum` insert violating `chk_ctx_weight`) must roll back an already-attempted
 * `generated_question` link too — doing the update inside the SAME `EntityManager` this method's own
 * `dataSource.transaction()` call opens is what makes "no partial Exam Type is left behind" hold for the
 * AI-pipeline finalize path (mirroring FR-AUTH-1's identical ZIP-path guarantee).
 *
 * The `outbox_message('examType.finalized')` insert is written with the SAME transactional
 * `EntityManager`, so the event is durably recorded atomically with the Exam Type it describes — a
 * finalize that rolls back never leaves a dangling event for an Exam Type that was never actually
 * created.
 */
export class FinalizeExamRepository {
  private readonly outbox: OutboxRepository;

  constructor(private readonly dataSource: DataSource) {
    this.outbox = new OutboxRepository(dataSource);
  }

  async finalize(input: FinalizeInsert): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      await em.getRepository<ExamTypeEntity>('exam_type').insert(input.examType);
      if (input.modules.length > 0) {
        await em.getRepository<ExamModuleEntity>('exam_module').insert(input.modules);
      }
      if (input.questions.length > 0) {
        await em.getRepository<ExamTypeQuestionEntity>('exam_type_question').insert(input.questions);
      }
      if (input.finalizedGeneratedQuestionIds.length > 0) {
        await em
          .getRepository<GeneratedQuestionEntity>('generated_question')
          .createQueryBuilder()
          .update(GeneratedQuestionEntity)
          .set({ linkedExamTypeId: input.examType.id })
          .where('id IN (:...ids)', { ids: input.finalizedGeneratedQuestionIds })
          .execute();
      }
      if (input.curriculumLinks.length > 0) {
        await em.getRepository<ExamTypeCurriculumEntity>('exam_type_curriculum').insert(input.curriculumLinks);
      }
      await this.outbox.enqueue(em, 'examType.finalized', {
        examTypeId: input.examType.id,
        examTypeName: input.examType.name,
        totalQuestions: input.examType.totalQuestions,
      });
    });
  }
}
