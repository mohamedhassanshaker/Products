import { createHash } from 'node:crypto';
import { requireTenantId } from '@/server/context';
import type { CurriculumIndexingService } from '@/server/curricula';
import type { PageText } from '@/server/common/util/chunking.util';
import type { PdfProcessingSessionEntity } from '@/server/infrastructure/database';

/**
 * FR-PDF-6's reference-indexing branch (LLD §8.3's `contentType = Reference` branch) — the third wired
 * `PdfContentStrategy` (migration plan Phase 6, sub-slice "6b"), appended to
 * `buildPdfProcessingService`'s composition-root strategy array with no change to
 * `PdfGenerationOrchestrator` itself. Ported logic from
 * `legacy/api/src/modules/pdf-processing/application/reference-indexing.service.ts`.
 *
 * "The platform indexes the document into the user's Curriculum for future retrieval rather than
 * generating questions from it." A Reference session therefore legitimately reaches `Completed` with
 * ZERO `generated_question` rows — that is the branch's correct outcome, not a degraded one.
 *
 * **Deliberately a thin adapter over `server/curricula`'s `CurriculumIndexingService`, not its own
 * chunk/embed/upsert implementation** — legacy's own version of this class duplicated
 * `CurriculaService.ingestOneFile`'s pipeline verbatim and its doc comment openly described itself as
 * "that method's sibling, not a divergent reimplementation". This app makes that structural: there is
 * exactly ONE chunk→embed→upsert→record implementation in the whole codebase, owned by the module that
 * owns the `curriculum_document` table, consumed identically by both entry points. That keeps this
 * class at a single collaborator and makes chunk-size/payload-vocabulary drift between the two paths
 * impossible rather than merely discouraged.
 *
 * **Storage is never re-written** — `uploadPdf` already stored the source bytes at
 * `session.sourceStorageKey`; the recorded `curriculum_document.storage_key` points at that same
 * object rather than duplicating a 50 MB PDF.
 */
export class ReferenceIndexingService {
  constructor(private readonly indexing: CurriculumIndexingService) {}

  /**
   * Resolves (or auto-creates) the target Curriculum, then chunks/embeds/upserts/records the document
   * — mutating `session.curriculumId`/`curriculumDocumentId` in place so the caller
   * (`PdfGenerationOrchestrator`, which saves the session immediately afterward) persists the final
   * values alongside the rest of the session row.
   *
   * @throws {import('@/server/curricula').SubjectRequiredForIndexingError} when neither a resolvable
   *   Curriculum nor a Subject is available — see `CurriculumIndexingService.resolveOrCreateCurriculum`'s
   *   own doc comment for why this fails loudly instead of guessing or silently dropping the material.
   */
  async index(session: PdfProcessingSessionEntity, pages: PageText[]): Promise<void> {
    const tenantId = requireTenantId();

    const curriculum = await this.indexing.resolveOrCreateCurriculum({
      curriculumId: session.curriculumId,
      subjectId: session.subjectId,
      ownerUserId: session.initiatedByUserId ?? deterministicOwnerFallback(session),
      sourceFileName: session.sourceFileName,
    });
    session.curriculumId = curriculum.id;

    const document = await this.indexing.indexDocument({
      tenantId,
      curriculumId: curriculum.id,
      fileName: session.sourceFileName,
      storageKey: session.sourceStorageKey,
      fileHash: session.fileHash,
      pages,
      pageCount: session.pageCount ?? pages.length,
    });

    session.curriculumDocumentId = document.id;
  }
}

/** `initiatedByUserId` is nullable on the entity (a defensive DB-schema allowance), but is always
 * populated in practice: every real upload path requires an authenticated caller. This hashes the
 * session id into a stable placeholder only so a pathological row can never crash auto-creation
 * outright — genuinely unreachable in production, defended defensively rather than asserted with `!`.
 * `curriculum.owner_user_id` is a soft reference (no FK), so a placeholder here cannot violate
 * referential integrity. */
function deterministicOwnerFallback(session: PdfProcessingSessionEntity): string {
  return createHash('sha256').update(session.id).digest('hex').slice(0, 36);
}
