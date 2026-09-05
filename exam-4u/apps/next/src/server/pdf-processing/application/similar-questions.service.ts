import type { EmbeddingsPort, VectorStorePort } from '@/server/vector';
import { getEnv } from '@/server/config';
import { GeneratedQuestionRepository } from '../infrastructure/generated-question.repository';
import { GeneratedQuestionNotFoundError } from '../domain/errors';

/** One near-duplicate match returned by {@link SimilarQuestionsService.findSimilar} — exactly the
 * fields the review screen's "Find similar questions" dialog renders (score badge, Exam Type/module
 * context line, truncated question text) and nothing more (no click-through/navigation target). */
export interface SimilarQuestionMatch {
  score: number;
  examTypeName: string;
  moduleName: string;
  questionText: string;
}

/**
 * Reviewer "Find similar questions" tool (migration plan Phase 6, sub-slice "6d") — ported from
 * `legacy/api/src/modules/pdf-processing/application/similar-questions.service.ts`. Given a
 * still-in-review `generated_question` (a candidate not yet finalized into any Exam Type), embeds its
 * own question text and searches the tenant's `<prefix>_question_bank` collection (populated by
 * `QuestionBankIndexingService`, sub-slice "6c"'s own write side) for already-packaged questions that
 * read as near-duplicates — helping a reviewer spot redundant content before finalizing.
 *
 * **Deliberately its own collaborator, not folded into `QuestionReviewService`** — that class is
 * already near this codebase's ~4-5-collaborator convention; this is a genuinely distinct concern
 * (embeddings + vector-store I/O, no MySQL write of any kind) that does not need any of that class's
 * existing collaborators.
 *
 * **Tenant-wide, not scope-scoped (documented judgment call, ported verbatim from legacy)**:
 * `VectorStorePort.searchQuestions`'s `QuestionFilter` accepts an optional `scopeKey`/`examTypeId`,
 * but this service passes neither `{}` — results deliberately span "other Exam Types, other modules,
 * possibly other sessions never seen on this screen", i.e. the whole tenant's question bank, not one
 * (stage, subject) scope or one Exam Type. A reviewer checking for duplicates cares about *any*
 * pre-existing near-identical question in the tenant, not only ones that happen to share this
 * candidate's own (not-yet-finalized, possibly still-null) subject. Tenant isolation is still fully
 * enforced — the mandatory `{ tenantId }` `TenantScope` passed to `searchQuestions` is the actual
 * isolation boundary the adapter applies server-side (never a client-suppliable filter), so
 * "tenant-wide" only ever means "wide within this one tenant's own points".
 *
 * **Relevance floor is Qdrant's own raw cosine `score_threshold`, not a fused score** (contrast
 * `RetrievalService`, whose floor is applied *after* hybrid fusion) — this tool has no lexical channel
 * at all, so there is nothing to fuse. `env.SIMILAR_QUESTIONS_RELEVANCE_FLOOR` (default `0.75`) is
 * deliberately much higher than `RETRIEVAL_RELEVANCE_FLOOR`'s `0.15` fused-score floor for exactly this
 * reason — a raw, undiluted cosine signal needs to be genuinely high before two questions read as "the
 * same question" rather than merely "on the same topic."
 */
export class SimilarQuestionsService {
  constructor(
    private readonly generatedQuestions: GeneratedQuestionRepository,
    private readonly embeddings: EmbeddingsPort,
    private readonly vectorStore: VectorStorePort,
  ) {}

  /** @throws {GeneratedQuestionNotFoundError} if no such `generated_question` exists in this tenant. */
  async findSimilar(tenantId: string, generatedQuestionId: string): Promise<SimilarQuestionMatch[]> {
    const question = await this.generatedQuestions.findById(generatedQuestionId);
    if (!question) throw new GeneratedQuestionNotFoundError();

    const [queryVector] = await this.embeddings.embed([question.questionText]);
    const env = getEnv();
    const points = await this.vectorStore.searchQuestions(
      { tenantId },
      queryVector,
      {},
      env.SIMILAR_QUESTIONS_LIMIT,
      env.SIMILAR_QUESTIONS_RELEVANCE_FLOOR,
    );

    return points.map((point) => ({
      score: point.score,
      examTypeName: typeof point.payload.examTypeName === 'string' ? point.payload.examTypeName : 'Unknown Exam Type',
      moduleName: typeof point.payload.moduleName === 'string' ? point.payload.moduleName : 'Unknown module',
      questionText: typeof point.payload.questionText === 'string' ? point.payload.questionText : '',
    }));
  }
}
