import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runWithRequestContext } from '@/server/context';
import type { CurriculumIndexingService } from '@/server/curricula';
import { SubjectRequiredForIndexingError } from '@/server/curricula';
import { PdfProcessingSessionEntity } from '@/server/infrastructure/database';
import { ReferenceIndexingService } from './reference-indexing.service';

function fakeSession(overrides: Partial<PdfProcessingSessionEntity> = {}): PdfProcessingSessionEntity {
  return Object.assign(new PdfProcessingSessionEntity(), {
    id: 'sess-1',
    initiatedByUserId: 'user-1',
    sourceFileName: 'biology-chapter-3.pdf',
    contentType: 'Reference',
    status: 'Processing',
    sourceStorageKey: 'tenants/t-1/pdf/sess-1/source.pdf',
    fileHash: 'a'.repeat(64),
    curriculumId: null,
    curriculumDocumentId: null,
    subjectId: 7,
    pageCount: 3,
    ...overrides,
  });
}

function fakeIndexing(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  return {
    resolveOrCreateCurriculum: vi.fn().mockResolvedValue({ id: 'cur-1' }),
    indexDocument: vi.fn().mockResolvedValue({ id: 'doc-1' }),
    ...overrides,
  };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ requestId: randomUUID(), tenantId: 'tenant-1' }, fn);
}

const PAGES = [
  { pageNumber: 1, text: 'Cell biology reference material.' },
  { pageNumber: 2, text: 'Mitochondria are the powerhouse.' },
];

describe('ReferenceIndexingService (FR-PDF-6)', () => {
  it('indexes the document into the resolved Curriculum and writes both ids back onto the session', async () => {
    const indexing = fakeIndexing();
    const service = new ReferenceIndexingService(indexing as unknown as CurriculumIndexingService);
    const session = fakeSession();

    await withTenant(() => service.index(session, PAGES));

    expect(session.curriculumId).toBe('cur-1');
    expect(session.curriculumDocumentId).toBe('doc-1');
  });

  it('REUSES the session’s already-written source object rather than storing the same PDF twice', async () => {
    const indexing = fakeIndexing();
    const service = new ReferenceIndexingService(indexing as unknown as CurriculumIndexingService);
    const session = fakeSession();

    await withTenant(() => service.index(session, PAGES));

    expect(indexing.indexDocument).toHaveBeenCalledWith(
      expect.objectContaining({ storageKey: 'tenants/t-1/pdf/sess-1/source.pdf', fileHash: 'a'.repeat(64), tenantId: 'tenant-1' }),
    );
  });

  it('passes the session’s own recorded pageCount through rather than re-deriving it from the page array', async () => {
    const indexing = fakeIndexing();
    const service = new ReferenceIndexingService(indexing as unknown as CurriculumIndexingService);

    await withTenant(() => service.index(fakeSession({ pageCount: 42 }), PAGES));

    expect(indexing.indexDocument).toHaveBeenCalledWith(expect.objectContaining({ pageCount: 42 }));
  });

  it('forwards the explicit curriculumId/subjectId/owner for resolution, naming the auto-create from the source file', async () => {
    const indexing = fakeIndexing();
    const service = new ReferenceIndexingService(indexing as unknown as CurriculumIndexingService);

    await withTenant(() => service.index(fakeSession({ curriculumId: 'cur-explicit' }), PAGES));

    expect(indexing.resolveOrCreateCurriculum).toHaveBeenCalledWith({
      curriculumId: 'cur-explicit',
      subjectId: 7,
      ownerUserId: 'user-1',
      sourceFileName: 'biology-chapter-3.pdf',
    });
  });

  it('falls back to a deterministic owner placeholder for the (defensive) null-uploader row rather than crashing', async () => {
    const indexing = fakeIndexing();
    const service = new ReferenceIndexingService(indexing as unknown as CurriculumIndexingService);

    await withTenant(() => service.index(fakeSession({ initiatedByUserId: null }), PAGES));

    const owner = indexing.resolveOrCreateCurriculum.mock.calls[0][0].ownerUserId;
    expect(typeof owner).toBe('string');
    expect(owner).toHaveLength(36);
  });

  it('propagates SubjectRequiredForIndexingError loudly (never silently dropping reference material)', async () => {
    const indexing = fakeIndexing({ resolveOrCreateCurriculum: vi.fn().mockRejectedValue(new SubjectRequiredForIndexingError()) });
    const service = new ReferenceIndexingService(indexing as unknown as CurriculumIndexingService);

    await expect(withTenant(() => service.index(fakeSession({ subjectId: null }), PAGES))).rejects.toThrow(SubjectRequiredForIndexingError);
    expect(indexing.indexDocument).not.toHaveBeenCalled();
  });
});
