import type { TenantRepositoryPort } from '../../tenants';
import type { KnowledgeSourceRepositoryPort } from '../domain/ports';
import type { KnowledgeSourceRecord } from '../domain/knowledge-source';
import { EstimateReindexUseCase } from './estimate-reindex.use-case';

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
    fileSizeBytes: 20,
    rawContent: Buffer.from('0123456789'.repeat(2)), // 20 chars
    parser: 'plain_text',
    chunkingStrategy: 'fixed',
    chunkSize: 10,
    chunkOverlap: 0,
    embeddingModel: 'text-embedding-3-small',
    embeddingCredentialRef: null,
    status: 'ready',
    chunkCount: 0,
    errorMessage: null,
    configUpdatedAt: new Date(),
    lastIndexedAt: null,
    createdBy: 'admin-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('EstimateReindexUseCase', () => {
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let sources: jest.Mocked<KnowledgeSourceRepositoryPort>;
  let useCase: EstimateReindexUseCase;
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
    useCase = new EstimateReindexUseCase(tenants, sources);
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
  });

  it('computes chunk_count by really re-running parse+chunk against the current config, and a rounded cost/duration estimate', async () => {
    sources.findById.mockResolvedValue(makeSourceRecord());
    const result = await useCase.execute(actor, 'tenant-1', 'source-1');
    // 20 chars, chunkSize 10, overlap 0 -> 2 chunks.
    expect(result).toEqual({
      chunk_count: 2,
      estimated_cost_usd: 0.000008,
      estimated_duration_ms: 100,
      is_estimate: true,
    });
  });

  it('reflects the current (possibly-unindexed) config, not the stored chunk_count', async () => {
    sources.findById.mockResolvedValue(makeSourceRecord({ chunkCount: 999 }));
    const result = await useCase.execute(actor, 'tenant-1', 'source-1');
    expect(result.chunk_count).toBe(2);
  });

  it('never calls the repository update or embedding client — read-only, no side effects', async () => {
    sources.findById.mockResolvedValue(makeSourceRecord());
    await useCase.execute(actor, 'tenant-1', 'source-1');
    expect(sources.update).not.toHaveBeenCalled();
  });
});
