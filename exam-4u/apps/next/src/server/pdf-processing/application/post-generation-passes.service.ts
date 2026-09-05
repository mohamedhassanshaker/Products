import type { PdfProcessingSessionEntity } from '@/server/infrastructure/database';
import { logger } from '@/server/logging';
import type { ImageExtractionService } from './image-extraction.service';
import type { SubjectClassificationService } from './subject-classification.service';

/**
 * The two optional, additive passes that run once a session's content-type generation branch has
 * finished writing every `generated_question` row it will ever write (migration plan Phase 6, sub-slice
 * "6b"): FR-PDF-7's subject classification and FR-PDF-11's image extraction/association.
 *
 * **Why this class exists at all** — a deliberate composition choice, not an extra layer for its own
 * sake. Legacy invoked subject classification from inside `PdfGenerationOrchestrator` and image
 * extraction from `PdfProcessingService`. This dispatch was explicitly instructed not to modify
 * `PdfGenerationOrchestrator`, so both passes have to hang off `PdfProcessingService` — which already
 * holds four collaborators and would reach six, past this project's own ~4-5 guideline. Grouping the
 * two genuinely-cohesive "after generation, best-effort, never fails the session" passes behind one
 * collaborator keeps `PdfProcessingService` at five and gives the shared "an additive pass never
 * degrades an already-successful session" rule exactly one place to live.
 *
 * **Neither pass can fail the session.** `SubjectClassificationService` already swallows AI outages
 * internally, and `ImageExtractionService` catches everything; {@link run} additionally wraps both so
 * an unexpected failure in one can never prevent the other from running, nor propagate to
 * `PdfProcessingService.processSession`'s outer catch (which would otherwise mark a fully-generated
 * session `Failed` for a purely additive reason).
 *
 * **Ordering: classification first, images second.** Classification only reads/writes
 * `generated_question.subject_id`; image association reads the same rows' `source_page_range`. Neither
 * depends on the other, so the order is arbitrary for correctness — classification runs first purely
 * because it is the cheaper, more commonly-observed pass.
 */
export class PdfPostGenerationPassesService {
  constructor(
    private readonly subjectClassification: SubjectClassificationService,
    private readonly imageExtraction: ImageExtractionService,
  ) {}

  /**
   * @param buffer the same source PDF bytes the text-extraction pass consumed — required by the image
   *   pass, which re-parses them for embedded images.
   */
  async run(session: PdfProcessingSessionEntity, tenantId: string, buffer: Buffer): Promise<void> {
    await this.subjectClassification
      .classifyUnmappedForSession(session.id, session.initiatedByUserId ?? undefined)
      .catch((err: unknown) => {
        logger.error({ err, sessionId: session.id }, 'pdf_subject_classification_pass_failed');
      });

    await this.imageExtraction.extractAndAssociate(session, tenantId, buffer).catch((err: unknown) => {
      logger.error({ err, sessionId: session.id }, 'pdf_image_extraction_pass_failed');
    });
  }
}
