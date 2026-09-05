import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { PracticeSessionEntity, PracticeQuestionEntity, type PracticeQuestionSource } from '@/server/infrastructure/database';

/** One question {@link PracticeSessionRepository.createSession} will persist, shaped independently of
 * any AI-draft or `generated_question` type so this repository has no compile-time dependency on
 * either. */
export interface PracticeQuestionToPersist {
  questionText: string;
  options: Record<string, string>;
  correctAnswer: string;
  explanation: string | null;
  confidenceScore: number;
  source: PracticeQuestionSource;
  sourceRef: string | null;
}

/**
 * Data access for `practice_session`/`practice_question` (migration plan Phase 8) — adapted from
 * `legacy/api/src/modules/practice/infrastructure/repositories/practice-session.repository.ts` to
 * this app's plain-class composition convention (no NestJS DI). Uses the literal table-name string
 * form (`getRepository<Entity>('table_name')`), never the entity class, per this app's
 * cross-webpack-bundle TypeORM fix.
 */
export class PracticeSessionRepository {
  constructor(private readonly dataSource: DataSource) {}

  private sessions() {
    return this.dataSource.getRepository<PracticeSessionEntity>('practice_session');
  }

  private questions() {
    return this.dataSource.getRepository<PracticeQuestionEntity>('practice_question');
  }

  /**
   * Persists one completed Lesson Practice session and its ordered question set atomically (one
   * transaction — `LessonPracticeService` is synchronous end to end, unlike the PDF pipeline's
   * multi-step resumable jobs, so there is no "Generating" row ever durably visible to a reader; the
   * row is written once, already `Completed`).
   */
  async createSession(
    input: {
      userId: string;
      kind: 'LessonDocument' | 'LessonSubject' | 'LessonCurriculum';
      curriculumId: string | null;
      curriculumDocumentId: string | null;
      subjectId: number | null;
      requestedCount: number;
      groundingChunksFound: number;
      reusedFromBank: number;
      generatedNew: number;
    },
    questions: PracticeQuestionToPersist[],
  ): Promise<PracticeSessionEntity> {
    return this.dataSource.transaction(async (em) => {
      const sessionRepo = em.getRepository<PracticeSessionEntity>('practice_session');
      const questionRepo = em.getRepository<PracticeQuestionEntity>('practice_question');

      const sessionEntity = sessionRepo.create({
        id: randomUUID(),
        userId: input.userId,
        kind: input.kind,
        prompt: null,
        curriculumId: input.curriculumId,
        curriculumDocumentId: input.curriculumDocumentId,
        subjectId: input.subjectId,
        requestedCount: input.requestedCount,
        status: 'Completed',
        errorCode: null,
        errorMessage: null,
        groundingChunksFound: input.groundingChunksFound,
        reusedFromBank: input.reusedFromBank,
        generatedNew: input.generatedNew,
        completedAt: new Date(),
      });
      const saved = await sessionRepo.save(sessionEntity);

      const questionEntities = questions.map((q, index) =>
        questionRepo.create({
          id: randomUUID(),
          practiceSessionId: saved.id,
          position: index,
          questionText: q.questionText,
          optionsJson: q.options,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          confidenceScore: q.confidenceScore,
          source: q.source,
          sourceRef: q.sourceRef,
          selectedOption: null,
          isCorrect: null,
        }),
      );
      if (questionEntities.length > 0) {
        await questionRepo.insert(questionEntities);
      }

      return saved;
    });
  }

  async findById(id: string): Promise<PracticeSessionEntity | null> {
    return this.sessions().findOne({ where: { id } });
  }

  /** Phase 9 sub-slice "9c" — the tenant dashboard's own read: this user's most recent Lesson Practice
   * sessions (newest first, `createdAt DESC` since `completedAt` can be `null` for a `Failed` session —
   * `PromptPracticeService` never persists a row at all, so `kind` here is always one of the three
   * `'Lesson*'` values in practice). Reused directly by `server/dashboard`'s composition root rather
   * than duplicated — the same "consume another module's exported repository class directly" pattern
   * `server/practice`'s own `getFullBankAssessmentService` already establishes for `server/pdf-processing`. */
  async findRecentByUser(userId: string, limit: number): Promise<PracticeSessionEntity[]> {
    return this.sessions().find({ where: { userId }, order: { createdAt: 'DESC' }, take: limit });
  }

  /** Ordered by `position` — the exact sequence {@link createSession} wrote, bank-selected questions
   * first, AI shortfall-fill questions last. */
  async findQuestionsForSession(practiceSessionId: string): Promise<PracticeQuestionEntity[]> {
    return this.questions().find({ where: { practiceSessionId }, order: { position: 'ASC' } });
  }

  async findQuestionByPosition(practiceSessionId: string, position: number): Promise<PracticeQuestionEntity | null> {
    return this.questions().findOne({ where: { practiceSessionId, position } });
  }

  /** FR-CUR-6's `POST /api/practice/sessions/:id/answer` — populates `selectedOption`/`isCorrect`.
   * No idempotency check here — matches `AttemptsRepository`'s identical "the service, not the
   * repository, owns the business rule" split. */
  async recordAnswer(id: string, selectedOption: string, isCorrect: boolean): Promise<void> {
    await this.questions().update({ id }, { selectedOption, isCorrect });
  }
}
