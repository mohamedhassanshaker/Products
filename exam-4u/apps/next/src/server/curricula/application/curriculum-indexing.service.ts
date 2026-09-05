import { createHash, randomUUID } from 'node:crypto';
import { getEnv } from '@/server/config';
import type { EmbeddingsPort } from '@/server/vector';
import type { QdrantVectorStoreAdapter } from '@/server/infrastructure/vector';
import { chunkPages, type PageText } from '@/server/common/util/chunking.util';
import { CurriculumDocumentEntity, CurriculumEntity } from '@/server/infrastructure/database';
import { CurriculaRepository } from '../infrastructure/curricula.repository';
import { SubjectRequiredForIndexingError } from '../domain/errors';

/** Everything {@link CurriculumIndexingService.indexDocument} needs. `storageKey` names an object the
 * CALLER already wrote — this service never touches blob storage itself, which is what lets the
 * Reference-indexing branch reuse the PDF session's own `source_storage_key` verbatim instead of
 * storing the identical bytes a second time. */
export interface IndexDocumentInput {
  tenantId: string;
  curriculumId: string;
  fileName: string;
  storageKey: string;
  fileHash: string;
  pages: PageText[];
  /** The document's real page count when the caller knows it independently of `pages` (a PDF session
   * already recorded `page_count`); defaults to `pages.length`. */
  pageCount?: number | null;
}

/** How a Curriculum should be resolved for an indexing pass that may not name an existing one. */
export interface ResolveCurriculumInput {
  /** An explicitly-named Curriculum — used as-is when it still exists. */
  curriculumId: string | null;
  /** Required to auto-create a Curriculum (`curriculum.subject_id` is `NOT NULL`). */
  subjectId: number | null;
  ownerUserId: string;
  /** Source file name the auto-created Curriculum is named from (extension stripped). */
  sourceFileName: string;
}

/**
 * The single chunk → embed → upsert → record pipeline shared by BOTH document-ingestion entry points
 * (migration plan Phase 6, sub-slice "6b"): `CurriculaService.uploadDocument` (FR-CUR-2, closing Phase
 * 3's own documented deferral) and `server/pdf-processing`'s `ReferenceIndexingService` (FR-PDF-6).
 * Legacy had these as two near-identical implementations that its own
 * `ReferenceIndexingService` doc comment explicitly called "deliberately shaped as
 * `CurriculaService.ingestOneFile`'s sibling, not a divergent reimplementation" — this app makes that
 * intent structural instead of aspirational, so the two paths can never drift apart on chunk
 * size/payload vocabulary/point-id scheme.
 *
 * The chunk payload vocabulary written here (`curriculumId`/`documentId`/`pageNumber`/`chunkIndex`/
 * `fileName`/`text`/`embeddingModel`) is exactly what `RetrievalService.retrieve`'s own
 * `toRetrievedChunk` mapping already reads — grounding for lesson generation/exam extraction/prompt
 * practice works against these points with zero changes to that service.
 *
 * Tenant isolation is structural, not conventional: every write goes through
 * `QdrantVectorStoreAdapter.upsertChunks({tenantId}, ...)`, whose mandatory `TenantScope` argument the
 * adapter stamps into every point's payload and enforces on every read.
 */
export class CurriculumIndexingService {
  constructor(
    private readonly repository: CurriculaRepository,
    private readonly vectorAdapter: QdrantVectorStoreAdapter,
    private readonly embeddings: EmbeddingsPort,
  ) {}

  /**
   * Chunks `pages`, embeds every chunk, upserts them into the tenant's chunks collection, and records
   * one `curriculum_document` row describing the result.
   *
   * A document whose pages are all blank produces zero chunks — the `curriculum_document` row is still
   * written (with `chunk_count: 0`) so the upload is visible/auditable rather than silently vanishing;
   * no embedding call is made at all in that case (cost control: nothing is embedded for a document
   * with no text).
   */
  async indexDocument(input: IndexDocumentInput): Promise<CurriculumDocumentEntity> {
    const env = getEnv();
    const chunks = chunkPages(input.pages, env.CHUNK_SIZE_CHARS, env.CHUNK_OVERLAP_CHARS);
    const documentId = randomUUID();

    if (chunks.length > 0) {
      const vectors = await this.embeddings.embed(chunks.map((chunk) => chunk.text));
      const points = chunks.map((chunk, index) => ({
        // Deterministic, tenant-namespaced point id keyed on `{documentId}:{chunkIndex}` — re-running
        // an identical index pass overwrites rather than duplicating.
        id: this.vectorAdapter.pointId(input.tenantId, `${documentId}:${chunk.chunkIndex}`),
        vector: vectors[index],
        payload: {
          curriculumId: input.curriculumId,
          documentId,
          pageNumber: chunk.pageNumber,
          chunkIndex: chunk.chunkIndex,
          fileName: input.fileName,
          text: chunk.text,
          embeddingModel: this.embeddings.model,
        },
      }));
      await this.vectorAdapter.upsertChunks({ tenantId: input.tenantId }, points);
    }

    const document = new CurriculumDocumentEntity();
    document.id = documentId;
    document.curriculumId = input.curriculumId;
    document.fileName = input.fileName;
    document.title = null;
    document.contentType = 'Reference';
    document.storageKey = input.storageKey;
    document.fileHash = input.fileHash;
    document.pageCount = input.pageCount ?? input.pages.length;
    document.chunkCount = chunks.length;
    await this.repository.insertDocument(document);
    return document;
  }

  /** Embeds one raw query string for FR-CUR-3's semantic search — exposed here (rather than making
   * `CurriculumDocumentsService` hold its own `EmbeddingsPort`) so this module has exactly one file
   * that talks to the embeddings/vector infrastructure, and the search path provably embeds with the
   * same model the ingest path indexed with. */
  async embedQuery(query: string): Promise<number[][]> {
    return this.embeddings.embed([query]);
  }

  /** FR-CUR-3's tenant- and Curriculum-scoped chunk search. The `{tenantId}` scope argument is
   * mandatory on the adapter, so a cross-tenant read is not expressible from here. */
  async searchChunks(tenantId: string, queryVector: number[], curriculumId: string, limit: number) {
    return this.vectorAdapter.searchChunks({ tenantId }, queryVector, { curriculumId }, limit);
  }

  /** Deletes every indexed chunk belonging to a Curriculum — called when the Curriculum itself is
   * deleted, since `fk_doc_cur ON DELETE CASCADE` removes the `curriculum_document` rows but no FK can
   * reach into Qdrant. Best-effort at the call site: a vector-store outage must not block the DB
   * delete the user asked for. */
  async deleteChunksForCurriculum(tenantId: string, curriculumId: string): Promise<void> {
    await this.vectorAdapter.deleteChunks({ tenantId }, { curriculumId });
  }

  /**
   * FR-PDF-6's "If no Curriculum is specified/resolvable... one is created automatically... so
   * reference material is never silently dropped" resolution order:
   *   1. `curriculumId`, if it points at a real, still-existing Curriculum — used as-is.
   *   2. Otherwise, auto-create one named from the source file, owned by `ownerUserId`, under
   *      `subjectId`.
   *
   * **Documented judgment call (ported verbatim from legacy's own)**: `curriculum.subject_id` is
   * `NOT NULL`, so auto-creation needs a real subject. When neither an existing/resolvable
   * `curriculumId` **nor** a `subjectId` is available, this throws
   * {@link SubjectRequiredForIndexingError} rather than guessing a subject or dropping the material
   * silently — the failure surfaces loudly as the calling session's own `errorCode` (a reviewer can
   * act on it by re-uploading with a subject), satisfying "never silently dropped" without inventing
   * an arbitrary default-subject concept the spec never describes.
   *
   * @throws {SubjectRequiredForIndexingError}
   */
  async resolveOrCreateCurriculum(input: ResolveCurriculumInput): Promise<CurriculumEntity> {
    if (input.curriculumId) {
      const existing = await this.repository.findById(input.curriculumId);
      if (existing) return existing;
    }

    if (input.subjectId === null) {
      throw new SubjectRequiredForIndexingError();
    }

    const entity = new CurriculumEntity();
    entity.id = randomUUID();
    entity.name = deriveNameFromFileName(input.sourceFileName);
    entity.description = null;
    entity.subjectId = input.subjectId;
    entity.ownerUserId = input.ownerUserId;
    entity.createdAt = new Date();
    entity.updatedAt = new Date();
    return this.repository.create(entity);
  }
}

/** `"biology-chapter-3.pdf"` -> `"biology-chapter-3"` (FR-PDF-6: "named from the source file"). Falls
 * back to the raw file name if stripping the extension would leave nothing. */
export function deriveNameFromFileName(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '').trim() || fileName;
}

/** SHA-256 hex of a buffer — the same `file_hash` convention `pdf_processing_session`/`stored_image`
 * already use, so a Curriculum document uploaded directly and the same bytes uploaded through the PDF
 * pipeline record an identical hash. */
export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
