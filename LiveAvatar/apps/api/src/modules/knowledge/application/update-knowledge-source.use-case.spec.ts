import type { TenantRepositoryPort } from '../../tenants';
import type { KnowledgeSourceRepositoryPort } from '../domain/ports';
import type { KnowledgeSourceRecord } from '../domain/knowledge-source';
import { UpdateKnowledgeSourceUseCase } from './update-knowledge-source.use-case';

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

describe('UpdateKnowledgeSourceUseCase', () => {
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let sources: jest.Mocked<KnowledgeSourceRepositoryPort>;
  let useCase: UpdateKnowledgeSourceUseCase;
  const actor = { id: 'admin-1', email: 'a@b.com', roles: ['operator'], tenantIds: [] };
  const ifMatch = '2026-01-02T00:00:00.000Z';

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
    useCase = new UpdateKnowledgeSourceUseCase(tenants, sources);
    tenants.findById.mockResolvedValue(makeTenant());
    sources.findById.mockResolvedValue(makeSourceRecord());
  });

  it('404s an unknown tenant', async () => {
    tenants.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', 'source-1', { name: 'x' }, ifMatch)).rejects.toMatchObject({
      code: 'TENANT_NOT_FOUND',
    });
  });

  it('403s an admin not assigned to the tenant', async () => {
    const unassigned = { ...actor, roles: ['admin'], tenantIds: ['other-tenant'] };
    await expect(useCase.execute(unassigned, 'tenant-1', 'source-1', { name: 'x' }, ifMatch)).rejects.toMatchObject({
      code: 'TENANT_FORBIDDEN',
    });
  });

  it('404s an unknown source id', async () => {
    sources.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', 'nope', { name: 'x' }, ifMatch)).rejects.toMatchObject({
      code: 'KNOWLEDGE_SOURCE_NOT_FOUND',
    });
  });

  it('rejects an invalid If-Match value with CONFIG_CONFLICT', async () => {
    await expect(
      useCase.execute(actor, 'tenant-1', 'source-1', { name: 'x' }, 'not-a-date'),
    ).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' });
  });

  it('maps a repository "missing" to KNOWLEDGE_SOURCE_NOT_FOUND', async () => {
    sources.update.mockResolvedValue('missing');
    await expect(useCase.execute(actor, 'tenant-1', 'source-1', { name: 'x' }, ifMatch)).rejects.toMatchObject({
      code: 'KNOWLEDGE_SOURCE_NOT_FOUND',
    });
  });

  it('maps a repository "conflict" to CONFIG_CONFLICT', async () => {
    sources.update.mockResolvedValue('conflict');
    await expect(useCase.execute(actor, 'tenant-1', 'source-1', { name: 'x' }, ifMatch)).rejects.toMatchObject({
      code: 'CONFIG_CONFLICT',
    });
  });

  it('renaming alone does not bump configUpdatedAt', async () => {
    sources.update.mockResolvedValue(makeSourceRecord({ name: 'Renamed' }));
    await useCase.execute(actor, 'tenant-1', 'source-1', { name: 'Renamed' }, ifMatch);
    expect(sources.update).toHaveBeenCalledWith(
      'tenant-1',
      'source-1',
      new Date(ifMatch),
      { name: 'Renamed' },
    );
  });

  it.each([
    ['parser', { parser: 'markdown' as const }],
    ['chunking_strategy', { chunking_strategy: 'fixed' as const }],
    ['chunk_size', { chunk_size: 1000 }],
    ['chunk_overlap', { chunk_overlap: 50 }],
    ['embedding_model', { embedding_model: 'text-embedding-3-small' }],
    ['embedding_credential_ref', { embedding_credential_ref: 'secrets/openai' }],
  ])('editing %s bumps configUpdatedAt (the V-9 staleness signal)', async (_label, patchInput) => {
    sources.update.mockResolvedValue(makeSourceRecord());
    await useCase.execute(actor, 'tenant-1', 'source-1', patchInput, ifMatch);
    const [, , , patch] = sources.update.mock.calls[0];
    expect(patch.configUpdatedAt).toBeInstanceOf(Date);
  });

  it('rejects an unsupported parser', async () => {
    await expect(
      useCase.execute(actor, 'tenant-1', 'source-1', { parser: 'pdf' }, ifMatch),
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_PARSER_NOT_SUPPORTED' });
  });

  it('rejects a resulting chunk_overlap >= chunk_size using the existing chunk_size when only overlap is patched', async () => {
    sources.findById.mockResolvedValue(makeSourceRecord({ chunkSize: 800, chunkOverlap: 100 }));
    await expect(
      useCase.execute(actor, 'tenant-1', 'source-1', { chunk_overlap: 800 }, ifMatch),
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_SOURCE_CHUNK_OVERLAP_INVALID' });
  });

  it('does not enqueue a reindex (R-R2 — a config edit alone never auto-starts ingestion)', async () => {
    sources.update.mockResolvedValue(makeSourceRecord({ parser: 'markdown' }));
    const result = await useCase.execute(actor, 'tenant-1', 'source-1', { parser: 'markdown' }, ifMatch);
    expect(result).toMatchObject({ id: 'source-1' });
    // No queue port is even injected into this use-case — the absence of
    // any enqueue call is structural, not just unasserted.
  });
});
