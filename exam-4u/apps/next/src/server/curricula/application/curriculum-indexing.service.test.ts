import { describe, expect, it, vi } from 'vitest';
import type { EmbeddingsPort } from '@/server/vector';
import type { QdrantVectorStoreAdapter } from '@/server/infrastructure/vector';
import type { CurriculaRepository } from '../infrastructure/curricula.repository';
import { CurriculumIndexingService, deriveNameFromFileName, sha256Hex } from './curriculum-indexing.service';
import { SubjectRequiredForIndexingError } from '../domain/errors';

function make(overrides: { findById?: ReturnType<typeof vi.fn> } = {}) {
  const insertDocument = vi.fn().mockImplementation(async (e: unknown) => e);
  const create = vi.fn().mockImplementation(async (e: unknown) => e);
  const findById = overrides.findById ?? vi.fn().mockResolvedValue(null);
  const upsertChunks = vi.fn().mockResolvedValue(undefined);
  const searchChunks = vi.fn().mockResolvedValue([]);
  const deleteChunks = vi.fn().mockResolvedValue(undefined);
  const embed = vi.fn().mockImplementation(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]));

  const service = new CurriculumIndexingService(
    { insertDocument, create, findById } as unknown as CurriculaRepository,
    {
      upsertChunks,
      searchChunks,
      deleteChunks,
      pointId: (tenantId: string, key: string) => `${tenantId}:${key}`,
    } as unknown as QdrantVectorStoreAdapter,
    { embed, model: 'test-embed-model' } as unknown as EmbeddingsPort,
  );
  return { service, insertDocument, create, findById, upsertChunks, searchChunks, deleteChunks, embed };
}

const BASE = { tenantId: 't-1', curriculumId: 'cur-1', fileName: 'notes.pdf', storageKey: 'k/notes.pdf', fileHash: 'h'.repeat(64) };

describe('CurriculumIndexingService.indexDocument (FR-CUR-2 / FR-PDF-6, the ONE shared pipeline)', () => {
  it('chunks, embeds, and upserts, recording the real chunk count on the document row', async () => {
    const { service, upsertChunks, insertDocument, embed } = make();
    const pages = [{ pageNumber: 1, text: 'Real prose. '.repeat(400) }];

    const doc = await service.indexDocument({ ...BASE, pages });

    expect(embed).toHaveBeenCalledTimes(1);
    expect(upsertChunks).toHaveBeenCalledTimes(1);
    expect(doc.chunkCount).toBeGreaterThan(1);
    expect(insertDocument).toHaveBeenCalledWith(doc);
  });

  it('writes the exact chunk-payload vocabulary RetrievalService already reads, tenant-scoped', async () => {
    const { service, upsertChunks } = make();
    await service.indexDocument({ ...BASE, pages: [{ pageNumber: 3, text: 'Some genuine page text.' }] });

    expect(upsertChunks.mock.calls[0][0]).toEqual({ tenantId: 't-1' });
    expect(upsertChunks.mock.calls[0][1][0].payload).toMatchObject({
      curriculumId: 'cur-1',
      pageNumber: 3,
      chunkIndex: 0,
      fileName: 'notes.pdf',
      text: 'Some genuine page text.',
      embeddingModel: 'test-embed-model',
    });
  });

  it('uses a deterministic {documentId}:{chunkIndex} point id so a re-index overwrites rather than duplicates', async () => {
    const { service, upsertChunks } = make();
    const doc = await service.indexDocument({ ...BASE, pages: [{ pageNumber: 1, text: 'text' }] });
    expect(upsertChunks.mock.calls[0][1][0].id).toBe(`t-1:${doc.id}:0`);
  });

  it('makes NO embedding call for an all-blank document, but still records the row (chunkCount 0)', async () => {
    const { service, embed, upsertChunks, insertDocument } = make();
    const doc = await service.indexDocument({ ...BASE, pages: [{ pageNumber: 1, text: '   ' }] });

    expect(embed).not.toHaveBeenCalled();
    expect(upsertChunks).not.toHaveBeenCalled();
    expect(doc.chunkCount).toBe(0);
    expect(insertDocument).toHaveBeenCalled();
  });

  it('records the caller-supplied pageCount when given, else the page-array length', async () => {
    const { service } = make();
    const pages = [{ pageNumber: 1, text: 'a' }];
    expect((await service.indexDocument({ ...BASE, pages, pageCount: 42 })).pageCount).toBe(42);
    expect((await service.indexDocument({ ...BASE, pages })).pageCount).toBe(1);
  });

  it('reuses the caller-provided storageKey verbatim (never re-storing the same bytes)', async () => {
    const { service } = make();
    const doc = await service.indexDocument({ ...BASE, pages: [{ pageNumber: 1, text: 'a' }] });
    expect(doc.storageKey).toBe('k/notes.pdf');
    expect(doc.contentType).toBe('Reference');
  });
});

describe('CurriculumIndexingService.resolveOrCreateCurriculum (FR-PDF-6)', () => {
  it('uses an explicitly-named, still-existing Curriculum as-is without creating anything', async () => {
    const { service, create } = make({ findById: vi.fn().mockResolvedValue({ id: 'cur-existing' }) });
    const result = await service.resolveOrCreateCurriculum({ curriculumId: 'cur-existing', subjectId: 1, ownerUserId: 'u-1', sourceFileName: 'x.pdf' });
    expect(result.id).toBe('cur-existing');
    expect(create).not.toHaveBeenCalled();
  });

  it('auto-creates one named from the source file when the named Curriculum no longer exists', async () => {
    const { service, create } = make({ findById: vi.fn().mockResolvedValue(null) });
    const result = await service.resolveOrCreateCurriculum({
      curriculumId: 'cur-gone',
      subjectId: 7,
      ownerUserId: 'u-1',
      sourceFileName: 'biology-chapter-3.pdf',
    });
    expect(create).toHaveBeenCalled();
    expect(result.name).toBe('biology-chapter-3');
    expect(result.subjectId).toBe(7);
    expect(result.ownerUserId).toBe('u-1');
  });

  it('throws SubjectRequiredForIndexingError rather than guessing a subject or dropping the material', async () => {
    const { service, create } = make();
    await expect(
      service.resolveOrCreateCurriculum({ curriculumId: null, subjectId: null, ownerUserId: 'u-1', sourceFileName: 'x.pdf' }),
    ).rejects.toThrow(SubjectRequiredForIndexingError);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('CurriculumIndexingService — search/cleanup helpers', () => {
  it('embedQuery embeds exactly the one query string, with the same model the ingest path used', async () => {
    const { service, embed } = make();
    await service.embedQuery('photosynthesis');
    expect(embed).toHaveBeenCalledWith(['photosynthesis']);
  });

  it('searchChunks always passes a mandatory tenant scope and the curriculum narrowing', async () => {
    const { service, searchChunks } = make();
    await service.searchChunks('t-1', [0.1], 'cur-1', 10);
    expect(searchChunks).toHaveBeenCalledWith({ tenantId: 't-1' }, [0.1], { curriculumId: 'cur-1' }, 10);
  });

  it('deleteChunksForCurriculum deletes only that Curriculum’s chunks, within the tenant scope', async () => {
    const { service, deleteChunks } = make();
    await service.deleteChunksForCurriculum('t-1', 'cur-1');
    expect(deleteChunks).toHaveBeenCalledWith({ tenantId: 't-1' }, { curriculumId: 'cur-1' });
  });
});

describe('curriculum-indexing pure helpers', () => {
  it('deriveNameFromFileName strips a .pdf extension case-insensitively, falling back to the raw name', () => {
    expect(deriveNameFromFileName('Biology.PDF')).toBe('Biology');
    expect(deriveNameFromFileName('no-extension')).toBe('no-extension');
    expect(deriveNameFromFileName('.pdf')).toBe('.pdf');
  });

  it('sha256Hex produces the stable 64-char hex hash the file_hash columns store', () => {
    const hash = sha256Hex(Buffer.from('abc'));
    expect(hash).toHaveLength(64);
    expect(hash).toBe(sha256Hex(Buffer.from('abc')));
    expect(hash).not.toBe(sha256Hex(Buffer.from('abd')));
  });
});
