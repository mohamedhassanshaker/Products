import type { PermissionResolutionService } from '@/server/rbac';
import type { StoragePort } from '@/server/common/ports/storage.port';
import { isPdfSignature } from '@/server/common/util/pdf-signature.util';
import { extractPdfPages } from '@/server/infrastructure/text-extraction';
import type { CurriculumEntity } from '@/server/infrastructure/database';
import { CurriculaRepository } from '../infrastructure/curricula.repository';
import { CurriculumIndexingService, sha256Hex } from './curriculum-indexing.service';
import { CurriculumNotFoundError, NoExtractableTextError, NotCurriculumOwnerError } from '../domain/errors';
import type { CurriculumDocumentSummary, CurriculumSearchResultItem, UploadedDocumentFile } from '../domain/curricula.types';

/** The one non-tenant-wide permission granting the "Tenant Admin acting in an oversight capacity"
 * bypass for a Curriculum one does not own — the same constant `CurriculaService` uses. */
const OVERSIGHT_PERMISSION = 'curricula.read_all';

/** FR-CUR-3's default result count when the caller names none. */
const DEFAULT_SEARCH_LIMIT = 10;

/**
 * FR-CUR-2/FR-CUR-3's Curriculum document ingestion and semantic search (migration plan Phase 6,
 * sub-slice "6b") — adapted from `legacy/api/src/modules/curricula/application/curricula.service.ts`'s
 * `uploadDocuments`/`ingestOneFile`/`search` half. This **closes Phase 3's own documented deferral**:
 * that phase deliberately shipped `server/curricula` as ownership/metadata only because the
 * text-extraction/chunking/embedding infrastructure this half needs did not exist yet. It does now
 * (Phase 5's vector/embeddings layer + Phase 6a's `pdf-parse` text extractor), so the deferred half is
 * built here rather than left permanently half-ported.
 *
 * **Its own service, not extra methods on `CurriculaService`** — a deliberate split: this half needs
 * four collaborators (`StoragePort`, the chunk/embed/upsert pipeline, the Qdrant adapter for search,
 * permissions) that the ownership/metadata half needs none of; merging them would put
 * `CurriculaService` at seven, well past this project's ~4-5 guideline. Both are composed together in
 * this module's barrel and both enforce the identical owner-or-`curricula.read_all` rule.
 *
 * **Cost-control ordering (FR-CUR-2's own exit gate, ported verbatim)**: validation → text extraction →
 * "is there any text at all?" all happen BEFORE the first storage write and before any embedding call.
 * A scanned/empty/corrupt PDF is rejected with `NO_EXTRACTABLE_TEXT` having spent nothing and stored
 * nothing.
 */
export class CurriculumDocumentsService {
  constructor(
    private readonly repository: CurriculaRepository,
    private readonly storage: StoragePort,
    private readonly indexing: CurriculumIndexingService,
    private readonly permissions: PermissionResolutionService,
  ) {}

  /**
   * FR-CUR-2: ingests one PDF into a Curriculum — validated, extracted, stored, chunked, embedded,
   * upserted into the tenant's chunk collection, and recorded as a `curriculum_document` row. The
   * resulting chunks are immediately usable as grounding by every retrieval consumer
   * (`RetrievalService`), which is what makes this the real closure of Phase 3's deferral rather than a
   * file-parking endpoint.
   *
   * @throws {CurriculumNotFoundError} @throws {NotCurriculumOwnerError}
   * @throws {import('../domain/errors').InvalidFileSignatureError-equivalent} — reuses
   *   {@link NoExtractableTextError} for a non-PDF/corrupt/text-free upload alike (see that error's own
   *   doc comment for why one code covers all three at this surface).
   */
  async uploadDocument(
    actingUserId: string,
    tenantId: string,
    curriculumId: string,
    file: UploadedDocumentFile,
  ): Promise<CurriculumDocumentSummary> {
    const curriculum = await this.requireCurriculum(curriculumId);
    await this.assertOwnerOrOversight(actingUserId, curriculum);

    // Cheapest checks first, and every one of them before any storage/embedding cost is incurred.
    if (file.buffer.length === 0 || !isPdfSignature(file.buffer)) throw new NoExtractableTextError();

    const pages = await extractPdfPages(file.buffer).catch(() => {
      // A corrupt/unparsable PDF is, from this endpoint's perspective, indistinguishable from "no
      // usable text" — and NFR-5 forbids leaking the underlying parser's raw error to the client.
      throw new NoExtractableTextError();
    });
    if (!pages.some((page) => page.text.trim().length > 0)) throw new NoExtractableTextError();

    // Every storage-key segment is server-derived (tenant id, curriculum id, content hash) — the
    // client-supplied file name is recorded as data only, never used as a path segment, so path
    // traversal is structurally impossible here.
    const fileHash = sha256Hex(file.buffer);
    const storageKey = `tenants/${tenantId}/curricula/${curriculumId}/documents/${fileHash}.pdf`;
    await this.storage.put(storageKey, file.buffer, 'application/pdf');

    try {
      const document = await this.indexing.indexDocument({
        tenantId,
        curriculumId,
        fileName: file.originalName,
        storageKey,
        fileHash,
        pages,
      });
      return toDocumentSummary(document);
    } catch (err) {
      // Roll the storage write back so a failed embedding/DB step leaves zero artifacts behind —
      // matching `ExamAuthoringService.createFromZip`'s identical established rollback discipline.
      await this.storage.delete(storageKey).catch(() => undefined);
      throw err;
    }
  }

  /** Every document indexed into a Curriculum, newest first.
   * @throws {CurriculumNotFoundError} @throws {NotCurriculumOwnerError} */
  async listDocuments(actingUserId: string, curriculumId: string): Promise<CurriculumDocumentSummary[]> {
    const curriculum = await this.requireCurriculum(curriculumId);
    await this.assertOwnerOrOversight(actingUserId, curriculum);
    const documents = await this.repository.findDocuments(curriculumId);
    return documents.map(toDocumentSummary);
  }

  /**
   * FR-CUR-3's semantic search over one Curriculum's indexed chunks, each result citing its originating
   * document and page. Built in this same sub-slice because, once ingestion exists, it is a genuinely
   * low-cost extension — one embed call plus the already-built, tenant-scoped
   * `QdrantVectorStoreAdapter.searchChunks` — and shipping ingestion without any way to observe its
   * output would leave the feature unverifiable from the outside.
   *
   * **An empty query returns `[]` (200), never an error and never an arbitrary "browse everything"
   * listing** (FR-CUR-3) — and no embedding call is made for it.
   *
   * @throws {CurriculumNotFoundError} @throws {NotCurriculumOwnerError}
   */
  async search(
    actingUserId: string,
    tenantId: string,
    curriculumId: string,
    input: { query?: string; limit?: number },
  ): Promise<CurriculumSearchResultItem[]> {
    const curriculum = await this.requireCurriculum(curriculumId);
    await this.assertOwnerOrOversight(actingUserId, curriculum);

    const query = (input.query ?? '').trim();
    if (query.length === 0) return [];

    const [queryVector] = await this.indexing.embedQuery(query);
    const points = await this.indexing.searchChunks(tenantId, queryVector, curriculumId, input.limit ?? DEFAULT_SEARCH_LIMIT);

    return points.map((point) => ({
      documentId: typeof point.payload['documentId'] === 'string' ? point.payload['documentId'] : '',
      fileName: typeof point.payload['fileName'] === 'string' ? point.payload['fileName'] : '',
      pageNumber: typeof point.payload['pageNumber'] === 'number' ? point.payload['pageNumber'] : 0,
      text: typeof point.payload['text'] === 'string' ? point.payload['text'] : '',
      score: point.score,
    }));
  }

  private async requireCurriculum(id: string): Promise<CurriculumEntity> {
    const curriculum = await this.repository.findById(id);
    if (!curriculum) throw new CurriculumNotFoundError();
    return curriculum;
  }

  private async assertOwnerOrOversight(actingUserId: string, curriculum: CurriculumEntity): Promise<void> {
    if (curriculum.ownerUserId === actingUserId) return;
    if (await this.permissions.hasPermission(actingUserId, OVERSIGHT_PERMISSION)) return;
    throw new NotCurriculumOwnerError();
  }
}

function toDocumentSummary(entity: {
  id: string;
  fileName: string;
  title: string | null;
  contentType: 'Reference';
  pageCount: number | null;
  chunkCount: number;
  uploadedAt: Date;
}): CurriculumDocumentSummary {
  return {
    id: entity.id,
    fileName: entity.fileName,
    title: entity.title,
    contentType: entity.contentType,
    pageCount: entity.pageCount,
    chunkCount: entity.chunkCount,
    uploadedAt: entity.uploadedAt,
  };
}
