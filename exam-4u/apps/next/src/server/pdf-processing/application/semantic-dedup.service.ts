import { getEnv } from '@/server/config';
import type { EmbeddingsPort } from '@/server/vector';
import type { QdrantVectorStoreAdapter } from '@/server/infrastructure/vector';
import { PdfProcessingSessionRepository } from '../infrastructure/pdf-processing-session.repository';
import { PdfProcessingSessionEntity } from '@/server/infrastructure/database';

/**
 * FR-PDF-2's **semantic (tier 2)** dedup tier, layered on top of tier-1 exact-hash dedup — this
 * sub-slice's real consumer of Phase 5's now-real vector infrastructure (`VectorStorePort.
 * searchFingerprint`/`upsertFingerprint` + `EmbeddingsPort`), ported logic from
 * `legacy/api/src/modules/pdf-processing/application/semantic-dedup.service.ts`.
 *
 * Deliberately split out of `PdfProcessingService` rather than folded directly into it — matching
 * legacy's own "keeps a call site's constructor small" rationale. Takes the concrete
 * `QdrantVectorStoreAdapter` directly (rather than legacy's separate `VectorStorePort` + raw-adapter
 * pair) — in this app there is no DI-token indirection between the interface and the concrete class, so
 * one constructor param structurally satisfies `VectorStorePort` (searchFingerprint/upsertFingerprint)
 * AND exposes `pointId()` (a method not on the abstract port), which legacy needed two separate
 * injected references for.
 *
 * **Ordering**: this tier is only ever consulted by `PdfProcessingService.processSession` *after* its
 * own tier-1 exact-hash lookup misses — never as a replacement for it, never before it. This tier's
 * embedding input requires already-extracted text, so it runs after `extract()`, not before it (a
 * documented, minor deviation from the LLD diagram's literal ordering, carried forward from legacy).
 */
export class SemanticDedupService {
  constructor(
    private readonly vectorAdapter: QdrantVectorStoreAdapter,
    private readonly embeddings: EmbeddingsPort,
    private readonly sessions: PdfProcessingSessionRepository,
  ) {}

  /**
   * Computes the whole-document fingerprint embedding for `sampleText` (the same first-4000-chars
   * sample `classify()` already builds). Returns `null` for blank/whitespace-only text (nothing
   * meaningful to embed — e.g. a scanned/image-only PDF with no extractable text) rather than sending an
   * empty string to the embeddings provider.
   */
  async embedFingerprint(sampleText: string): Promise<number[] | null> {
    if (!sampleText.trim()) return null;
    const [vector] = await this.embeddings.embed([sampleText]);
    return vector ?? null;
  }

  /**
   * The tier-2 lookup itself: cosine similarity >= `FINGERPRINT_SIMILARITY_THRESHOLD` (configurable,
   * default 0.97) against `<prefix>_doc_fingerprints`, scoped to the current tenant.
   * `VectorStorePort.searchFingerprint` already applies the threshold as a Qdrant-side
   * `score_threshold`, so every returned point already qualifies — this method's own job is only to
   * resolve the payload's `sessionId` back to a real, still-`Completed` session to reuse from
   * (defensive: a point could in principle reference a session that was later reprocessed/removed).
   * Returns the first (highest-scoring) resolvable match, or `null` if none qualify.
   */
  async findSemanticMatch(tenantId: string, vector: number[]): Promise<PdfProcessingSessionEntity | null> {
    const threshold = getEnv().FINGERPRINT_SIMILARITY_THRESHOLD;
    const matches = await this.vectorAdapter.searchFingerprint({ tenantId }, vector, threshold);
    for (const match of matches) {
      const matchedSessionId = typeof match.payload.sessionId === 'string' ? match.payload.sessionId : undefined;
      if (!matchedSessionId) continue;
      const matchedSession = await this.sessions.findById(matchedSessionId);
      if (matchedSession && matchedSession.status === 'Completed') return matchedSession;
    }
    return null;
  }

  /**
   * Upserts this now-successfully-processed session's whole-document fingerprint so a *future* upload
   * of a near-duplicate (not byte-identical, so tier 1 would miss it) can be deduped against it. Point
   * id is keyed by `fileHash`, not `sessionId` — a re-upload of literally the same bytes overwrites its
   * own fingerprint point in place instead of accumulating duplicate points for one file, mirroring tier
   * 1's own exact-hash identity semantics.
   */
  async upsertFingerprint(tenantId: string, session: PdfProcessingSessionEntity, vector: number[]): Promise<void> {
    await this.vectorAdapter.upsertFingerprint(
      { tenantId },
      {
        id: this.vectorAdapter.pointId(tenantId, session.fileHash),
        vector,
        payload: {
          fileHash: session.fileHash,
          sessionId: session.id,
          documentId: session.curriculumDocumentId ?? undefined,
        },
      },
    );
  }
}
