import type { TenantRepositoryPort } from '../../tenants';
import type { KnowledgeIngestQueuePort, KnowledgeSourceRepositoryPort } from '../domain/ports';
import type { KnowledgeSourceRecord } from '../domain/knowledge-source';
import type { UploadedFile } from '../domain/validation';
import { CreateKnowledgeSourceUseCase } from './create-knowledge-source.use-case';

function makeTenant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tenant-1',
    name: 'Acme',
    slug: 'acme',
    status: 'active' as const,
    roomNamespace: 'acme',
    createdAt: new Date(),
    updatedAt: new Date(),
    providerStackSummary: 'Not configured',
    ...overrides,
  };
}

function makeSourceRecord(overrides: Partial<KnowledgeSourceRecord> = {}): KnowledgeSourceRecord {
  return {
    id: 'source-1',
    tenantId: 'tenant-1',
    name: 'Docs',
    sourceType: 'upload',
    originalFilename: 'docs.txt',
    mimeType: 'text/plain',
    fileSizeBytes: 5,
    rawContent: Buffer.from('hello'),
    parser: 'plain_text',
    chunkingStrategy: 'fixed',
    chunkSize: 800,
    chunkOverlap: 100,
    embeddingModel: 'text-embedding-3-small',
    embeddingCredentialRef: null,
    status: 'pending',
    chunkCount: 0,
    errorMessage: null,
    configUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
    lastIndexedAt: null,
    createdBy: 'admin-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeFile(overrides: Partial<UploadedFile> = {}): UploadedFile {
  return { buffer: Buffer.from('hello'), originalname: 'docs.txt', mimetype: 'text/plain', size: 5, ...overrides };
}

describe('CreateKnowledgeSourceUseCase', () => {
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let sources: jest.Mocked<KnowledgeSourceRepositoryPort>;
  let queue: jest.Mocked<KnowledgeIngestQueuePort>;
  let useCase: CreateKnowledgeSourceUseCase;
  const actor = { id: 'admin-1', email: 'a@b.com', roles: ['operator'], tenantIds: [] };
  const fields = { name: 'Docs' };

  beforeEach(() => {
    tenants = {
      create: jest.fn(),
      findById: jest.fn(),
      findBySlug: jest.fn(),
      count: jest.fn(),
      list: jest.fn(),
      updateName: jest.fn(),
      updateStatus: jest.fn(),
    };
    sources = {
      create: jest.fn(),
      findById: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    queue = { enqueue: jest.fn() };
    useCase = new CreateKnowledgeSourceUseCase(tenants, sources, queue);
  });

  it('404s an unknown tenant', async () => {
    tenants.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', fields, makeFile())).rejects.toMatchObject({
      code: 'TENANT_NOT_FOUND',
    });
  });

  it('403s an admin not assigned to the tenant', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    const unassigned = { ...actor, roles: ['admin'], tenantIds: ['other-tenant'] };
    await expect(useCase.execute(unassigned, 'tenant-1', fields, makeFile())).rejects.toMatchObject({
      code: 'TENANT_FORBIDDEN',
    });
  });

  it('rejects a missing file', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    await expect(useCase.execute(actor, 'tenant-1', fields, undefined)).rejects.toMatchObject({
      code: 'KNOWLEDGE_SOURCE_FILE_MISSING',
    });
    expect(sources.create).not.toHaveBeenCalled();
  });

  it('rejects an unsupported file type', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    await expect(
      useCase.execute(actor, 'tenant-1', fields, makeFile({ originalname: 'x.exe', mimetype: 'application/octet-stream' })),
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_SOURCE_FILE_TYPE_UNSUPPORTED' });
  });

  it('rejects an empty name', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    await expect(useCase.execute(actor, 'tenant-1', { name: '  ' }, makeFile())).rejects.toMatchObject({
      code: 'KNOWLEDGE_SOURCE_NAME_REQUIRED',
    });
  });

  it('rejects pdf even though it is a real enum value (defense in depth)', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    await expect(
      useCase.execute(actor, 'tenant-1', { name: 'Docs', parser: 'pdf' }, makeFile()),
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_PARSER_NOT_SUPPORTED' });
  });

  it('rejects an invalid chunk_overlap/chunk_size combination', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    await expect(
      useCase.execute(actor, 'tenant-1', { name: 'Docs', chunk_size: 100, chunk_overlap: 100 }, makeFile()),
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_SOURCE_CHUNK_OVERLAP_INVALID' });
  });

  it('applies documented defaults, creates the source, and enqueues ingestion', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    sources.create.mockResolvedValue(makeSourceRecord());

    const result = await useCase.execute(actor, 'tenant-1', fields, makeFile());

    expect(sources.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        name: 'Docs',
        originalFilename: 'docs.txt',
        mimeType: 'text/plain',
        fileSizeBytes: 5,
        parser: 'plain_text',
        chunkingStrategy: 'fixed',
        chunkSize: 800,
        chunkOverlap: 100,
        embeddingModel: 'text-embedding-3-small',
        embeddingCredentialRef: null,
        status: 'pending',
        chunkCount: 0,
        createdBy: 'admin-1',
      }),
    );
    expect(queue.enqueue).toHaveBeenCalledWith({ tenantId: 'tenant-1', sourceId: 'source-1' });
    expect(result).toMatchObject({ id: 'source-1', name: 'Docs', is_stale: false });
  });

  it('does not enqueue ingestion when validation fails before create', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    await expect(useCase.execute(actor, 'tenant-1', { name: '' }, makeFile())).rejects.toThrow();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
