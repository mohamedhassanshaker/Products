import type { PageText } from '@/server/common/util/chunking.util';
import type { PdfContentStrategy } from '../domain/content-type-strategy';
import { GeneratedQuestionRepository } from '../infrastructure/generated-question.repository';
import { PdfProcessingSessionRepository } from '../infrastructure/pdf-processing-session.repository';
import { PdfProcessingSessionEntity } from '@/server/infrastructure/database';

/**
 * Dispatches a classified session to its content-type-specific branch (LLD §9.2's `ContentStrategy`
 * shape), then marks the session `Completed`. Ported logic from
 * `legacy/api/src/modules/pdf-processing/application/pdf-generation-orchestrator.service.ts`, trimmed
 * for this sub-slice's own scope:
 *
 * - **`strategies` is a plain constructor-injected array, not a Nest DI multi-provider token** — this
 *   app has no DI container, so the composition root (`server/pdf-processing/index.ts`'s
 *   `buildPdfProcessingService`) simply passes `[examExtractionStrategy]` today; sub-slice 6b appends
 *   `Lesson`/`Reference` strategies to that same literal array without touching this class at all —
 *   this is the generic skeleton the dispatch prompt asked for.
 * - **A session classified `Lesson`/`Reference` (no strategy registered for either yet) completes with
 *   zero generated questions this sub-slice** — deliberately NOT a programmer-error guard the way
 *   legacy's identical lookup treats a missing strategy (legacy could assume every recognized content
 *   type always has a registered branch by its own phase; this sub-slice cannot, since only `'Exam'` is
 *   wired). This is the honest, documented behavior for "the skeleton exists, only one branch is wired
 *   yet" — not a defect, and not silently invented lesson/reference generation.
 * - **FR-PDF-7 subject classification (legacy's `Lesson`-only post-strategy step) and the
 *   dedup-fingerprint upsert-on-completion (legacy's own optional `tenantId`/`fingerprintVector`
 *   params) are NOT part of this class** — `SubjectClassificationService` doesn't exist in `apps/next`
 *   yet (sub-slice 6b's own scope, alongside `fixSubjectMapping`'s deferred wiring), and the
 *   fingerprint-upsert-on-completion is instead a `PdfProcessingService`-level concern this sub-slice
 *   (see that class's own doc comment) — a deliberate, smaller re-split than legacy's, since this
 *   sub-slice's `PdfProcessingService` already holds `SemanticDedupService` as a direct collaborator for
 *   its own tier-2 lookup, so reusing it there for the write-back avoids threading the same collaborator
 *   through this class too.
 */
export class PdfGenerationOrchestrator {
  constructor(
    private readonly strategies: PdfContentStrategy[],
    private readonly generatedQuestions: GeneratedQuestionRepository,
    private readonly sessions: PdfProcessingSessionRepository,
  ) {}

  /** @param pages Full per-page extracted text (already produced by `PdfProcessingService.extract`). */
  async process(session: PdfProcessingSessionEntity, pages: PageText[]): Promise<void> {
    const strategy = this.strategies.find((candidate) => candidate.contentType === session.contentType);
    if (strategy) {
      // Any `AiDisabledError`/`AiServiceUnavailableError` thrown by a branch strategy propagates
      // through this method unchanged — `PdfProcessingService.processSession`'s existing outer catch
      // handles it identically to a classification-time outage (leaves `status` wherever it already
      // is, records `errorCode`/`errorMessage`, never `Failed`). This is what makes a mid-run engine
      // outage resumable via the watermark rather than terminal.
      await strategy.run(session, pages);
    }
    // else: no branch registered for this content type yet (Lesson/Reference, sub-slice 6b's own
    // scope) — the session still reaches Completed below with zero generated questions, a valid,
    // documented outcome for this sub-slice (see class doc comment).

    const successfulQuestions = await this.generatedQuestions.countForSession(session.id);
    session.totalQuestions = successfulQuestions;
    session.successfulQuestions = successfulQuestions;
    session.status = 'Completed';
    session.completedAt = new Date();
    await this.sessions.save(session);
  }
}
