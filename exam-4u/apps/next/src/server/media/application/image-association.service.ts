import { createHash, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import type { StoragePort } from '@/server/common/ports/storage.port';
import { QuestionImageEntity, StoredImageEntity } from '@/server/infrastructure/database';
import { logger } from '@/server/logging';
import { StoredImageRepository } from '../infrastructure/stored-image.repository';
import { QuestionImageRepository } from '../infrastructure/question-image.repository';
import type { AssociateImageInput, QuestionImageView, RemoveAssociationResult, StoreImageInput } from '../domain/media.types';

/**
 * FR-PDF-11/FR-FILE-3's storage-dedup + reference-counted-association logic (migration plan Phase 6,
 * sub-slice "6b") — ported logic from
 * `legacy/api/src/modules/files/application/image-association.service.ts`. The one chokepoint through
 * which every image gets stored, associated with a question, or dropped — kept as its own application
 * service (rather than folded into `ImageExtractionService`, which owns *finding* images in a PDF, not
 * the storage/reference-counting policy around them) so a future manual add/remove endpoint can reuse
 * the exact same logic the pipeline uses rather than a second implementation drifting from it.
 *
 * **Content-hash dedup (FR-PDF-11)**: {@link storeOrReuseImage} hashes the raw image bytes (SHA-256,
 * matching `PdfProcessingService`'s identical whole-document hashing approach — same algorithm, same
 * "hash first, only touch storage on a genuine miss" ordering) and looks up `stored_image.file_hash`
 * (DB-unique, `uq_image_hash`) *before* ever calling `StoragePort.put`. A hit reuses the existing row
 * verbatim — no second storage write, no second row.
 *
 * **Usage-count reference counting (FR-FILE-3)**: `stored_image.usage_count` is incremented exactly
 * once per successful {@link associateWithQuestion} and decremented exactly once per
 * {@link removeAssociation} — both via `StoredImageRepository`'s atomic `usage_count ± 1` expressions,
 * never a read-modify-write in this class. A `stored_image` row is deleted only when
 * {@link removeAssociation} observes the count reach zero *after* its own decrement, so a
 * two-question-shared image survives the first removal and is only actually deleted on the second.
 *
 * Takes the tenant `DataSource` directly (rather than a `TenantContextService`-equivalent, which this
 * app doesn't have) purely to open the two multi-table transactions below — the same explicit-
 * `DataSource` composition convention every repository in this app already uses.
 */
export class ImageAssociationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: StoragePort,
    private readonly storedImages: StoredImageRepository,
    private readonly questionImages: QuestionImageRepository,
  ) {}

  /**
   * Stores `input` under `storageKeyPrefix` if (and only if) no `stored_image` row already carries its
   * content hash — otherwise returns the pre-existing row untouched. Never mutates `usage_count`
   * itself (that only happens once an actual association is created, via
   * {@link associateWithQuestion}) — a merely-*stored* image with zero associations is a normal,
   * harmless intermediate state (e.g. a Reference-branch document with no `generated_question` rows to
   * associate against at all).
   *
   * `storageKeyPrefix` is always built by the caller from already-trusted, server-derived values
   * (`tenants/{tenantId}/pdf/{sessionId}/images/`), and the file name is the content hash plus a
   * regex-constrained extension — no caller-supplied path segment ever reaches the storage key, so
   * path traversal is structurally impossible here.
   */
  async storeOrReuseImage(storageKeyPrefix: string, input: StoreImageInput): Promise<StoredImageEntity> {
    const fileHash = createHash('sha256').update(input.data).digest('hex');

    const existing = await this.storedImages.findByHash(fileHash);
    if (existing) return existing;

    const fileName = `${fileHash}.${sanitizeExtension(input.extension)}`;
    const storageKey = `${storageKeyPrefix}${fileName}`;
    await this.storage.put(storageKey, input.data, input.contentType);

    const entity = new StoredImageEntity();
    entity.id = randomUUID();
    entity.fileName = fileName;
    entity.originalFileName = input.originalFileName;
    entity.contentType = input.contentType;
    entity.fileSize = input.data.length;
    entity.fileHash = fileHash;
    entity.storageKey = storageKey;
    entity.sourcePageNumber = input.sourcePageNumber;
    entity.sourceDocumentId = input.sourceDocumentId;
    entity.generatedAltText = null;
    entity.width = input.width;
    entity.height = input.height;
    entity.usageCount = 0;

    try {
      return await this.storedImages.insert(entity);
    } catch (err) {
      // A concurrent extraction pass for the exact same image content (two sessions uploading the same
      // source PDF at nearly the same moment) can lose the `findByHash` race and hit `uq_image_hash`
      // here — the DB-enforced half of this method's own dedup guarantee. Re-reading by hash recovers
      // the winner's row rather than failing this call.
      const winner = await this.storedImages.findByHash(fileHash);
      if (winner) return winner;
      throw err;
    }
  }

  /**
   * Creates one `question_image` association and increments the image's `usage_count` — both inside
   * one transaction, so a crash between the two steps can never leave the count out of sync with the
   * real association rows. A duplicate call for the exact same (question, image, position, option)
   * tuple is a no-op returning the pre-existing association (idempotent, backed by `uq_qi`) rather
   * than incrementing the count a second time for the same logical association.
   */
  async associateWithQuestion(input: AssociateImageInput): Promise<QuestionImageEntity> {
    return this.dataSource.transaction(async (manager) => {
      const existing = await this.questionImages.findExisting(
        input.generatedQuestionId,
        input.imageId,
        input.position,
        input.optionKey,
        manager,
      );
      if (existing) return existing;

      const entity = new QuestionImageEntity();
      entity.id = randomUUID();
      entity.generatedQuestionId = input.generatedQuestionId;
      entity.imageId = input.imageId;
      entity.sequenceOrder = input.sequenceOrder;
      entity.caption = input.caption;
      entity.altText = input.altText;
      entity.position = input.position;
      entity.optionKey = input.optionKey;
      entity.width = input.width;
      entity.height = input.height;

      const inserted = await this.questionImages.insert(entity, manager);
      await this.storedImages.incrementUsageCount(input.imageId, manager);
      return inserted;
    });
  }

  /**
   * FR-FILE-3's reference-counted removal: deletes the `question_image` row, decrements the associated
   * image's `usage_count`, and — only if that decrement reaches zero — deletes the `stored_image` row
   * too, all inside one transaction (the `ON DELETE RESTRICT` FK from `question_image.image_id` is what
   * makes the ordering here safe: the association row is always gone before the image row is even
   * attempted).
   *
   * **Storage-file deletion deliberately happens after this method returns, not inside the
   * transaction** — `StoragePort.delete` is not itself transactional/rollback-aware, so deleting the
   * blob *inside* a DB transaction that later rolls back would orphan-delete a file a still-committed
   * row continues to reference. Callers that don't want to handle that themselves should use
   * {@link removeAssociationAndCleanupStorage}.
   */
  async removeAssociation(questionImageId: string): Promise<RemoveAssociationResult> {
    return this.dataSource.transaction(async (manager) => {
      const removed = await this.questionImages.deleteAndReturn(questionImageId, manager);
      if (!removed) return { removed: false, imageDeleted: false, storageKeyToDelete: null };

      const remainingUsageCount = await this.storedImages.decrementUsageCount(removed.imageId, manager);
      if (remainingUsageCount > 0) {
        return { removed: true, imageDeleted: false, storageKeyToDelete: null };
      }

      // Last reference just went away — the image row (and, once this transaction commits, its backing
      // storage object) is now genuinely orphaned.
      const image = await this.storedImages.findById(removed.imageId, manager);
      await this.storedImages.delete(removed.imageId, manager);
      return { removed: true, imageDeleted: true, storageKeyToDelete: image?.storageKey ?? null };
    });
  }

  /** {@link removeAssociation} plus the post-commit storage cleanup — logs and swallows a
   * storage-delete failure rather than propagating it, matching this codebase's established
   * "a best-effort cleanup side effect never turns an already-successful DB change into a
   * caller-visible error" convention. */
  async removeAssociationAndCleanupStorage(questionImageId: string): Promise<RemoveAssociationResult> {
    const result = await this.removeAssociation(questionImageId);
    if (result.imageDeleted && result.storageKeyToDelete) {
      try {
        await this.storage.delete(result.storageKeyToDelete);
      } catch (err) {
        logger.error({ err, storageKey: result.storageKeyToDelete }, 'media_orphan_image_storage_delete_failed');
      }
    }
    return result;
  }

  /**
   * Every `question_image` association for each id in `generatedQuestionIds`, resolved against its
   * owning `stored_image` row for the `storageKey` a UI needs to request a signed URL, grouped by
   * `generatedQuestionId` and returned in the extraction pipeline's own `sequence_order`. Batches the
   * `stored_image` lookup (one query for every distinct `imageId` across all questions, not one
   * per-association round trip).
   *
   * **The read path exists but is not yet consumed by any Route Handler this sub-slice** — image
   * rendering on the review screen is deliberately deferred to sub-slice "6c" alongside the rest of the
   * review UI (see `docs/plans/nextjs-rewrite-phase6-plan.md`'s "Decisions made" for the write-up).
   * An id with no associations is simply absent from the returned `Map` (never an empty-array entry).
   */
  async listImagesForQuestions(generatedQuestionIds: string[]): Promise<Map<string, QuestionImageView[]>> {
    const result = new Map<string, QuestionImageView[]>();
    if (generatedQuestionIds.length === 0) return result;

    const associations = await this.questionImages.findForQuestions(generatedQuestionIds);
    if (associations.length === 0) return result;

    const imageIds = [...new Set(associations.map((a) => a.imageId))];
    const images = await this.storedImages.findByIds(imageIds);
    const storageKeyById = new Map(images.map((img) => [img.id, img.storageKey]));

    for (const association of associations) {
      const storageKey = storageKeyById.get(association.imageId);
      if (!storageKey) continue; // Defensive only — `fk_qi_img` guarantees the row still exists.
      const view: QuestionImageView = {
        id: association.id,
        storageKey,
        altText: association.altText,
        caption: association.caption,
        position: association.position,
        optionKey: association.optionKey,
        width: association.width,
        height: association.height,
      };
      const existing = result.get(association.generatedQuestionId);
      if (existing) existing.push(view);
      else result.set(association.generatedQuestionId, [view]);
    }
    return result;
  }
}

/** Defense in depth on the one storage-key segment that isn't a server-derived constant or a hex
 * hash: `ExtractedImage.extension` comes from a regex-captured `\w+` sub-type today, so this can never
 * actually fire — it exists so a future producer of `StoreImageInput` cannot introduce a traversal
 * (`../`) or separator into a storage key by supplying a hostile extension. */
function sanitizeExtension(extension: string): string {
  const cleaned = extension.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return cleaned.length > 0 ? cleaned.slice(0, 10) : 'png';
}
