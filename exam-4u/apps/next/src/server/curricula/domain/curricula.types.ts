/** `POST /api/curricula` input, already shape-validated by the Route Handler (LLD §1.2 Tier B: shape
 * validation at the HTTP boundary, existence/business-rule validation in the service). */
export interface CreateCurriculumInput {
  name: string;
  description?: string;
  subjectId: number;
}

/** `PATCH /api/curricula/:id` input — every field optional (partial update). */
export interface UpdateCurriculumInput {
  name?: string;
  description?: string;
}

/** `GET /api/curricula`/`GET /api/curricula/:id` response shape — **ownership/metadata only** this
 * phase (see `docs/plans/nextjs-rewrite-phase3-plan.md`'s scope-split write-up). No `documents` field
 * exists yet; Phase 5/6 add it once document upload/ingestion lands — an additive, non-breaking
 * extension to this shape, not a redesign of it. */
export interface CurriculumSummary {
  id: string;
  name: string;
  description: string | null;
  subjectId: number;
  ownerUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** A minimal, adapter-agnostic view of an uploaded multipart file — decouples this module from any
 * particular multipart-parsing library, matching `PdfProcessingService`'s identical `UploadedFileLike`
 * convention. */
export interface UploadedDocumentFile {
  originalName: string;
  buffer: Buffer;
}

/** One `curriculum_document` row's public shape (Phase 6, sub-slice "6b" — the additive, non-breaking
 * extension Phase 3's own `CurriculumSummary` doc comment predicted). `chunkCount` is the honest,
 * observable proof that ingestion actually chunked and embedded the document rather than merely
 * parking the file. */
export interface CurriculumDocumentSummary {
  id: string;
  fileName: string;
  title: string | null;
  contentType: 'Reference';
  pageCount: number | null;
  chunkCount: number;
  uploadedAt: Date;
}

/** FR-CUR-3: one semantic-search hit, always citing its originating document and page. */
export interface CurriculumSearchResultItem {
  documentId: string;
  fileName: string;
  pageNumber: number;
  text: string;
  score: number;
}
