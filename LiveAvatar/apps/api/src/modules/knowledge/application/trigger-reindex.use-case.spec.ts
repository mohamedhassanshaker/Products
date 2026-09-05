import type { TenantRepositoryPort } from '../../tenants';
import type { KnowledgeIngestQueuePort, KnowledgeSourceRepositoryPort } from '../domain/ports';
import type { KnowledgeSourceRecord } from '../domain/knowledge-source';
import { TriggerReindexUseCase } from './trigger-reindex.use-case';

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
    status: 'ready',
    chunkCount: 3,
    errorMessage: null,
    configUpdatedAt: new Date(),
    lastIndexedAt: new Date(),
    createdBy: 'admin-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('TriggerReindexUseCase', () => {
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let sources: jest.Mocked<KnowledgeSourceRepositoryPort>;
  let queue: jest.Mocked<KnowledgeIngestQueuePort>;
  let useCase: TriggerReindexUseCase;
  const actor = { id: 'admin-1', email: 'a@b.com', roles: ['operator'], tenantIds: [] };

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
    sources = { create: jest.fn(), findById: jest.fn(), findMany: jest.fn(), update: jest.fn(), delete: jest.fn() };
    queue = { enqueue: jest.fn() };
    useCase = new TriggerReindexUseCase(tenants, sources, queue);
    tenants.findById.mockResolvedValue(makeTenant());
  });

  it('404s an unknown tenant', async () => {
    tenants.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', 'source-1')).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('403s an admin not assigned to the tenant', async () => {
    const unassigned = { ...actor, roles: ['admin'], tenantIds: ['other-tenant'] };
    sources.findById.mockResolvedValue(makeSourceRecord());
    await expect(useCase.execute(unassigned, 'tenant-1', 'source-1')).rejects.toMatchObject({
      code: 'TENANT_FORBIDDEN',
    });
  });

  it('404s an unknown source id', async () => {
    sources.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', 'nope')).rejects.toMatchObject({
      code: 'KNOWLEDGE_SOURCE_NOT_FOUND',
    });
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('enqueues the ingest job and returns enqueued:true', async () => {
    sources.findById.mockResolvedValue(makeSourceRecord());
    const result = await useCase.execute(actor, 'tenant-1', 'source-1');
    expect(queue.enqueue).toHaveBeenCalledWith({ tenantId: 'tenant-1', sourceId: 'source-1' });
    expect(result).toEqual({ enqueued: true });
  });
});
