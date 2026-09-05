/**
 * Framework-free types for the `server/media` module (migration plan Phase 6, sub-slice "6b") —
 * FR-PDF-11/FR-FILE-3's image storage/association vocabulary, ported from
 * `legacy/api/src/modules/files/application/{image-association,image-captioning}.service.ts`'s own
 * inline interfaces.
 */

/** One `question_image` row's `position` (an inline literal union here, mirroring
 * `QuestionImageEntity`'s own column declaration — the entity never imports this module's types). */
export type QuestionImagePosition = 'question_text' | 'option' | 'explanation';

/** A raw image ready to be deduplicated and stored — deliberately does NOT name
 * `ExtractedImage` (`server/infrastructure/text-extraction`'s shape, its only current producer), so
 * this module stays decoupled from any concrete extraction library, matching
 * `PdfProcessingService`'s own `UploadedFileLike` decoupling convention. */
export interface StoreImageInput {
  data: Buffer;
  contentType: string;
  extension: string;
  width: number | null;
  height: number | null;
  sourcePageNumber: number | null;
  sourceDocumentId: string | null;
  originalFileName: string | null;
}

/** One `question_image` association to create (FR-FILE-3's "specific position... optional caption and
 * required alt text" shape). */
export interface AssociateImageInput {
  generatedQuestionId: string;
  imageId: string;
  position: QuestionImagePosition;
  optionKey: string | null;
  altText: string;
  caption: string | null;
  sequenceOrder: number | null;
  width: number | null;
  height: number | null;
}

/**
 * The read-only shape a review/exam-taking UI needs to render one associated image inline — a
 * `question_image` row's own fields plus the owning `stored_image.storage_key` needed to request a
 * signed URL (`FileSigningService`, FR-FILE-1). Never exposes the raw `storageKey` for direct use as
 * an `<img src>` — the client must still exchange it for a signed URL, same as every other stored-file
 * surface in this app.
 */
export interface QuestionImageView {
  id: string;
  storageKey: string;
  altText: string;
  caption: string | null;
  position: QuestionImagePosition;
  optionKey: string | null;
  width: number | null;
  height: number | null;
}

/** Outcome of `ImageAssociationService.removeAssociation` — `imageDeleted` tells the caller whether
 * the last reference to the underlying `stored_image` row was just removed (and, if so, the
 * now-orphaned `storageKey` that should be deleted from blob storage *after* the DB transaction
 * commits — see that method's own doc comment for why storage deletion is deliberately kept outside
 * the transaction). */
export interface RemoveAssociationResult {
  removed: boolean;
  imageDeleted: boolean;
  storageKeyToDelete: string | null;
}

/** The caption text and the WCAG alt text produced for one image — kept independent of
 * `@examland/contracts`'s `ImageCaptionOut` the same way `RetrievalService`'s `RetrievedChunk` is kept
 * independent of `GroundingChunk`. */
export interface ImageCaptionResult {
  caption: string;
  altText: string;
}

/** Everything `ImageCaptioningService.captionAndIndex` needs about the image being captioned and the
 * pipeline context it was extracted from. */
export interface CaptionAndIndexInput {
  tenantId: string;
  processingSessionId: string;
  storedImageId: string;
  sourcePageNumber: number | null;
  imageBytes: Buffer;
  mimeType: string;
  /** The session's own `sourceFileName` — carried into the indexed chunk's `fileName` payload field so
   * a retrieval hit reads the same "which document" label a text chunk's hit would. */
  fileName: string;
  /** `session.curriculumId`, when the session is Reference-indexed or explicitly curriculum-linked.
   * `undefined` omits the field from the payload entirely (never writes a literal `null` into a
   * chunk's `curriculumId`, matching every other chunk writer's `curriculumId?: string` shape). */
  curriculumId?: string;
  /** `session.curriculumDocumentId ?? session.id` — every chunk point needs SOME `documentId` string
   * (it is how `deleteChunks`/`ChunkFilter` narrow a search); falling back to the session id keeps
   * this well-formed even for a Lesson/Exam session never indexed into a Curriculum document. */
  documentId: string;
}
