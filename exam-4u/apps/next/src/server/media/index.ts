import type { DataSource } from 'typeorm';
import { getAiService } from '@/server/ai';
import { getEmbeddingsPort } from '@/server/infrastructure/embeddings';
import { getQdrantVectorStoreAdapter } from '@/server/infrastructure/vector';
import { getStoragePortSingleton } from '@/server/files';
import { ImageAssociationService } from './application/image-association.service';
import { ImageCaptioningService } from './application/image-captioning.service';
import { StoredImageRepository } from './infrastructure/stored-image.repository';
import { QuestionImageRepository } from './infrastructure/question-image.repository';

export { ImageAssociationService, ImageCaptioningService, StoredImageRepository, QuestionImageRepository };
export type {
  AssociateImageInput,
  CaptionAndIndexInput,
  ImageCaptionResult,
  QuestionImagePosition,
  QuestionImageView,
  RemoveAssociationResult,
  StoreImageInput,
} from './domain/media.types';

/**
 * `server/media`'s public barrel (migration plan Phase 6, sub-slice "6b") — FR-PDF-11/FR-FILE-3's
 * content-hash-deduped, reference-counted image storage/association (`ImageAssociationService`) and
 * vision captioning + retrieval indexing (`ImageCaptioningService`). Nothing outside this module may
 * import `./domain/**`/`./infrastructure/**`/`./application/**` directly (enforced by
 * `apps/next/.eslintrc.cjs`'s `media` module-boundary rule).
 *
 * **Why a NEW module rather than folding these into `server/files` (legacy's own home for them) — a
 * documented judgment call**: legacy's `modules/files` was a broad "everything file-shaped" module,
 * but `apps/next`'s `server/files` (Phase 1c) is deliberately narrow, low-level *shared infrastructure*
 * — signed delivery, the `StoragePort` singleton, avatar upload — and is consumed by
 * `server/exam-authoring`, `server/profile`, and `server/pdf-processing` alike. Reading the actual
 * legacy code first (as this dispatch was instructed to) showed these two services depend on
 * `AiServicePort`, the embeddings port, the Qdrant adapter, and two tenant tables that only exist
 * because of the PDF pipeline. Putting them in `server/files` would make this app's lowest-level
 * shared-infra module depend on `server/ai`/`server/vector`, inverting the dependency direction every
 * other module already respects. They are also not `server/pdf-processing`-internal: FR-FILE-3's manual
 * add/remove flow (a later sub-slice) is a files/media concern, not a PDF-pipeline one. A dedicated
 * `server/media` module (named for the `media` tables legacy's own migration already calls them) keeps
 * both facts true.
 *
 * {@link buildMediaServices} takes an EXPLICIT `DataSource` rather than reading one off ambient
 * context, because its only consumer today (`server/pdf-processing`'s `buildPdfProcessingService`) is
 * itself a composition root that may be running in a fresh background tenant scope — the identical
 * reason `buildPdfProcessingService` itself takes an explicit `DataSource`.
 */
export function buildMediaServices(dataSource: DataSource): {
  imageAssociation: ImageAssociationService;
  imageCaptioning: ImageCaptioningService;
} {
  const storedImages = new StoredImageRepository(dataSource);
  const questionImages = new QuestionImageRepository(dataSource);
  return {
    imageAssociation: new ImageAssociationService(dataSource, getStoragePortSingleton(), storedImages, questionImages),
    imageCaptioning: new ImageCaptioningService(getAiService(), getQdrantVectorStoreAdapter(), getEmbeddingsPort(), storedImages),
  };
}
