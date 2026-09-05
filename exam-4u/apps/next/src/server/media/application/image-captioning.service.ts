import { randomUUID } from 'node:crypto';
import type { AiServicePort } from '@/server/ai';
import type { EmbeddingsPort } from '@/server/vector';
import type { QdrantVectorStoreAdapter } from '@/server/infrastructure/vector';
import { logger } from '@/server/logging';
import { StoredImageRepository } from '../infrastructure/stored-image.repository';
import type { CaptionAndIndexInput, ImageCaptionResult } from '../domain/media.types';

/**
 * FR-PDF-11's vision-captioning half (migration plan Phase 6, sub-slice "6b") — ported logic from
 * `legacy/api/src/modules/files/application/image-captioning.service.ts`. Turns one freshly-extracted
 * image into (a) a persisted `stored_image.generated_alt_text` value and (b) one searchable chunk in
 * the tenant's `<prefix>_chunks` Qdrant collection, so the image's *content* — not just its adjacent
 * page text — becomes something `RetrievalService.retrieve` can surface.
 *
 * **Never fails the caller** (mirrors `ImageExtractionService`'s own "an optional, additive pass never
 * fails the session" convention): an AI outage/disabled engine, a contract violation, or a transient
 * embeddings/Qdrant failure all degrade to `null` — the caller falls back to its own placeholder alt
 * text and simply does not get this image's caption indexed this pass. Nothing here retries later; a
 * hash-dedup reuse of an *already*-captioned image is never re-attempted at all (see
 * `ImageExtractionService`'s own "already has `generatedAltText`" skip check), so a re-run costs
 * nothing for content that already succeeded.
 *
 * Takes the concrete `QdrantVectorStoreAdapter` (via `server/infrastructure/vector`'s barrel) rather
 * than a separate `VectorStorePort` + adapter pair, for the identical reason `SemanticDedupService`
 * already does: this app has no DI-token indirection between the port and its single implementation,
 * and `pointId()` is an adapter-only method that isn't part of the port at all.
 */
export class ImageCaptioningService {
  constructor(
    private readonly ai: AiServicePort,
    private readonly vectorAdapter: QdrantVectorStoreAdapter,
    private readonly embeddings: EmbeddingsPort,
    private readonly storedImages: StoredImageRepository,
  ) {}

  /**
   * Captions one image and indexes that caption for retrieval.
   *
   * @returns the caption/alt text on success, or `null` for every degraded outcome (AI disabled,
   *   engine unavailable, unusable model output, embeddings/Qdrant failure) — never throws.
   */
  async captionAndIndex(input: CaptionAndIndexInput): Promise<ImageCaptionResult | null> {
    if (!this.ai.available) return null;

    try {
      const result = await this.ai.captionImage(
        { imageBase64: input.imageBytes.toString('base64'), mimeType: input.mimeType },
        {
          tenantId: input.tenantId,
          correlationId: randomUUID(),
          processingSessionId: input.processingSessionId,
          // Captioning is a best-effort side pass, not part of the per-session generation budget
          // FR-PDF-12 enforces — mirrors `SubjectClassificationService`'s identical advisory-only
          // budget hint for the same reason (a small, unbudgeted classification-shaped call).
          budget: { tokensRemaining: Number.MAX_SAFE_INTEGER, costRemainingUsd: Number.MAX_SAFE_INTEGER },
        },
      );

      // `droppedItems > 0` is this port's "the engine produced nothing usable" signal — a normal,
      // handled outcome, not an exception (see `AiServicePort`'s own doc comment), so it degrades
      // exactly like an outright AI outage below.
      if (result.droppedItems > 0 || !result.data) return null;

      await this.storedImages.updateGeneratedAltText(input.storedImageId, result.data.altText);
      await this.indexCaptionChunk(input, result.data.caption);

      return { caption: result.data.caption, altText: result.data.altText };
    } catch (err) {
      logger.error({ err, storedImageId: input.storedImageId }, 'media_image_captioning_failed');
      return null;
    }
  }

  /**
   * Embeds `caption` and upserts exactly one point into the tenant's chunks collection, using the SAME
   * payload vocabulary `ReferenceIndexingService`/`CurriculaService.uploadDocument` already write
   * (`curriculumId`/`documentId`/`pageNumber`/`chunkIndex`/`fileName`/`text`/`embeddingModel`) — this
   * is what lets `RetrievalService.retrieve`'s existing `toRetrievedChunk` mapping pick this point up
   * with zero changes to that service. `isImageCaption`/`imageId` are additive payload fields no
   * existing reader inspects.
   */
  private async indexCaptionChunk(input: CaptionAndIndexInput, caption: string): Promise<void> {
    const [vector] = await this.embeddings.embed([caption]);
    await this.vectorAdapter.upsertChunks({ tenantId: input.tenantId }, [
      {
        id: this.vectorAdapter.pointId(input.tenantId, `image-caption:${input.storedImageId}`),
        vector,
        payload: {
          ...(input.curriculumId ? { curriculumId: input.curriculumId } : {}),
          documentId: input.documentId,
          pageNumber: input.sourcePageNumber ?? 0,
          // No chunk-index concept applies to an image caption — `-1` is a deliberately out-of-band
          // sentinel (real text chunks are always >= 0), never read by `RetrievalService`'s payload
          // mapping, kept only for payload-shape parity with the text-chunk writers.
          chunkIndex: -1,
          fileName: input.fileName,
          text: caption,
          embeddingModel: this.embeddings.model,
          isImageCaption: true,
          imageId: input.storedImageId,
        },
      },
    ]);
  }
}
