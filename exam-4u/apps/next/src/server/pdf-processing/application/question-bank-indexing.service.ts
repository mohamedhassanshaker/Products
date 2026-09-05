import type { EmbeddingsPort, VectorStorePort } from '@/server/vector';
import type { QdrantVectorStoreAdapter } from '@/server/infrastructure/vector';
import { logger } from '@/server/logging';
import type { ExamTypeQuestionEntity } from '@/server/infrastructure/database';

/**
 * Populates the tenant's `<prefix>_question_bank` Qdrant collection (HLD §6.1) from real
 * `exam_type_question` rows — the write side of "Find similar questions" reviewer tool
 * (`SimilarQuestionsService`, sub-slice "6d"'s own scope).
 *
 * **Scope-adjustment, documented per this dispatch's own explicit instruction**: this class was
 * originally planned as sub-slice "6d"'s own item (its read-side consumer, `SimilarQuestionsService`,
 * genuinely does belong there). Reading `legacy/api/src/modules/pdf-processing/application/
 * finalize-exam.service.ts` and `append-exam.service.ts` before writing THIS sub-slice's own
 * `FinalizeExamService`/`AppendExamService` showed both call `QuestionBankIndexingService.indexQuestions`
 * as a direct, real, fire-and-forget dependency *after their own transaction commits* — not a
 * speculative future integration point. Building `FinalizeExamService`/`AppendExamService` without a
 * working indexing writer would either mean stubbing out a call the legacy code makes unconditionally
 * (a silent behavioral gap this dispatch's own security/completeness discipline rejects) or leaving a
 * `// TODO: index later` comment in a finalize/append path — the same "half-built, dead-end" anti-
 * pattern this project already rejected for `exam_type_curriculum` (Phase 4) and `idempotency_key`
 * (sub-slice "6a"), just inverted (a writer with no reader is a smaller gap than a caller with no
 * callee). The writer therefore ships now, with its read-side consumer (`SimilarQuestionsService`)
 * remaining sub-slice "6d"'s own scope exactly as originally planned.
 *
 * Deliberately its own collaborator (not folded into `FinalizeExamService`/`AppendExamService`) — both
 * callers already sit near this codebase's ~4-5-collaborator convention, and this is a genuinely
 * distinct concern (embeddings + vector-store I/O) neither class's own transaction needs to span.
 *
 * **Point identity**: `pointId(tenantId, "{examTypeId}/{questionKey}")` — a re-finalize-adjacent
 * re-index would overwrite the point in place rather than accumulating a duplicate, matching every
 * other vector writer's identical idempotency precedent (`SemanticDedupService.upsertFingerprint`).
 *
 * **Payload shape**: `tenantId` (applied by the adapter from `scope`), `examTypeId`, `moduleName` plus
 * two unindexed display fields (`examTypeName`, `questionText`) so a reader never needs a second
 * round-trip just to render a result. `examTypeName` is a point-in-time snapshot (not re-synced on a
 * later Exam Type rename) — a documented, acceptable staleness window for a P2/advisory-only tool.
 */
export class QuestionBankIndexingService {
  constructor(
    private readonly vectorStore: VectorStorePort,
    private readonly embeddings: EmbeddingsPort,
    private readonly vectorAdapter: QdrantVectorStoreAdapter,
  ) {}

  /**
   * Embeds and upserts every one of `questions` into the tenant's question-bank collection.
   * **Best-effort, never throws**: an embeddings-provider or Qdrant failure is logged and swallowed
   * rather than propagated — this is called *after* `FinalizeExamService`/`AppendExamService`'s own
   * MySQL transaction has already committed, so a failure here must never look like the finalize/
   * append itself failed. A reviewer simply won't find this particular batch of questions via "Find
   * similar questions" until a future successful (re-)index — acceptable for a P2 advisory tool, unlike
   * the transactional exam-authoring write itself.
   */
  async indexQuestions(tenantId: string, examTypeId: string, examTypeName: string, questions: ExamTypeQuestionEntity[]): Promise<void> {
    if (questions.length === 0) return;
    try {
      const vectors = await this.embeddings.embed(questions.map((q) => q.questionText));
      const points = questions.map((question, index) => ({
        id: this.vectorAdapter.pointId(tenantId, `${examTypeId}/${question.questionKey}`),
        vector: vectors[index],
        payload: {
          examTypeId,
          examTypeName,
          questionKey: question.questionKey,
          moduleName: question.moduleName,
          questionText: question.questionText,
          kind: 'exam_type_question',
        },
      }));
      await this.vectorStore.upsertQuestions({ tenantId }, points);
    } catch (error) {
      logger.error(
        { examTypeId, questionCount: questions.length, err: error instanceof Error ? error : new Error(String(error)) },
        'question_bank.index_failed',
      );
    }
  }
}
