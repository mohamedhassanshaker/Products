import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionResolutionService } from '@/server/rbac';
import type { StoragePort } from '@/server/common/ports/storage.port';
import type { CurriculaRepository } from '../infrastructure/curricula.repository';
import type { CurriculumIndexingService } from './curriculum-indexing.service';
import { CurriculumDocumentsService } from './curriculum-documents.service';
import { CurriculumNotFoundError, NoExtractableTextError, NotCurriculumOwnerError } from '../domain/errors';

const extractPdfPages = vi.hoisted(() => vi.fn());
vi.mock('@/server/infrastructure/text-extraction', () => ({ extractPdfPages }));

const OWNER = 'user-1';
const OTHER = 'user-2';
const TENANT = 't-1';
/** A minimal buffer whose leading bytes are a genuine `%PDF-` signature. */
const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('body')]);

function make(opts: { curriculum?: unknown; indexDocument?: ReturnType<typeof vi.fn> } = {}) {
  const repository = {
    // `'curriculum' in opts` (not `??`) so an explicit `null` really means "no such Curriculum".
    findById: vi.fn().mockResolvedValue('curriculum' in opts ? opts.curriculum : { id: 'cur-1', ownerUserId: OWNER }),
    findDocuments: vi.fn().mockResolvedValue([]),
  };
  const storage = { put: vi.fn().mockResolvedValue({ key: 'k', size: 1 }), delete: vi.fn().mockResolvedValue(undefined) };
  const indexing = {
    indexDocument:
      opts.indexDocument ??
      vi.fn().mockResolvedValue({
        id: 'doc-1',
        fileName: 'notes.pdf',
        title: null,
        contentType: 'Reference',
        pageCount: 2,
        chunkCount: 5,
        uploadedAt: new Date(),
      }),
    embedQuery: vi.fn().mockResolvedValue([[0.1]]),
    searchChunks: vi.fn().mockResolvedValue([]),
  };
  const permissions = { hasPermission: vi.fn().mockResolvedValue(false) };
  const service = new CurriculumDocumentsService(
    repository as unknown as CurriculaRepository,
    storage as unknown as StoragePort,
    indexing as unknown as CurriculumIndexingService,
    permissions as unknown as PermissionResolutionService,
  );
  return { service, repository, storage, indexing, permissions };
}

beforeEach(() => {
  extractPdfPages.mockReset();
  extractPdfPages.mockResolvedValue([
    { pageNumber: 1, text: 'Genuine document text.' },
    { pageNumber: 2, text: 'More genuine text.' },
  ]);
});

describe('CurriculumDocumentsService.uploadDocument (FR-CUR-2 — Phase 3 deferral, closed in 6b)', () => {
  it('ingests a real PDF and returns the honest chunk count proving it was genuinely indexed', async () => {
    const { service, storage, indexing } = make();
    const doc = await service.uploadDocument(OWNER, TENANT, 'cur-1', { originalName: 'notes.pdf', buffer: PDF_BYTES });

    expect(doc.chunkCount).toBe(5);
    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(indexing.indexDocument).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT, curriculumId: 'cur-1', fileName: 'notes.pdf' }));
  });

  it('builds a storage key entirely from server-derived values — the client file name is never a path segment', async () => {
    const { service, storage } = make();
    await service.uploadDocument(OWNER, TENANT, 'cur-1', { originalName: '../../../etc/passwd.pdf', buffer: PDF_BYTES });

    const key: string = storage.put.mock.calls[0][0];
    expect(key.startsWith(`tenants/${TENANT}/curricula/cur-1/documents/`)).toBe(true);
    expect(key).not.toContain('..');
    expect(key).not.toContain('passwd');
  });

  it('rejects an empty or non-PDF upload BEFORE any storage write or embedding call (cost control)', async () => {
    const { service, storage } = make();
    await expect(service.uploadDocument(OWNER, TENANT, 'cur-1', { originalName: 'x.pdf', buffer: Buffer.alloc(0) })).rejects.toThrow(
      NoExtractableTextError,
    );
    await expect(service.uploadDocument(OWNER, TENANT, 'cur-1', { originalName: 'x.pdf', buffer: Buffer.from('not a pdf') })).rejects.toThrow(
      NoExtractableTextError,
    );
    expect(storage.put).not.toHaveBeenCalled();
    expect(extractPdfPages).not.toHaveBeenCalled();
  });

  it('rejects a corrupt PDF as NO_EXTRACTABLE_TEXT without leaking the parser error (NFR-5), storing nothing', async () => {
    extractPdfPages.mockRejectedValue(new Error('InvalidPDFException: xref table missing at offset 0'));
    const { service, storage } = make();
    await expect(service.uploadDocument(OWNER, TENANT, 'cur-1', { originalName: 'x.pdf', buffer: PDF_BYTES })).rejects.toThrow(
      NoExtractableTextError,
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('rejects a text-free (scanned) PDF before spending any embedding budget', async () => {
    extractPdfPages.mockResolvedValue([{ pageNumber: 1, text: '   ' }]);
    const { service, storage, indexing } = make();
    await expect(service.uploadDocument(OWNER, TENANT, 'cur-1', { originalName: 'x.pdf', buffer: PDF_BYTES })).rejects.toThrow(
      NoExtractableTextError,
    );
    expect(storage.put).not.toHaveBeenCalled();
    expect(indexing.indexDocument).not.toHaveBeenCalled();
  });

  it('rolls the storage write back when indexing fails, leaving zero artifacts behind', async () => {
    const { service, storage } = make({ indexDocument: vi.fn().mockImplementation(async () => {
      throw new Error('qdrant down');
    }) });
    await expect(service.uploadDocument(OWNER, TENANT, 'cur-1', { originalName: 'x.pdf', buffer: PDF_BYTES })).rejects.toThrow('qdrant down');
    expect(storage.delete).toHaveBeenCalledWith(storage.put.mock.calls[0][0]);
  });

  it('404s an unknown Curriculum and 403s a non-owner without oversight, never touching storage', async () => {
    const missing = make({ curriculum: null });
    await expect(missing.service.uploadDocument(OWNER, TENANT, 'nope', { originalName: 'x.pdf', buffer: PDF_BYTES })).rejects.toThrow(
      CurriculumNotFoundError,
    );

    const notOwner = make();
    await expect(notOwner.service.uploadDocument(OTHER, TENANT, 'cur-1', { originalName: 'x.pdf', buffer: PDF_BYTES })).rejects.toThrow(
      NotCurriculumOwnerError,
    );
    expect(notOwner.storage.put).not.toHaveBeenCalled();
  });

  it('allows a non-owner holding curricula.read_all (the oversight bypass)', async () => {
    const { service, permissions } = make();
    permissions.hasPermission.mockResolvedValue(true);
    await expect(service.uploadDocument(OTHER, TENANT, 'cur-1', { originalName: 'x.pdf', buffer: PDF_BYTES })).resolves.toBeDefined();
  });
});

describe('CurriculumDocumentsService.search (FR-CUR-3)', () => {
  it('returns [] for an empty/whitespace query WITHOUT making an embedding call', async () => {
    const { service, indexing } = make();
    await expect(service.search(OWNER, TENANT, 'cur-1', { query: '   ' })).resolves.toEqual([]);
    await expect(service.search(OWNER, TENANT, 'cur-1', {})).resolves.toEqual([]);
    expect(indexing.embedQuery).not.toHaveBeenCalled();
  });

  it('maps each hit to its originating document and page', async () => {
    const { service, indexing } = make();
    indexing.searchChunks.mockResolvedValue([
      { id: 'p1', score: 0.87, payload: { documentId: 'doc-1', fileName: 'notes.pdf', pageNumber: 4, text: 'Mitochondria …' } },
    ]);
    await expect(service.search(OWNER, TENANT, 'cur-1', { query: 'mitochondria', limit: 5 })).resolves.toEqual([
      { documentId: 'doc-1', fileName: 'notes.pdf', pageNumber: 4, text: 'Mitochondria …', score: 0.87 },
    ]);
    expect(indexing.searchChunks).toHaveBeenCalledWith(TENANT, [0.1], 'cur-1', 5);
  });

  it('reads an untyped payload defensively rather than trusting the vector store', async () => {
    const { service, indexing } = make();
    indexing.searchChunks.mockResolvedValue([{ id: 'p1', score: 0.5, payload: {} }]);
    await expect(service.search(OWNER, TENANT, 'cur-1', { query: 'x' })).resolves.toEqual([
      { documentId: '', fileName: '', pageNumber: 0, text: '', score: 0.5 },
    ]);
  });

  it('enforces ownership before searching (403, not an empty list)', async () => {
    const { service } = make();
    await expect(service.search(OTHER, TENANT, 'cur-1', { query: 'x' })).rejects.toThrow(NotCurriculumOwnerError);
  });
});

describe('CurriculumDocumentsService.listDocuments', () => {
  it('lists a Curriculum’s documents for its owner', async () => {
    const { service, repository } = make();
    repository.findDocuments.mockResolvedValue([
      { id: 'doc-1', fileName: 'a.pdf', title: null, contentType: 'Reference', pageCount: 1, chunkCount: 2, uploadedAt: new Date() },
    ]);
    await expect(service.listDocuments(OWNER, 'cur-1')).resolves.toHaveLength(1);
  });

  it('rejects a non-owner without oversight', async () => {
    const { service } = make();
    await expect(service.listDocuments(OTHER, 'cur-1')).rejects.toThrow(NotCurriculumOwnerError);
  });
});
