import type { DataSource } from 'typeorm';
import { requireTenantDataSource } from '@/server/context';
import { SubjectRepository } from '@/server/taxonomy';
import { getPermissionResolutionService } from '@/server/rbac';
import { getEmbeddingsPort } from '@/server/infrastructure/embeddings';
import { getQdrantVectorStoreAdapter } from '@/server/infrastructure/vector';
import { getStoragePortSingleton } from '@/server/files';
import { CurriculaService } from './application/curricula.service';
import { CurriculumIndexingService } from './application/curriculum-indexing.service';
import { CurriculumDocumentsService } from './application/curriculum-documents.service';
import { CurriculaRepository } from './infrastructure/curricula.repository';

export { CurriculaService, CurriculaRepository, CurriculumIndexingService, CurriculumDocumentsService };
export type {
  CreateCurriculumInput,
  CurriculumDocumentSummary,
  CurriculumSearchResultItem,
  CurriculumSummary,
  UpdateCurriculumInput,
  UploadedDocumentFile,
} from './domain/curricula.types';
export type { IndexDocumentInput, ResolveCurriculumInput } from './application/curriculum-indexing.service';
export {
  CurriculumNotFoundError,
  DocumentNotFoundError,
  NoExtractableTextError,
  NotCurriculumOwnerError,
  SubjectNotFoundError,
  SubjectRequiredForIndexingError,
} from './domain/errors';

/**
 * `server/curricula`'s public barrel. Phase 3 shipped Curriculum ownership/metadata only
 * (FR-CUR-1/FR-CUR-1a), explicitly deferring document management/search until the text-extraction/
 * chunking/embedding infrastructure existed. Phase 6 sub-slice "6b" **closes that deferral**: this
 * module now also owns the `curriculum_document` table, the one chunk→embed→upsert→record pipeline
 * (`CurriculumIndexingService`), document upload + FR-CUR-3 semantic search
 * (`CurriculumDocumentsService`). Nothing outside this module may import `./domain/**`/
 * `./infrastructure/**`/`./application/**` directly (enforced by `apps/next/.eslintrc.cjs`'s
 * `curricula` module-boundary rule).
 *
 * Every composition root below builds a fresh instance per call — every collaborator needs the
 * *current request's* tenant-scoped `DataSource`, matching every other tenant-scoped module's
 * identical convention. `SubjectRepository`/`getPermissionResolutionService`/`getEmbeddingsPort`/
 * `getQdrantVectorStoreAdapter`/`getStoragePortSingleton` are all consumed through their own modules'
 * public barrels, never a deep import — this module boundary rule cuts both ways.
 */
export function getCurriculaService(): CurriculaService {
  const dataSource = requireTenantDataSource();
  return new CurriculaService(
    new CurriculaRepository(dataSource),
    new SubjectRepository(dataSource),
    getPermissionResolutionService(),
    getCurriculumIndexingService(dataSource),
  );
}

/** FR-CUR-2/FR-CUR-3's document upload/list/search entry point. */
export function getCurriculumDocumentsService(): CurriculumDocumentsService {
  const dataSource = requireTenantDataSource();
  return new CurriculumDocumentsService(
    new CurriculaRepository(dataSource),
    getStoragePortSingleton(),
    getCurriculumIndexingService(dataSource),
    getPermissionResolutionService(),
  );
}

/**
 * Composition root for the shared chunk→embed→upsert→record pipeline. Takes an **explicit**
 * `DataSource` rather than reading the ambient one, because its second consumer —
 * `server/pdf-processing`'s `buildPdfProcessingService`, which wires the FR-PDF-6 Reference-indexing
 * strategy — is itself a composition root that may be running in a fresh *background* tenant scope
 * with no ambient request context at all (see `PdfProcessingService`'s own doc comment). The
 * request-path callers above simply pass what `requireTenantDataSource()` already gave them.
 */
export function getCurriculumIndexingService(dataSource: DataSource): CurriculumIndexingService {
  return new CurriculumIndexingService(new CurriculaRepository(dataSource), getQdrantVectorStoreAdapter(), getEmbeddingsPort());
}
