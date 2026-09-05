import type { DataSource } from 'typeorm';
import {
  AttemptEntity,
  AttemptQuestionEntity,
  ExamTypeEntity,
  ExamModuleEntity,
  ExamTypeQuestionEntity,
} from '@/server/infrastructure/database';

/** Everything needed to persist one newly-generated attempt in a single transaction. */
export interface AttemptInsert {
  attempt: AttemptEntity;
  questions: AttemptQuestionEntity[];
}

/** One row of the scoring outcome persisted at submit/lazy-timeout time (LLD §8.7). */
export interface ScoringOutcome {
  status: 'Submitted' | 'TimedOut';
  answeredCount: number;
  correctCount: number;
  wrongCount: number;
  /** The freshly-computed value the caller assembles the response from — distinct from
   * `AttemptEntity.scorePercent`'s raw decimal-column string representation. */
  scorePercent: number;
}

/**
 * Data access for `attempt`/`attempt_question` plus the read-only queries this module needs against
 * `exam-authoring`'s `exam_type`/`exam_module`/`exam_type_question` tables (LLD §1.2 Tier B — "may
 * call TypeORM repositories directly against another module's tables it does not own", the same
 * cross-module read pattern `FinalizeExamService`/`PdfProcessingService` already establish). Ported
 * logic (not code — no NestJS DI/`TenantContextService`, constructed directly with the current tenant
 * `DataSource`) from `legacy/api/src/modules/attempts/infrastructure/repositories/attempts.repository.ts`.
 * Every lookup uses the literal table-name string form (`getRepository<Entity>('table_name')`), never
 * the entity class, per this app's cross-webpack-bundle TypeORM fix
 * (`docs/plans/nextjs-rewrite-phase1-plan.md`'s "Decisions made" #3).
 */
export class AttemptsRepository {
  constructor(private readonly dataSource: DataSource) {}

  // ── Exam Type / bank reads (read-only from this module's perspective) ─────────────────────────

  async findExamTypeById(examTypeId: string): Promise<ExamTypeEntity | null> {
    return this.dataSource.getRepository<ExamTypeEntity>('exam_type').findOne({ where: { id: examTypeId } });
  }

  async findAllExamTypes(): Promise<ExamTypeEntity[]> {
    return this.dataSource.getRepository<ExamTypeEntity>('exam_type').find({ order: { name: 'ASC' } });
  }

  async findModules(examTypeId: string): Promise<ExamModuleEntity[]> {
    return this.dataSource.getRepository<ExamModuleEntity>('exam_module').find({ where: { examTypeId }, order: { moduleName: 'ASC' } });
  }

  async findQuestionsByModule(examTypeId: string, moduleName: string): Promise<ExamTypeQuestionEntity[]> {
    return this.dataSource.getRepository<ExamTypeQuestionEntity>('exam_type_question').find({ where: { examTypeId, moduleName } });
  }

  /** FR-AUTH-5's deletion-guard: true if any `attempt` row for `examTypeId` is currently `InProgress`
   * — closes `ExamAuthoringRepository.hasActiveAttempts`'s Phase 4-era stub forward reference (see
   * that method's own doc comment). Consumed by `server/exam-authoring` via this module's barrel. */
  async hasActiveAttempts(examTypeId: string): Promise<boolean> {
    const row = await this.dataSource.getRepository<AttemptEntity>('attempt').findOne({ where: { examTypeId, status: 'InProgress' } });
    return row !== null;
  }

  /**
   * LLD §8.6's adaptive-history read: "latest answer per question_key for this user... keep first per
   * key" — restricted to `is_correct IS NOT NULL`, which (per `AttemptQuestionEntity.isCorrect`'s own
   * doc comment) is exactly "this question was actually answered before its attempt was scored,"
   * excluding both never-scored (`InProgress`) rows and scored-but-unanswered ones. Ordered by the
   * owning attempt's `start_time DESC` so the in-memory dedup below keeps only the most recent result
   * per key.
   */
  async findAnswerHistory(userId: string, examTypeId: string): Promise<Map<string, boolean>> {
    const rows: { questionKey: string; isCorrect: number }[] = await this.dataSource.query(
      `SELECT aq.question_key AS questionKey, aq.is_correct AS isCorrect
       FROM attempt_question aq
       JOIN attempt a ON a.id = aq.attempt_id
       WHERE a.user_id = ? AND a.exam_type_id = ? AND aq.is_correct IS NOT NULL
       ORDER BY a.start_time DESC`,
      [userId, examTypeId],
    );

    const history = new Map<string, boolean>();
    for (const row of rows) {
      if (!history.has(row.questionKey)) {
        history.set(row.questionKey, Number(row.isCorrect) === 1);
      }
    }
    return history;
  }

  /** The caller's already-in-progress attempt for `(userId, examTypeId)`, if any — the pre-check
   * `AttemptsService.startAttempt` uses to fail fast with a resumable `attemptId` before generating a
   * brand-new selection. Never the sole enforcement mechanism (see {@link insertAttempt}'s doc
   * comment). */
  async findActiveAttempt(userId: string, examTypeId: string): Promise<AttemptEntity | null> {
    return this.dataSource.getRepository<AttemptEntity>('attempt').findOne({ where: { userId, examTypeId, status: 'InProgress' } });
  }

  /**
   * Persists a newly-generated attempt and its questions as one all-or-nothing transaction.
   *
   * **The real concurrency guarantee lives at the database layer, not here or in the service's
   * pre-check** (FR-TAKE-2): `attempt.active_key` (this module's own migration) is a `STORED GENERATED`
   * column that evaluates to `CONCAT(user_id,':',exam_type_id)` only while `status='InProgress'`, and
   * `UNIQUE KEY uq_attempt_active` on that column means MySQL itself rejects a second concurrent
   * `INSERT` for the same (user, examType) while one is still `InProgress` — even if two requests both
   * passed `AttemptsService`'s `findActiveAttempt` pre-check because neither had committed yet. A
   * duplicate-key violation here surfaces as a MySQL `QueryFailedError` (`ER_DUP_ENTRY`/
   * `isDuplicateKeyError`), which `AttemptsService` catches and translates into
   * `AttemptAlreadyInProgressError` after re-querying for the winning attempt's id.
   */
  async insertAttempt(input: AttemptInsert): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      await em.getRepository<AttemptEntity>('attempt').insert(input.attempt);
      if (input.questions.length > 0) {
        await em.getRepository<AttemptQuestionEntity>('attempt_question').insert(input.questions);
      }
    });
  }

  async findAttemptById(id: string): Promise<AttemptEntity | null> {
    return this.dataSource.getRepository<AttemptEntity>('attempt').findOne({ where: { id } });
  }

  async findQuestionByIndex(attemptId: string, questionIndex: number): Promise<AttemptQuestionEntity | null> {
    return this.dataSource.getRepository<AttemptQuestionEntity>('attempt_question').findOne({ where: { attemptId, questionIndex } });
  }

  async findQuestionsForAttempt(attemptId: string): Promise<AttemptQuestionEntity[]> {
    return this.dataSource
      .getRepository<AttemptQuestionEntity>('attempt_question')
      .find({ where: { attemptId }, order: { questionIndex: 'ASC' } });
  }

  async saveAnswer(question: AttemptQuestionEntity): Promise<void> {
    await this.dataSource.getRepository<AttemptQuestionEntity>('attempt_question').save(question);
  }

  /**
   * HLD §10.4's lazy timeout path, and FR-TAKE-7's real submit path, share this one implementation
   * (`closeReason` is the only difference: `'Submitted'` for an explicit `POST .../submit`,
   * `'TimedOut'` for either the lazy on-access path or `AttemptTimeoutSweeper`'s eager backstop). Runs
   * inside a `SELECT ... FOR UPDATE` transaction so two concurrent triggers of the same expired attempt
   * (e.g. a lazy read racing the sweeper, or two concurrent `submit`s) cannot both score-and-close it —
   * the loser's transaction blocks on the row lock, then re-reads a status that is no longer
   * `InProgress` and is a no-op.
   *
   * FR-TAKE-7's scoring rule: "correctness case-insensitively against the correct option," "Score =
   * correct ÷ total questions × 100, rounded to one decimal place," "zero total questions defensively
   * scores 0." An unanswered question's `is_correct` is left `null` (never `false`) — see
   * `AttemptQuestionEntity.isCorrect`'s own doc comment for why that matters to future adaptive
   * history.
   */
  async closeAndScore(attemptId: string, closeReason: 'Submitted' | 'TimedOut'): Promise<ScoringOutcome | null> {
    return this.dataSource.transaction(async (em) => {
      const attemptRepo = em.getRepository<AttemptEntity>('attempt');
      const attempt = await attemptRepo.findOne({ where: { id: attemptId }, lock: { mode: 'pessimistic_write' } });
      if (!attempt || attempt.status !== 'InProgress') {
        // Already closed by a racing caller (or genuinely never existed, though the caller always
        // checks existence first) — nothing to do.
        return null;
      }

      const questionRepo = em.getRepository<AttemptQuestionEntity>('attempt_question');
      const questions = await questionRepo.find({ where: { attemptId } });

      let answeredCount = 0;
      let correctCount = 0;
      for (const question of questions) {
        if (question.selectedOption === null) {
          question.isCorrect = null;
          continue;
        }
        answeredCount += 1;
        const isCorrect = question.selectedOption.toLowerCase() === question.correctAnswer.toLowerCase();
        question.isCorrect = isCorrect;
        if (isCorrect) correctCount += 1;
      }
      await questionRepo.save(questions);

      const wrongCount = answeredCount - correctCount;
      const scorePercent = attempt.totalQuestions === 0 ? 0 : Math.round((correctCount / attempt.totalQuestions) * 1000) / 10;

      attempt.status = closeReason;
      attempt.endTime = new Date();
      attempt.answeredCount = answeredCount;
      attempt.correctCount = correctCount;
      attempt.wrongCount = wrongCount;
      attempt.scorePercent = scorePercent.toFixed(1);
      await attemptRepo.save(attempt);

      return { status: closeReason, answeredCount, correctCount, wrongCount, scorePercent };
    });
  }

  /**
   * `AttemptTimeoutSweeper`'s belt-and-braces candidate query (HLD §10.1, FR-TAKE-6): ids of every
   * `InProgress` attempt whose `deadline_at` has already passed, oldest-deadline-first, capped at
   * `limit`. A plain `SELECT` — the sweeper reuses {@link closeAndScore}'s own `SELECT ... FOR
   * UPDATE`-guarded transaction (the exact same one `AttemptsService`'s lazy path already relies on) to
   * actually close each one, so this method itself needs no locking of its own: whichever of the lazy
   * path or the sweeper gets there first wins, and the other's `closeAndScore` call is a harmless no-op.
   */
  async findTimedOutCandidateIds(limit: number): Promise<string[]> {
    const rows = await this.dataSource
      .getRepository<AttemptEntity>('attempt')
      .createQueryBuilder('a')
      .select('a.id', 'id')
      .where("a.status = 'InProgress'")
      .andWhere('a.deadline_at < NOW(3)')
      .orderBy('a.deadline_at', 'ASC')
      .limit(limit)
      .getRawMany<{ id: string }>();
    return rows.map((r) => r.id);
  }

  /** LLD §7.8: "Own history" / "Tenant-wide (FR-TAKE-9)". `userId` restricts to that member's own
   * attempts; omitted entirely for the tenant-wide admin view. `examTypeId` further narrows either
   * query when supplied. */
  async findHistory(filter: { userId?: string; examTypeId?: string }): Promise<AttemptEntity[]> {
    const where: Record<string, string> = {};
    if (filter.userId) where.userId = filter.userId;
    if (filter.examTypeId) where.examTypeId = filter.examTypeId;
    return this.dataSource.getRepository<AttemptEntity>('attempt').find({ where, order: { startTime: 'DESC' } });
  }
}
