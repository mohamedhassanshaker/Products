import { extractPdfImages } from '@/server/infrastructure/text-extraction';
import type { ImageAssociationService, ImageCaptioningService } from '@/server/media';
import { logger } from '@/server/logging';
import type { PdfProcessingSessionEntity } from '@/server/infrastructure/database';
import { GeneratedQuestionRepository } from '../infrastructure/generated-question.repository';
import { pageOverlapsRange, parseSourcePageRange } from '../domain/page-overlap.util';

/** FR-FILE-3's default association position for every image the pipeline extracts automatically — a
 * manual add/remove flow (the only way to attach an image to an `'option'`/`'explanation'` position,
 * or to override this placeholder alt text) is not exposed by any route yet. */
const DEFAULT_POSITION = 'question_text';

/**
 * FR-PDF-11's automatic image-extraction/dedup/association pass (migration plan Phase 6, sub-slice
 * "6b") — ported logic from
 * `legacy/api/src/modules/pdf-processing/application/image-extraction.service.ts`. Invoked once per
 * PDF processing session, *after* `PdfGenerationOrchestrator.process` has finished writing every
 * `generated_question` row that document will ever produce — that ordering is what lets the
 * page-overlap association below see the complete set of a session's questions in one pass, rather
 * than racing partially-written rows from an in-flight generation loop.
 *
 * **Page-overlap association, not exact-page match**: an extracted image's own source page is compared
 * against each question's `source_page_range` (parsed by `parseSourcePageRange` into a `{start, end}`
 * pair) using `pageOverlapsRange` — a question spanning pages 3-5 picks up an image found on page 4
 * even though "4" never appears verbatim. A deliberately cheap heuristic (not layout-aware — it knows
 * only which page pdf.js reported the image on), matching FR-PDF-11's own wording.
 *
 * **Never fails the session**: a corrupt-for-images PDF (rare — the same buffer already parsed
 * successfully for text), a storage-write failure, or an AI/vector outage during captioning are all
 * caught and logged here, never propagated into `PdfProcessingService.processSession`'s outer catch. A
 * session whose question generation succeeded must never be retroactively marked `Failed` because an
 * optional, additive image pass degraded.
 *
 * **Observable ordering caveat (documented, matching the fingerprint-upsert precedent)**: a session
 * reaches `Completed` before this pass has necessarily finished — a client polling
 * `GET /api/pdf-processing/sessions/:id` can observe `Completed` while this method is still running. An
 * accepted trade-off, not a defect: image association is additive metadata on top of an
 * already-successful generation result. A test or caller that needs to observe the *image* side
 * effects must poll for those directly (`stored_image`/`question_image` row presence), not session
 * status.
 *
 * **Vision captioning**: a genuinely NEW image (`stored_image.generated_alt_text` still `null` — a
 * hash-dedup reuse of an already-captioned image is deliberately never re-captioned, avoiding duplicate
 * AI spend on identical bytes) is handed to `ImageCaptioningService` for captioning + retrieval
 * indexing. The returned alt text replaces this method's page-number placeholder for every association
 * created for that image; a failed/unavailable/never-attempted captioning pass falls back to the
 * placeholder, so this can never make an association's alt text empty or the pass as a whole throw.
 *
 * **Review-UI rendering is deliberately NOT part of this sub-slice** — this pass produces the durable
 * `stored_image`/`question_image` rows and `ImageAssociationService.listImagesForQuestions` exposes the
 * read shape a UI needs, but no Route Handler consumes it yet: the question-review screen those images
 * render *into* is sub-slice "6c"'s own scope, and building half a review screen now would be the same
 * dead-end anti-pattern earlier phases already rejected. See
 * `docs/plans/nextjs-rewrite-phase6-plan.md`'s "Decisions made" for the full write-up.
 */
export class ImageExtractionService {
  constructor(
    private readonly imageAssociation: ImageAssociationService,
    private readonly imageCaptioning: ImageCaptioningService,
    private readonly generatedQuestions: GeneratedQuestionRepository,
  ) {}

  /**
   * @param tenantId Passed explicitly by the caller (never re-derived from ambient context here),
   *   needed only to build the storage-key prefix (LLD §9.7:
   *   `tenants/{tenantId}/pdf/{sessionId}/images/{imageHash}.{ext}`) and the vector tenant scope.
   * @param buffer The same source PDF bytes the text-extraction pass already consumed.
   */
  async extractAndAssociate(session: PdfProcessingSessionEntity, tenantId: string, buffer: Buffer): Promise<void> {
    try {
      const images = await extractPdfImages(buffer);
      if (images.length === 0) return;

      const questions = await this.generatedQuestions.findAllForSession(session.id);
      const storageKeyPrefix = `tenants/${tenantId}/pdf/${session.id}/images/`;

      for (const image of images) {
        const stored = await this.imageAssociation.storeOrReuseImage(storageKeyPrefix, {
          data: image.data,
          contentType: image.contentType,
          extension: image.extension,
          width: image.width,
          height: image.height,
          sourcePageNumber: image.pageNumber,
          sourceDocumentId: session.curriculumDocumentId,
          originalFileName: null,
        });

        // Only ever attempted once per distinct image *content* — a hash-dedup reuse arrives here with
        // `generatedAltText` already populated from its first extraction and is left untouched.
        const captioned = stored.generatedAltText
          ? null
          : await this.imageCaptioning.captionAndIndex({
              tenantId,
              processingSessionId: session.id,
              storedImageId: stored.id,
              sourcePageNumber: stored.sourcePageNumber,
              imageBytes: image.data,
              mimeType: image.contentType,
              fileName: session.sourceFileName,
              curriculumId: session.curriculumId ?? undefined,
              documentId: session.curriculumDocumentId ?? session.id,
            });

        // `question_image.alt_text` is NOT NULL (FR-FILE-3's "required alt text"): the AI-generated
        // alt text when captioning succeeded, otherwise a page-number placeholder a reviewer can
        // override once a manual edit flow exists.
        const altText = captioned?.altText ?? `Image from page ${image.pageNumber} of the source document.`;
        const caption = captioned?.caption ?? null;

        const overlapping = questions.filter((question) => pageOverlapsRange(image.pageNumber, parseSourcePageRange(question.sourcePageRange)));

        for (const question of overlapping) {
          await this.imageAssociation.associateWithQuestion({
            generatedQuestionId: question.id,
            imageId: stored.id,
            position: DEFAULT_POSITION,
            optionKey: null,
            altText,
            caption,
            sequenceOrder: null,
            width: image.width,
            height: image.height,
          });
        }
      }
    } catch (err) {
      logger.error({ err, sessionId: session.id }, 'pdf_image_extraction_failed');
    }
  }
}
