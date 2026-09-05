import { randomUUID } from 'node:crypto';
import { InternalDomainError } from '@/server/common/errors/domain-error';
import { getRequestContext } from '@/server/context';
import type { PermissionResolutionService } from '@/server/rbac';
import type { ImageAssociationService, QuestionImageView } from '@/server/media';
import type { ExamTypeQuestionEntity, AttemptQuestionEntity } from '@/server/infrastructure/database';
import { AttemptEntity } from '@/server/infrastructure/database';
import { AttemptsRepository } from '../infrastructure/attempts.repository';
import { isDuplicateKeyError } from '../infrastructure/mysql-error.util';
import { QuestionBankShortfallError, selectAdaptiveQuestions, shuffleInPlace } from '../domain/adaptive-selection';
import {
  AttemptAlreadyInProgressError,
  AttemptExamTypeNotFoundError,
  AttemptNotFoundError,
  AttemptNotInProgressError,
  AttemptQuestionNotFoundError,
  InsufficientQuestionBankError,
  NotAttemptOwnerError,
} from '../domain/errors';
import type {
  AnswerResult,
  AttemptHeader,
  AttemptHistoryItem,
  AttemptQuestionImage,
  AttemptQuestionView,
  AttemptReview,
  AttemptReviewItem,
  AvailableExamSummary,
  ExamInstructions,
  StartAttemptResult,
  SubmitResult,
} from '../domain/attempts.types';

/** The tenant-wide oversight permission that lets a Tenant Admin review/list *any* Member's attempts
 * (LLD §7.8: "owner or `attempts.read_all`" for review; a dedicated `GET /api/admin/attempts` route
 * for history, per FR-TAKE-9). */
const OVERSIGHT_PERMISSION = 'attempts.read_all';

/**
 * FR-TAKE-1..9's business logic (LLD §1.2 Tier B; LLD §8.6/§8.7 sequence diagrams) — ported logic (not
 * code — no NestJS DI) from `legacy/api/src/modules/attempts/application/attempts.service.ts`.
 *
 * **Server-authoritative timing (HLD §10.4)**: every method that loads a specific attempt routes
 * through {@link loadWithLazyTimeout} first, which — if that attempt is still `InProgress` but its
 * `deadline_at` has already passed — scores and closes it (`status='TimedOut'`) *before* this service
 * does anything else with it, so the very next read or write always observes the correct, already-final
 * state. This is the "lazy path" HLD §10.4 describes; `AttemptTimeoutSweeper` is the belt-and-braces
 * eager backstop for an attempt nobody ever reads again.
 *
 * **Ownership (HLD §5.2 pattern, mirrors `CurriculaService`)**: {@link assertOwner} (header/question/
 * answer/submit — owner only) and {@link assertOwnerOrOversight} (review — owner or
 * `attempts.read_all`) are called only after the attempt has been loaded, since only this service has
 * the loaded row to check `userId` against.
 *
 * `ImageAssociationService` is injected read-only — {@link getQuestion}/{@link review} both resolve
 * `AttemptQuestionEntity.sourceGeneratedQuestionId` into any associated `question_image` rows
 * (FR-PDF-11/FR-FILE-3 UI), via the same batched `listImagesForQuestions` lookup
 * `QuestionReviewService` (Phase 6's other consumer) uses. This class never calls
 * `associateWithQuestion`/`removeAssociation` — no manual add/remove endpoint exists this phase.
 */
export class AttemptsService {
  constructor(
    private readonly repository: AttemptsRepository,
    private readonly permissions: PermissionResolutionService,
    private readonly imageAssociation: ImageAssociationService,
  ) {}

  /** FR-TAKE-1: discovery listing. */
  async listAvailableExams(): Promise<AvailableExamSummary[]> {
    const examTypes = await this.repository.findAllExamTypes();
    const summaries: AvailableExamSummary[] = [];
    for (const examType of examTypes) {
      const modules = await this.repository.findModules(examType.id);
      summaries.push({
        id: examType.id,
        name: examType.name,
        description: examType.description,
        totalQuestions: examType.totalQuestions,
        totalMinutes: examType.totalMinutes,
        moduleCount: modules.length,
      });
    }
    return summaries;
  }

  /** FR-TAKE-1: instructions screen. @throws {AttemptExamTypeNotFoundError} */
  async getInstructions(examTypeId: string): Promise<ExamInstructions> {
    const examType = await this.repository.findExamTypeById(examTypeId);
    if (!examType) throw new AttemptExamTypeNotFoundError();
    const modules = await this.repository.findModules(examTypeId);
    return {
      examTypeId,
      name: examType.name,
      description: examType.description,
      totalQuestions: examType.totalQuestions,
      totalMinutes: examType.totalMinutes,
      modules: modules.map((m) => ({ moduleName: m.moduleName, questionCount: m.questionCount })),
    };
  }

  /**
   * FR-TAKE-2/FR-TAKE-3's full attempt-generation flow (LLD §8.6).
   *
   * @throws {AttemptAlreadyInProgressError} if the caller already has an `InProgress` attempt for this
   *   Exam Type — checked once up front (after applying the lazy-timeout path to that existing
   *   attempt, in case it merely looks in-progress but has already expired) **and** enforced for real
   *   by the database's `uq_attempt_active` unique key (see {@link AttemptsRepository.insertAttempt}'s
   *   doc comment) — the up-front check is an optimization for the non-racing common case, never the
   *   sole guarantee.
   * @throws {AttemptExamTypeNotFoundError} if no such Exam Type exists.
   * @throws {InsufficientQuestionBankError} if any module's bank cannot supply its configured
   *   `questionCount`, naming that module and the shortfall (FR-TAKE-3).
   */
  async startAttempt(examTypeId: string): Promise<StartAttemptResult> {
    const userId = requireUserId();

    const existing = await this.repository.findActiveAttempt(userId, examTypeId);
    if (existing) {
      const refreshed = await this.applyLazyTimeout(existing);
      if (refreshed.status === 'InProgress') {
        throw new AttemptAlreadyInProgressError(refreshed.id);
      }
      // else: the existing attempt just expired and was closed by the lazy path above — falling
      // through to generate a brand-new attempt is correct, not a double-attempt.
    }

    const examType = await this.repository.findExamTypeById(examTypeId);
    if (!examType) throw new AttemptExamTypeNotFoundError();

    const modules = await this.repository.findModules(examTypeId);
    const history = await this.repository.findAnswerHistory(userId, examTypeId);

    const selectedByModule: ExamTypeQuestionEntity[][] = [];
    for (const examModule of modules) {
      const candidates = await this.repository.findQuestionsByModule(examTypeId, examModule.moduleName);
      try {
        selectedByModule.push(selectAdaptiveQuestions(candidates, history, examModule.questionCount));
      } catch (error) {
        if (error instanceof QuestionBankShortfallError) {
          throw new InsufficientQuestionBankError(examModule.moduleName, error.available, error.required);
        }
        throw error;
      }
    }

    // FR-TAKE-2: "the full selection is then shuffled across modules" — a second, independent shuffle
    // after each module's own internal tier-shuffling above.
    const allSelected = shuffleInPlace(selectedByModule.flat());
    if (allSelected.length === 0) {
      // Defensive only — unreachable via the authoring flow (every Exam Type is created with at least
      // one module of at least one question), but guarded rather than letting `questions[0]` below
      // throw an unhandled `TypeError`.
      throw new InsufficientQuestionBankError('(no modules configured)', 0, examType.totalQuestions || 1);
    }

    const now = new Date();
    const deadlineAt = new Date(now.getTime() + examType.totalMinutes * 60_000);
    const attemptId = randomUUID();

    const attempt = new AttemptEntity();
    attempt.id = attemptId;
    attempt.userId = userId;
    attempt.examTypeId = examTypeId;
    attempt.startTime = now;
    attempt.deadlineAt = deadlineAt;
    attempt.endTime = null;
    attempt.status = 'InProgress';
    attempt.totalQuestions = allSelected.length;
    attempt.answeredCount = 0;
    attempt.correctCount = 0;
    attempt.wrongCount = 0;
    attempt.scorePercent = null;

    const questions = allSelected.map((source, index) => buildAttemptQuestion(attemptId, index, source));

    try {
      await this.repository.insertAttempt({ attempt, questions });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        // Lost the real DB-level race (uq_attempt_active) — a concurrent request's INSERT committed
        // first. Re-query so the error still carries a genuinely resumable attemptId.
        const winner = await this.repository.findActiveAttempt(userId, examTypeId);
        throw new AttemptAlreadyInProgressError(winner?.id ?? attemptId);
      }
      throw error;
    }

    const firstQuestionImages = await this.imagesForQuestion(questions[0].sourceGeneratedQuestionId);
    return {
      attemptId,
      examTypeId,
      examTypeName: examType.name,
      totalQuestions: attempt.totalQuestions,
      startTime: now,
      deadlineAt,
      serverNow: now,
      firstQuestion: toQuestionView(questions[0], firstQuestionImages),
    };
  }

  /** @throws {AttemptNotFoundError} @throws {NotAttemptOwnerError} */
  async getHeader(attemptId: string): Promise<AttemptHeader> {
    const attempt = await this.loadWithLazyTimeout(attemptId);
    this.assertOwner(attempt);
    const examType = await this.repository.findExamTypeById(attempt.examTypeId);
    return {
      attemptId: attempt.id,
      examTypeName: examType?.name ?? '',
      status: attempt.status,
      totalQuestions: attempt.totalQuestions,
      answeredCount: attempt.answeredCount,
      startTime: attempt.startTime,
      deadlineAt: attempt.deadlineAt,
      serverNow: new Date(),
    };
  }

  /**
   * FR-TAKE-4: "Navigating to a question index outside the attempt's range, or belonging to a
   * different attempt, is rejected (404, `QUESTION_NOT_FOUND`), never silently clamped." Re-checks
   * `attempt.status` after {@link loadWithLazyTimeout} (which may itself have just closed this attempt
   * as a side effect) so every attempt-scoped access point behaves uniformly per HLD §10.4.
   * @throws {AttemptNotFoundError} @throws {NotAttemptOwnerError} @throws {AttemptNotInProgressError}
   * @throws {AttemptQuestionNotFoundError}
   */
  async getQuestion(attemptId: string, questionIndex: number): Promise<AttemptQuestionView> {
    const attempt = await this.loadWithLazyTimeout(attemptId);
    this.assertOwner(attempt);
    if (attempt.status !== 'InProgress') {
      throw new AttemptNotInProgressError();
    }
    const question = await this.repository.findQuestionByIndex(attemptId, questionIndex);
    if (!question) throw new AttemptQuestionNotFoundError();
    const images = await this.imagesForQuestion(question.sourceGeneratedQuestionId);
    return toQuestionView(question, images);
  }

  /**
   * FR-TAKE-5: "a selection can be changed while the attempt is in progress... not permitted once the
   * attempt is no longer in progress." Submitting an answer for a question outside this attempt is the
   * same 404 as {@link getQuestion} ("preventing cross-attempt tampering").
   * @throws {AttemptNotFoundError} @throws {NotAttemptOwnerError} @throws {AttemptNotInProgressError}
   * @throws {AttemptQuestionNotFoundError}
   */
  async answer(attemptId: string, questionIndex: number, selectedOption: string): Promise<AnswerResult> {
    const attempt = await this.loadWithLazyTimeout(attemptId);
    this.assertOwner(attempt);
    if (attempt.status !== 'InProgress') {
      throw new AttemptNotInProgressError();
    }

    const question = await this.repository.findQuestionByIndex(attemptId, questionIndex);
    if (!question) throw new AttemptQuestionNotFoundError();

    question.selectedOption = selectedOption;
    question.answeredAt = new Date();
    await this.repository.saveAnswer(question);

    return { questionIndex, selectedOption };
  }

  /**
   * FR-TAKE-6/FR-TAKE-7. If {@link loadWithLazyTimeout} already closed this attempt as `TimedOut` (its
   * deadline had passed by the time this very request arrived), that is a valid, spec-correct outcome
   * — the caller falls straight into `AttemptNotInProgressError` below, exactly matching "submitting an
   * attempt that is not currently in progress... is rejected" (FR-TAKE-7).
   * @throws {AttemptNotFoundError} @throws {NotAttemptOwnerError} @throws {AttemptNotInProgressError}
   */
  async submit(attemptId: string): Promise<SubmitResult> {
    const attempt = await this.loadWithLazyTimeout(attemptId);
    this.assertOwner(attempt);
    if (attempt.status !== 'InProgress') {
      throw new AttemptNotInProgressError();
    }

    const outcome = await this.repository.closeAndScore(attemptId, 'Submitted');
    if (!outcome) {
      // Raced with another request that closed it between the check above and this call (e.g. a
      // concurrent duplicate submit) — same client-facing outcome as the direct check.
      throw new AttemptNotInProgressError();
    }

    return {
      attemptId,
      status: outcome.status,
      answeredCount: outcome.answeredCount,
      correctCount: outcome.correctCount,
      wrongCount: outcome.wrongCount,
      totalQuestions: attempt.totalQuestions,
      scorePercent: outcome.scorePercent,
    };
  }

  /**
   * FR-TAKE-8: "review either the wrong-only subset or the full question set... ordering is always by
   * the question's original position in the attempt, regardless of filter." Permitted for any attempt
   * state (including still-`InProgress`, showing whatever has been answered so far) — no dedicated
   * error code exists in the catalog for "review not yet available," so inventing one here would be
   * scope creep.
   * @throws {AttemptNotFoundError} @throws {NotAttemptOwnerError}
   */
  async review(attemptId: string, filter: 'all' | 'wrong'): Promise<AttemptReview> {
    const attempt = await this.loadWithLazyTimeout(attemptId);
    await this.assertOwnerOrOversight(attempt);

    const questions = await this.repository.findQuestionsForAttempt(attemptId);
    const filtered = questions.filter((q) => filter === 'all' || q.isCorrect === false);
    // One batched image lookup for the whole filtered set, never one per question — same "never one
    // round trip per row" convention `QuestionReviewService.listForSession` follows.
    const sourceIds = [...new Set(filtered.map((q) => q.sourceGeneratedQuestionId).filter((id): id is string => id !== null))];
    const imagesByQuestion = await this.imageAssociation.listImagesForQuestions(sourceIds);
    const items: AttemptReviewItem[] = filtered.map((q) => ({
      questionIndex: q.questionIndex,
      questionText: q.questionText,
      options: q.optionsJson,
      correctAnswer: q.correctAnswer,
      selectedOption: q.selectedOption,
      isCorrect: q.isCorrect,
      explanation: q.explanation,
      images: toImageViews(q.sourceGeneratedQuestionId ? imagesByQuestion.get(q.sourceGeneratedQuestionId) : undefined),
    }));

    return {
      attemptId,
      status: attempt.status === 'InProgress' ? 'Submitted' : attempt.status,
      filter,
      items,
    };
  }

  /** FR-TAKE-9: "A Member can list all of their own past attempts, optionally filtered to one Exam
   * Type." */
  async listOwnHistory(examTypeId?: string): Promise<AttemptHistoryItem[]> {
    const userId = requireUserId();
    const attempts = await this.repository.findHistory({ userId, examTypeId });
    return this.toHistoryItems(await this.applyLazyTimeoutBatch(attempts));
  }

  /** FR-TAKE-9: "A Tenant Admin can list all attempts across the tenant with the same level of
   * detail." Access to this method is gated at the Route Handler by `requirePermission('attempts.read_all')`
   * — no further ownership narrowing happens here, matching that route's tenant-wide contract. */
  async listAllHistory(filter: { examTypeId?: string; userId?: string }): Promise<AttemptHistoryItem[]> {
    const attempts = await this.repository.findHistory(filter);
    return this.toHistoryItems(await this.applyLazyTimeoutBatch(attempts));
  }

  // ── Internals ──────────────────────────────────────────────────────────────────────────────────

  /** Loads one attempt by id, applying the lazy-timeout path (see class doc comment).
   * @throws {AttemptNotFoundError} */
  private async loadWithLazyTimeout(attemptId: string): Promise<AttemptEntity> {
    const attempt = await this.repository.findAttemptById(attemptId);
    if (!attempt) throw new AttemptNotFoundError();
    return this.applyLazyTimeout(attempt);
  }

  /**
   * HLD §10.4's lazy path itself: if `attempt` is `InProgress` and its `deadline_at` has passed, scores
   * and closes it (`TimedOut`) **before** returning — every caller in this service uses the returned,
   * possibly-refreshed entity for the rest of its logic, never the pre-check copy, which is what
   * guarantees "the very next read or write observes the final state" rather than a stale `InProgress`
   * snapshot taken a moment before the close.
   */
  private async applyLazyTimeout(attempt: AttemptEntity): Promise<AttemptEntity> {
    if (attempt.status !== 'InProgress' || Date.now() <= attempt.deadlineAt.getTime()) {
      return attempt;
    }
    await this.repository.closeAndScore(attempt.id, 'TimedOut');
    const refreshed = await this.repository.findAttemptById(attempt.id);
    // Unreachable defensively (the row cannot vanish between the two reads above), but never silently
    // swallowed.
    if (!refreshed) throw new AttemptNotFoundError();
    return refreshed;
  }

  private async applyLazyTimeoutBatch(attempts: AttemptEntity[]): Promise<AttemptEntity[]> {
    const result: AttemptEntity[] = [];
    for (const attempt of attempts) {
      result.push(await this.applyLazyTimeout(attempt));
    }
    return result;
  }

  private async toHistoryItems(attempts: AttemptEntity[]): Promise<AttemptHistoryItem[]> {
    const examTypeNames = new Map<string, string>();
    for (const examTypeId of new Set(attempts.map((a) => a.examTypeId))) {
      const examType = await this.repository.findExamTypeById(examTypeId);
      if (examType) examTypeNames.set(examTypeId, examType.name);
    }

    return attempts.map((attempt) => ({
      attemptId: attempt.id,
      userId: attempt.userId,
      examTypeId: attempt.examTypeId,
      examTypeName: examTypeNames.get(attempt.examTypeId) ?? '',
      status: attempt.status,
      totalQuestions: attempt.totalQuestions,
      answeredCount: attempt.answeredCount,
      correctCount: attempt.correctCount,
      wrongCount: attempt.wrongCount,
      scorePercent: attempt.scorePercent === null ? null : Number(attempt.scorePercent),
      startTime: attempt.startTime,
      endTime: attempt.endTime,
    }));
  }

  /** Resolves one question's images given its (possibly-`null`) `sourceGeneratedQuestionId` — `null`
   * (no known source generated question) always resolves to "no images," never an error, matching
   * that column's own doc comment. */
  private async imagesForQuestion(sourceGeneratedQuestionId: string | null): Promise<AttemptQuestionImage[]> {
    if (!sourceGeneratedQuestionId) return [];
    const byQuestion = await this.imageAssociation.listImagesForQuestions([sourceGeneratedQuestionId]);
    return toImageViews(byQuestion.get(sourceGeneratedQuestionId));
  }

  /** @throws {NotAttemptOwnerError} */
  private assertOwner(attempt: AttemptEntity): void {
    if (attempt.userId !== requireUserId()) {
      throw new NotAttemptOwnerError();
    }
  }

  /** @throws {NotAttemptOwnerError} */
  private async assertOwnerOrOversight(attempt: AttemptEntity): Promise<void> {
    const userId = requireUserId();
    if (attempt.userId === userId) return;
    if (await this.permissions.hasPermission(userId, OVERSIGHT_PERMISSION)) return;
    throw new NotAttemptOwnerError();
  }
}

/** Builds one snapshot `AttemptQuestionEntity` from its `exam_type_question` source at
 * attempt-generation time (see that entity's own doc comment for why this is a copy, not a live
 * join). */
function buildAttemptQuestion(attemptId: string, questionIndex: number, source: ExamTypeQuestionEntity): AttemptQuestionEntity {
  return {
    id: randomUUID(),
    attemptId,
    questionIndex,
    subjectName: null,
    questionKey: source.questionKey,
    questionText: source.questionText,
    optionsJson: source.optionsJson,
    correctAnswer: source.correctAnswer,
    selectedOption: null,
    isCorrect: null,
    explanation: source.explanation,
    answeredAt: null,
    // Copied in once at generation time, exactly like every other snapshotted field on this table —
    // see `AttemptQuestionEntity.sourceGeneratedQuestionId`'s own doc comment for why this is never
    // live-joined afterward.
    sourceGeneratedQuestionId: source.sourceGeneratedQuestionId,
  } as AttemptQuestionEntity;
}

function toQuestionView(question: AttemptQuestionEntity, images: AttemptQuestionImage[] = []): AttemptQuestionView {
  return {
    questionIndex: question.questionIndex,
    questionText: question.questionText,
    options: question.optionsJson,
    selectedOption: question.selectedOption,
    images,
  };
}

/** Maps `ImageAssociationService.QuestionImageView`s (the cross-module read shape) to this module's
 * own wire type — kept as a distinct, explicit mapping (not a re-export) so `server/attempts`' public
 * contract stays independent of `server/media`'s internal shape, the same "one chokepoint, mapped
 * explicitly at the module boundary" convention this codebase already applies elsewhere (e.g.
 * `QuestionReviewService`'s own `toSummary`). An absent (`undefined`) lookup result maps to an empty
 * array, never `undefined` on the wire. */
function toImageViews(images: QuestionImageView[] | undefined): AttemptQuestionImage[] {
  if (!images) return [];
  return images.map((img) => ({
    id: img.id,
    storageKey: img.storageKey,
    altText: img.altText,
    caption: img.caption,
    position: img.position,
    optionKey: img.optionKey,
    width: img.width,
    height: img.height,
  }));
}

/** Programmer-error guard, matching every other application service's identical convention (see
 * `ExamAuthoringService.requireTenantId`/`CurriculaService.requireUserId`). */
function requireUserId(): string {
  const userId = getRequestContext()?.userId;
  if (!userId) {
    throw new InternalDomainError(new Error('AttemptsService called outside any authenticated request.'));
  }
  return userId;
}
