import { describe, expect, it, vi } from 'vitest';
import type { EmbeddingsPort } from '@/server/vector';
import type { QdrantVectorStoreAdapter } from '@/server/infrastructure/vector';
import { PdfProcessingSessionEntity } from '@/server/infrastructure/database';
import type { PdfProcessingSessionRepository } from '../infrastructure/pdf-processing-session.repository';
import { SemanticDedupService } from './semantic-dedup.service';

function fakeSession(overrides: Partial<PdfProcessingSessionEntity> = {}): PdfProcessingSessionEntity {
  return Object.assign(new PdfProcessingSessionEntity(), {
    id: 'sess-original',
    status: 'Completed',
    contentType: 'Exam',
    pageCount: 5,
    fileHash: 'hash-original',
    curriculumDocumentId: null,
    ...overrides,
  });
}

function scoredPoint(sessionId: string | undefined, score = 0.99) {
  return { id: 'point-1', score, payload: sessionId === undefined ? {} : { sessionId } };
}

function fakeVectorAdapter(overrides: Partial<QdrantVectorStoreAdapter> = {}): QdrantVectorStoreAdapter {
  return {
    searchFingerprint: vi.fn().mockResolvedValue([]),
    upsertFingerprint: vi.fn().mockResolvedValue(undefined),
    pointId: vi.fn().mockReturnValue('point-id'),
    ...overrides,
  } as unknown as QdrantVectorStoreAdapter;
}

/**
 * Unit coverage for `SemanticDedupService` (FR-PDF-2 tier 2) — every method exercised directly with
 * fakes for the vector-store-adapter/embeddings/repository boundaries it crosses. Real Qdrant
 * cosine-similarity boundary behavior (the threshold itself) is a real-Qdrant integration concern, not
 * this suite's job — this suite proves this class's own orchestration logic (threshold pass-through via
 * `getEnv()`, payload shape, defensive resolution of a matched point back to a real session,
 * blank-text short-circuit).
 */
describe('SemanticDedupService (FR-PDF-2 tier 2)', () => {
  describe('embedFingerprint', () => {
    it('embeds the given sample text and returns the first (only) resulting vector', async () => {
      const embeddings = { embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]), model: 'm', dims: 3 } as unknown as EmbeddingsPort;
      const service = new SemanticDedupService(fakeVectorAdapter(), embeddings, {} as PdfProcessingSessionRepository);

      const result = await service.embedFingerprint('some exam content');

      expect(embeddings.embed).toHaveBeenCalledWith(['some exam content']);
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    it('returns null for blank/whitespace-only text without calling the embeddings provider', async () => {
      const embeddings = { embed: vi.fn(), model: 'm', dims: 3 } as unknown as EmbeddingsPort;
      const service = new SemanticDedupService(fakeVectorAdapter(), embeddings, {} as PdfProcessingSessionRepository);

      const result = await service.embedFingerprint('   \n\t  ');

      expect(result).toBeNull();
      expect(embeddings.embed).not.toHaveBeenCalled();
    });
  });

  describe('findSemanticMatch', () => {
    it('passes the configured FINGERPRINT_SIMILARITY_THRESHOLD through to searchFingerprint', async () => {
      const vectorAdapter = fakeVectorAdapter();
      const sessions = { findById: vi.fn() } as unknown as PdfProcessingSessionRepository;
      const service = new SemanticDedupService(vectorAdapter, {} as EmbeddingsPort, sessions);

      await service.findSemanticMatch('tenant-1', [0.1, 0.2]);

      // Default env FINGERPRINT_SIMILARITY_THRESHOLD is 0.97 (env.schema.ts default).
      expect(vectorAdapter.searchFingerprint).toHaveBeenCalledWith({ tenantId: 'tenant-1' }, [0.1, 0.2], 0.97);
    });

    it("resolves the top match's payload.sessionId back to a real, Completed session", async () => {
      const match = fakeSession({ id: 'sess-original', status: 'Completed' });
      const vectorAdapter = fakeVectorAdapter({ searchFingerprint: vi.fn().mockResolvedValue([scoredPoint('sess-original')]) });
      const sessions = { findById: vi.fn().mockResolvedValue(match) } as unknown as PdfProcessingSessionRepository;
      const service = new SemanticDedupService(vectorAdapter, {} as EmbeddingsPort, sessions);

      const result = await service.findSemanticMatch('tenant-1', [0.1, 0.2]);

      expect(sessions.findById).toHaveBeenCalledWith('sess-original');
      expect(result).toBe(match);
    });

    it('returns null when no point is returned (a genuine miss)', async () => {
      const vectorAdapter = fakeVectorAdapter();
      const sessions = { findById: vi.fn() } as unknown as PdfProcessingSessionRepository;
      const service = new SemanticDedupService(vectorAdapter, {} as EmbeddingsPort, sessions);

      expect(await service.findSemanticMatch('tenant-1', [0.1])).toBeNull();
      expect(sessions.findById).not.toHaveBeenCalled();
    });

    it('skips a point with no sessionId payload field (defensive) and returns null', async () => {
      const vectorAdapter = fakeVectorAdapter({ searchFingerprint: vi.fn().mockResolvedValue([scoredPoint(undefined)]) });
      const sessions = { findById: vi.fn() } as unknown as PdfProcessingSessionRepository;
      const service = new SemanticDedupService(vectorAdapter, {} as EmbeddingsPort, sessions);

      expect(await service.findSemanticMatch('tenant-1', [0.1])).toBeNull();
      expect(sessions.findById).not.toHaveBeenCalled();
    });

    it('skips a matched point whose session no longer exists (defensive) and returns null', async () => {
      const vectorAdapter = fakeVectorAdapter({ searchFingerprint: vi.fn().mockResolvedValue([scoredPoint('sess-gone')]) });
      const sessions = { findById: vi.fn().mockResolvedValue(null) } as unknown as PdfProcessingSessionRepository;
      const service = new SemanticDedupService(vectorAdapter, {} as EmbeddingsPort, sessions);

      expect(await service.findSemanticMatch('tenant-1', [0.1])).toBeNull();
    });

    it('skips a matched point whose session is not (yet) Completed (defensive) and returns null', async () => {
      const notYetDone = fakeSession({ id: 'sess-inflight', status: 'Processing' });
      const vectorAdapter = fakeVectorAdapter({ searchFingerprint: vi.fn().mockResolvedValue([scoredPoint('sess-inflight')]) });
      const sessions = { findById: vi.fn().mockResolvedValue(notYetDone) } as unknown as PdfProcessingSessionRepository;
      const service = new SemanticDedupService(vectorAdapter, {} as EmbeddingsPort, sessions);

      expect(await service.findSemanticMatch('tenant-1', [0.1])).toBeNull();
    });

    it('falls through to a second candidate point when the first resolves to nothing usable', async () => {
      const goodMatch = fakeSession({ id: 'sess-good', status: 'Completed' });
      const vectorAdapter = fakeVectorAdapter({
        searchFingerprint: vi.fn().mockResolvedValue([scoredPoint('sess-gone', 0.99), scoredPoint('sess-good', 0.98)]),
      });
      const sessions = {
        findById: vi.fn().mockImplementation(async (id: string) => (id === 'sess-good' ? goodMatch : null)),
      } as unknown as PdfProcessingSessionRepository;
      const service = new SemanticDedupService(vectorAdapter, {} as EmbeddingsPort, sessions);

      const result = await service.findSemanticMatch('tenant-1', [0.1]);

      expect(result).toBe(goodMatch);
    });
  });

  describe('upsertFingerprint', () => {
    it('upserts a point keyed by fileHash (not sessionId), with the sessionId/documentId/fileHash payload', async () => {
      const vectorAdapter = fakeVectorAdapter({ pointId: vi.fn().mockReturnValue('deterministic-point-id') });
      const service = new SemanticDedupService(vectorAdapter, {} as EmbeddingsPort, {} as PdfProcessingSessionRepository);
      const session = fakeSession({ id: 'sess-1', fileHash: 'hash-xyz', curriculumDocumentId: 'doc-1' });

      await service.upsertFingerprint('tenant-1', session, [0.4, 0.5]);

      expect(vectorAdapter.pointId).toHaveBeenCalledWith('tenant-1', 'hash-xyz');
      expect(vectorAdapter.upsertFingerprint).toHaveBeenCalledWith(
        { tenantId: 'tenant-1' },
        {
          id: 'deterministic-point-id',
          vector: [0.4, 0.5],
          payload: { fileHash: 'hash-xyz', sessionId: 'sess-1', documentId: 'doc-1' },
        },
      );
    });

    it('omits documentId from the payload when the session has none', async () => {
      const vectorAdapter = fakeVectorAdapter({ pointId: vi.fn().mockReturnValue('p1') });
      const service = new SemanticDedupService(vectorAdapter, {} as EmbeddingsPort, {} as PdfProcessingSessionRepository);
      const session = fakeSession({ id: 'sess-1', fileHash: 'hash-xyz', curriculumDocumentId: null });

      await service.upsertFingerprint('tenant-1', session, [0.4]);

      const call = (vectorAdapter.upsertFingerprint as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(call.payload.documentId).toBeUndefined();
    });
  });
});
