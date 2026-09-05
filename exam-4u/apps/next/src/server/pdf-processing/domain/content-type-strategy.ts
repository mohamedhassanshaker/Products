import type { PageText } from '@/server/common/util/chunking.util';
import type { PdfProcessingSessionEntity } from '@/server/infrastructure/database';
import type { PdfContentType } from './pdf-processing.types';

/**
 * The multi-provider dispatch shape `PdfGenerationOrchestrator` looks up by `session.contentType`
 * (LLD §9.2's `ContentStrategy`, mirroring `legacy/api/src/modules/pdf-processing/domain/
 * content-type-strategy.ts`'s identical interface). This sub-slice ("6a") registers exactly ONE
 * strategy (`ExamExtractionService` wrapped as `contentType: 'Exam'`) — sub-slice 6b adds
 * `'Lesson'`/`'Reference'` strategies on top of this SAME generic skeleton, per this dispatch's own
 * scope instruction ("build the skeleton generically enough that 6b doesn't need to refactor it").
 * Legacy used a Nest DI multi-provider token (`CONTENT_TYPE_STRATEGIES`) for this array; this app has
 * no DI container, so the orchestrator's composition root (`server/pdf-processing/index.ts`) simply
 * passes a plain `PdfContentStrategy[]` literal into its constructor instead — same runtime shape,
 * no token needed.
 */
export interface PdfContentStrategy {
  readonly contentType: PdfContentType;
  run(session: PdfProcessingSessionEntity, pages: PageText[]): Promise<void>;
}
