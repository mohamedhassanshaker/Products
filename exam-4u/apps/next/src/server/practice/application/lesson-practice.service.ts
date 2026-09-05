import { randomUUID } from 'node:crypto';
import type { GeneratedQuestionDraft, PromptPracticeIn } from '@examland/contracts';
import type { AiInvocationContext, AiServicePort, RetrievalService, RetrievalScope } from '@/server/ai';
import { getEnv } from '@/server/config';
import { getRequestContext } from '@/server/context';
import { InternalDomainError } from '@/server/common/errors/domain-error';
import type { GeneratedQuestionEntity } from '@/server/infrastructure/database';
import {
  CurriculumNotFoundError,
  DocumentNotFoundError,
  NotCurriculumOwnerError,
  SubjectNotFoundError,
  type CurriculaRepository,
} from '@/server/curricula';
import type { SubjectRepository } from '@/server/taxonomy';
import type { PermissionResolutionService } from '@/server/rbac';
import type { EmbeddingsPort } from '@/server/vector';
import { calibrateConfidence, type GeneratedQuestionRepository } from '@/server/pdf-processing';
import { PracticeSessionRepository, type PracticeQuestionToPersist } from '../infrastructure/practice-session.repository';
import { selectDiverse } from '../domain/diversity-selection';
import {
  InvalidQuestionCountError,
  EmptyQuestionBankError,
  PracticeSessionNotFoundError,
  NotPracticeSessionOwnerError,
  PracticeQuestionNotFoundError,
} from '../domain/errors';
import type { LessonPracticeInput, LessonPracticeQuestion, LessonPracticeResult } from '../domain/practice.types';
import { MIN_QUESTION_COUNT, MAX_QUESTION_COUNT } from './prompt-practice.service';

/** The same "Tenant Admin acting in an oversight capacity" bypass permission `CurriculaService` gates
 * GET/PATCH/DELETE `/api/curricula/:id` behind — reused verbatim here so Lesson Practice's
 * document-scoped and curriculum-scoped branches enforce the identical per-user ownership rule as the
 * Curriculum CRUD surface itself. */
const OVERSIGHT_PERMISSION = 'curricula.read_all';

/**
 * FR-CUR-6's Adaptive Lesson Practice (migration plan Phase 8) — bank-first selection before any new
 * generation, exactly the spec's own framing: "the platform first draws from the existing packaged
 * question bank for that scope... before generating any new questions to fill a shortfall —
 * minimizing redundant AI calls." Ported logic from
 * `legacy/api/src/modules/practice/application/lesson-practice.service.ts`.
 *
 * **Document-scoped selection ("ranked by relevance to the document")**: every candidate in
 * {@link GeneratedQuestionRepository.findPackagedForDocument}'s result set already originates from
 * this exact document, so there is no free-text query to embed/rank against — proxies "relevance" with
 * each question's own already-computed `confidence_score` (already the query's own `ORDER BY`),
 * simply truncated to `count`.
 *
 * **Subject-scoped selection ("selected for topical diversity")**: {@link selectDiverse}'s greedy
 * farthest-point algorithm over the whole subject's packaged bank, embedding every candidate's
 * `questionText` in one batched {@link EmbeddingsPort.embed} call.
 *
 * **Curriculum-scoped selection ("Multi-document synthesis for Lesson Practice")**: when the request
 * names a `curriculumId` (and no `documentId` — see the precedence rule below), the candidate pool is
 * {@link GeneratedQuestionRepository.findPackagedForCurriculum}'s result — every already-finalized
 * question from ANY document under that Curriculum — and selection reuses the identical
 * {@link selectDiverse} farthest-point algorithm subject-scope already uses.
 *
 * **Scope precedence**: `documentId` (narrowest) wins if present, regardless of whether `curriculumId`
 * is also sent; else `curriculumId` if present; else subject-wide.
 *
 * **EMPTY_QUESTION_BANK ordering (this phase's own named exit gate)**: the bank-empty check runs
 * BEFORE any embedding or AI call — a document merely existing in a Curriculum with zero packaged
 * questions behind it is rejected outright, never silently "topped up" entirely by fresh generation.
 *
 * **Shortfall-fill generation reuses `AiServicePort.promptPractice`** (this app's `AiServicePort` has
 * no separate "lesson practice" AI operation) with a synthesized, non-empty prompt describing the
 * scope and grounding retrieved via {@link RetrievalService.retrieve} narrowed to the document when
 * document-scoped, narrowed to the curriculum when curriculum-scoped, or unscoped when subject-scoped.
 */
export class LessonPracticeService {
  constructor(
    private readonly aiService: AiServicePort,
    private readonly retrieval: RetrievalService,
    private readonly embeddings: EmbeddingsPort,
    private readonly generatedQuestions: GeneratedQuestionRepository,
    private readonly curricula: CurriculaRepository,
    private readonly subjects: SubjectRepository,
    private readonly practiceSessions: PracticeSessionRepository,
    private readonly permissions: PermissionResolutionService,
  ) {}

  /**
   * @throws {InvalidQuestionCountError} @throws {SubjectNotFoundError} @throws {DocumentNotFoundError}
   * @throws {CurriculumNotFoundError} @throws {NotCurriculumOwnerError} @throws {EmptyQuestionBankError}
   */
  async generate(input: LessonPracticeInput): Promise<LessonPracticeResult> {
    if (!Number.isInteger(input.count) || input.count < MIN_QUESTION_COUNT || input.count > MAX_QUESTION_COUNT) {
      throw new InvalidQuestionCountError();
    }

    const subject = await this.subjects.findById(input.subjectId);
    // A subject that exists but belongs to a different stage than the one named in the request is
    // collapsed into the same `SUBJECT_NOT_FOUND` outcome — mirrors `CurriculaService`'s own
    // precedent of not distinguishing every possible mismatch reason.
    if (!subject || subject.stageId !== input.stageId) {
      throw new SubjectNotFoundError();
    }

    let curriculumId: string | null = null;
    let curriculumDocumentId: string | null = null;
    let bank: GeneratedQuestionEntity[];
    let scope: RetrievalScope;
    let sessionKind: 'LessonDocument' | 'LessonSubject' | 'LessonCurriculum';

    if (input.documentId) {
      // Document-scope wins if present, even if `curriculumId` was also sent — see this class's own
      // doc comment's "Scope precedence" section.
      const document = await this.curricula.findDocumentById(input.documentId);
      if (!document) {
        throw new DocumentNotFoundError();
      }
      const curriculum = await this.curricula.findById(document.curriculumId);
      // A document whose owning Curriculum's subject does not match the request's own `subjectId` is
      // treated identically to a nonexistent document — there is no bank to draw from under the
      // wrong subject either way.
      if (!curriculum || curriculum.subjectId !== input.subjectId) {
        throw new DocumentNotFoundError();
      }
      await this.assertCurriculumOwnerOrOversight(curriculum);
      curriculumId = curriculum.id;
      curriculumDocumentId = document.id;
      // `findPackagedForDocument` joins through `pdf_processing_session.curriculum_document_id` —
      // see that method's own doc comment.
      bank = await this.generatedQuestions.findPackagedForDocument(document.id);
      scope = { documentId: document.id };
      sessionKind = 'LessonDocument';
    } else if (input.curriculumId) {
      const curriculum = await this.curricula.findById(input.curriculumId);
      if (!curriculum || curriculum.subjectId !== input.subjectId) {
        throw new CurriculumNotFoundError();
      }
      await this.assertCurriculumOwnerOrOversight(curriculum);
      curriculumId = curriculum.id;
      bank = await this.generatedQuestions.findPackagedForCurriculum(curriculum.id);
      scope = { curriculumId: curriculum.id };
      sessionKind = 'LessonCurriculum';
    } else {
      bank = await this.generatedQuestions.findPackagedForSubject(input.subjectId);
      scope = {};
      sessionKind = 'LessonSubject';
    }

    // FR-CUR-6's own named exit gate: a genuinely empty bank is rejected before any embedding/AI call
    // is ever made, never silently treated as "entirely generate fresh."
    if (bank.length === 0) {
      throw new EmptyQuestionBankError();
    }

    const selectedBank = sessionKind === 'LessonDocument' ? bank.slice(0, input.count) : selectDiverse(await this.embedCandidates(bank), input.count);

    const shortfall = input.count - selectedBank.length;
    let generatedCount = 0;
    let groundingChunksFound = 0;
    const bankQuestions: PracticeQuestionToPersist[] = selectedBank.map((q) => ({
      questionText: q.questionText,
      options: q.optionsJson,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      confidenceScore: Number(q.confidenceScore),
      source: 'Bank',
      sourceRef: q.id,
    }));
    const generatedQuestionsToPersist: PracticeQuestionToPersist[] = [];

    if (shortfall > 0 && this.aiService.available) {
      const tenantId = requireTenantId();
      const env = getEnv();
      const seedText =
        sessionKind === 'LessonDocument'
          ? `${subject.name} — document-scoped practice`
          : sessionKind === 'LessonCurriculum'
            ? `${subject.name} — curriculum-scoped practice`
            : subject.name;
      const grounding = await this.retrieval.retrieve({ tenantId }, scope, seedText, env.RETRIEVAL_TOPK_PROMPT);
      groundingChunksFound = grounding.length;

      const aiInput: PromptPracticeIn = {
        prompt: `Generate additional practice questions covering the key concepts of the subject "${subject.name}".`,
        count: shortfall,
        grounding,
      };
      const ctx: AiInvocationContext = {
        tenantId,
        userId: requireUserId(),
        correlationId: randomUUID(),
        budget: { tokensRemaining: env.PDF_MAX_TOKENS_PER_SESSION, costRemainingUsd: env.PDF_MAX_COST_PER_SESSION_USD },
      };
      const result = await this.aiService.promptPractice(aiInput, ctx);
      const reviewFlagThreshold = env.REVIEW_FLAG_CONFIDENCE_THRESHOLD;

      for (const draft of result.data as GeneratedQuestionDraft[]) {
        const { score } = calibrateConfidence(
          { kind: 'prompt_practice', chunkCount: grounding.length, topK: env.RETRIEVAL_TOPK_PROMPT, bestChunkScore: grounding[0]?.score },
          reviewFlagThreshold,
        );
        generatedQuestionsToPersist.push({
          questionText: draft.questionText,
          options: Object.fromEntries(draft.options.map((o) => [o.key, o.text])),
          correctAnswer: draft.correctAnswer,
          explanation: draft.explanation,
          confidenceScore: score,
          source: 'Generated',
          sourceRef: null,
        });
      }
      generatedCount = generatedQuestionsToPersist.length;
    }

    const saved = await this.practiceSessions.createSession(
      {
        userId: requireUserId(),
        kind: sessionKind,
        curriculumId,
        curriculumDocumentId,
        subjectId: input.subjectId,
        requestedCount: input.count,
        groundingChunksFound,
        reusedFromBank: bankQuestions.length,
        generatedNew: generatedCount,
      },
      [...bankQuestions, ...generatedQuestionsToPersist],
    );

    const persisted = await this.practiceSessions.findQuestionsForSession(saved.id);
    return { sessionId: saved.id, status: 'completed', questions: persisted.map(toWireQuestion) };
  }

  /** `GET /api/practice/sessions/:id` — owner-only, matching `AttemptsService`'s identical
   * per-resource ownership shape.
   * @throws {PracticeSessionNotFoundError} @throws {NotPracticeSessionOwnerError} */
  async getSession(sessionId: string): Promise<LessonPracticeResult> {
    const session = await this.requireOwnedSession(sessionId);
    const questions = await this.practiceSessions.findQuestionsForSession(session.id);
    return { sessionId: session.id, status: 'completed', questions: questions.map(toWireQuestion) };
  }

  /** `POST /api/practice/sessions/:id/answer` — owner-only; records the answer exactly once (no
   * "already answered" special case — a second call for the same question simply overwrites, since
   * this endpoint has no timer/submit-gated lifecycle, unlike the `Attempt` flow).
   * @throws {PracticeSessionNotFoundError} @throws {NotPracticeSessionOwnerError}
   * @throws {PracticeQuestionNotFoundError} */
  async answer(sessionId: string, position: number, selectedOption: string): Promise<LessonPracticeQuestion> {
    const session = await this.requireOwnedSession(sessionId);
    const question = await this.practiceSessions.findQuestionByPosition(session.id, position);
    if (!question) {
      throw new PracticeQuestionNotFoundError();
    }
    const isCorrect = question.correctAnswer === selectedOption;
    await this.practiceSessions.recordAnswer(question.id, selectedOption, isCorrect);
    return toWireQuestion({ ...question, selectedOption, isCorrect });
  }

  /** FR-CUR-1a's ownership rule, applied verbatim to Lesson Practice's document-scoped and
   * curriculum-scoped branches: the caller must own the Curriculum being practiced against, or hold
   * the tenant-wide `curricula.read_all` oversight permission — the exact same check
   * `CurriculaService.assertOwnerOrOversight` applies to GET/PATCH/DELETE `/api/curricula/:id`.
   * @throws {NotCurriculumOwnerError} */
  private async assertCurriculumOwnerOrOversight(curriculum: { ownerUserId: string }): Promise<void> {
    const userId = requireUserId();
    if (curriculum.ownerUserId === userId) return;
    if (await this.permissions.hasPermission(userId, OVERSIGHT_PERMISSION)) return;
    throw new NotCurriculumOwnerError();
  }

  private async requireOwnedSession(sessionId: string) {
    const session = await this.practiceSessions.findById(sessionId);
    if (!session) {
      throw new PracticeSessionNotFoundError();
    }
    if (session.userId !== requireUserId()) {
      throw new NotPracticeSessionOwnerError();
    }
    return session;
  }

  /** Batches one {@link EmbeddingsPort.embed} call across the whole bank being diversity-selected —
   * `selectDiverse` itself never touches the embeddings port (kept pure/I/O-free), so this is the one
   * call site that bridges the two. */
  private async embedCandidates<T extends { questionText: string }>(items: T[]) {
    const vectors = await this.embeddings.embed(items.map((q) => q.questionText));
    return items.map((item, i) => ({ item, embedding: vectors[i] }));
  }
}

/** Maps one persisted `practice_question` row to the wire shape. `isCorrect` is coerced with
 * `Boolean()` rather than passed through raw — MySQL's `tinyint(1)` can surface as a numeric `0`/`1`
 * depending on the read path — while a still-`null` (never-answered) value must stay `null`, not
 * become `false`. */
function toWireQuestion(q: {
  position: number;
  questionText: string;
  optionsJson: Record<string, string>;
  correctAnswer: string;
  explanation: string | null;
  selectedOption: string | null;
  isCorrect: boolean | null;
}): LessonPracticeQuestion {
  return {
    position: q.position,
    questionText: q.questionText,
    options: Object.entries(q.optionsJson).map(([key, text]) => ({ key, text })),
    correctAnswer: q.correctAnswer,
    explanation: q.explanation,
    selectedOption: q.selectedOption,
    isCorrect: q.isCorrect === null ? null : Boolean(q.isCorrect),
  };
}

/** Programmer-error guard, matching every other tenant-scoped service's identical shape. */
function requireTenantId(): string {
  const tenantId = getRequestContext()?.tenantId;
  if (!tenantId) {
    throw new InternalDomainError(new Error('LessonPracticeService called outside any resolved tenant scope.'));
  }
  return tenantId;
}

/** Programmer-error guard: every route this service backs sits behind `requireTenantUser`. */
function requireUserId(): string {
  const userId = getRequestContext()?.userId;
  if (!userId) {
    throw new InternalDomainError(new Error('LessonPracticeService called outside any authenticated request.'));
  }
  return userId;
}
