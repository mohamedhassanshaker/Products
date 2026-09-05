import type { TenantRepositoryPort } from '../../tenants';
import type { KnowledgeSourceRepositoryPort } from '../domain/ports';
import type { KnowledgeSourceRecord } from '../domain/knowledge-source';
import { ListKnowledgeSourcesUseCase } from './list-knowledge-sources.use-case';

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
    configUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
    lastIndexedAt: new Date('2026-01-02T00:00:00.000Z'),
    createdBy: 'admin-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ListKnowledgeSourcesUseCase', () => {
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let sources: jest.Mocked<KnowledgeSourceRepositoryPort>;
  let useCase: ListKnowledgeSourcesUseCase;
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
    useCase = new ListKnowledgeSourcesUseCase(tenants, sources);
  });

  it('404s an unknown tenant', async () => {
    tenants.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1')).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('403s an admin not assigned to the tenant', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    const unassigned = { ...actor, roles: ['admin'], tenantIds: ['other-tenant'] };
    await expect(useCase.execute(unassigned, 'tenant-1')).rejects.toMatchObject({ code: 'TENANT_FORBIDDEN' });
  });

  it('lists every source mapped to its DTO, including is_stale', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    sources.findMany.mockResolvedValue([
      makeSourceRecord(),
      makeSourceRecord({ id: 'source-2', configUpdatedAt: new Date('2026-02-01T00:00:00.000Z') }),
    ]);

    const result = await useCase.execute(actor, 'tenant-1');

    expect(sources.findMany).toHaveBeenCalledWith('tenant-1');
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ id: 'source-1', is_stale: false });
    expect(result.items[1]).toMatchObject({ id: 'source-2', is_stale: true });
  });
});
