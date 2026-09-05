import type {
  EmbeddingClientPort,
  KnowledgeChunkRecord,
  KnowledgeChunkRepositoryPort,
  KnowledgeSourceRepositoryPort,
  UpdateKnowledgeSourceInput,
} from '../domain/ports';
import type { KnowledgeSourceRecord } from '../domain/knowledge-source';
import { RunKnowledgeIngestionUseCase } from './run-knowledge-ingestion.use-case';

function makeSourceRecord(overrides: Partial<KnowledgeSourceRecord> = {}): KnowledgeSourceRecord {
  return {
    id: 'source-1',
    tenantId: 'tenant-1',
    name: 'Docs',
    sourceType: 'upload',
    originalFilename: 'docs.txt',
    mimeType: 'text/plain',
    fileSizeBytes: 20,
    rawContent: Buffer.from('0123456789'.repeat(2)), // 20 chars -> 2 chunks @ size 10/overlap 0
    parser: 'plain_text',
    chunkingStrategy: 'fixed',
    chunkSize: 10,
    chunkOverlap: 0,
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

describe('RunKnowledgeIngestionUseCase', () => {
  let sources: jest.Mocked<KnowledgeSourceRepositoryPort>;
  let chunks: jest.Mocked<KnowledgeChunkRepositoryPort>;
  let embeddingClient: jest.Mocked<EmbeddingClientPort>;
  let useCase: RunKnowledgeIngestionUseCase;

  /** In-memory "current row" so chained updates return a fresh updatedAt, like the real repository does. */
  function wireSourcesAsStatefulFake(initial: KnowledgeSourceRecord) {
    let current = initial;
    sources.findById.mockImplementation(async () => current);
    sources.update.mockImplementation(async (_tenantId, _id, ifMatch, patch: UpdateKnowledgeSourceInput) => {
      if (ifMatch.getTime() !== current.updatedAt.getTime()) {
        return 'conflict' as const;
      }
      current = { ...current, ...patch, updatedAt: new Date(current.updatedAt.getTime() + 1) };
      return current;
    });
    return () => current;
  }

  beforeEach(() => {
    sources = { create: jest.fn(), findById: jest.fn(), findMany: jest.fn(), update: jest.fn(), delete: jest.fn() };
    chunks = { replaceForSource: jest.fn(), writeEmbeddings: jest.fn(), hybridSearch: jest.fn() };
    embeddingClient = { embed: jest.fn() };
    useCase = new RunKnowledgeIngestionUseCase(sources, chunks, embeddingClient);
  });

  it('logs and returns without throwing when the source was deleted mid-flight', async () => {
    sources.findById.mockResolvedValue(null);
    await expect(useCase.execute('tenant-1', 'source-1')).resolves.toBeUndefined();
    expect(sources.update).not.toHaveBeenCalled();
    expect(chunks.replaceForSource).not.toHaveBeenCalled();
  });

  it('happy path: parses, chunks, persists, embeds in order, writes embeddings, and marks ready', async () => {
    const getCurrent = wireSourcesAsStatefulFake(makeSourceRecord());
    const persisted: KnowledgeChunkRecord[] = [
      { id: 'chunk-a', chunkIndex: 0, text: '0123456789', tokenCount: 3 },
      { id: 'chunk-b', chunkIndex: 1, text: '0123456789', tokenCount: 3 },
    ];
    chunks.replaceForSource.mockResolvedValue(persisted);
    embeddingClient.embed.mockResolvedValue({ dimension: 3, embeddings: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]] });

    await useCase.execute('tenant-1', 'source-1');

    // Status flips to processing first.
    expect(sources.update).toHaveBeenNthCalledWith(1, 'tenant-1', 'source-1', expect.any(Date), {
      status: 'processing',
      errorMessage: null,
    });

    // Chunks persisted with the char/4 token heuristic.
    expect(chunks.replaceForSource).toHaveBeenCalledWith('tenant-1', 'source-1', [
      { chunkIndex: 0, text: '0123456789', tokenCount: 3 },
      { chunkIndex: 1, text: '0123456789', tokenCount: 3 },
    ]);

    // Embedding called once (2 chunks, well under the 96 batch size) with the source's model/credential ref.
    expect(embeddingClient.embed).toHaveBeenCalledTimes(1);
    expect(embeddingClient.embed).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'text-embedding-3-small',
      credentialRef: null,
      inputs: ['0123456789', '0123456789'],
    });

    // Embeddings written keyed by the persisted chunk ids, in order.
    expect(chunks.writeEmbeddings).toHaveBeenCalledWith('tenant-1', 'source-1', [
      { chunkId: 'chunk-a', embedding: [0.1, 0.2, 0.3] },
      { chunkId: 'chunk-b', embedding: [0.4, 0.5, 0.6] },
    ]);

    expect(getCurrent().status).toBe('ready');
    expect(getCurrent().lastIndexedAt).toBeInstanceOf(Date);
    expect(getCurrent().chunkCount).toBe(2);
  });

  it('embeds in batches of at most 96 inputs per call', async () => {
    wireSourcesAsStatefulFake(makeSourceRecord({ chunkSize: 1, chunkOverlap: 0, rawContent: Buffer.from('a'.repeat(150)) }));
    const persisted: KnowledgeChunkRecord[] = Array.from({ length: 150 }, (_, i) => ({
      id: `chunk-${i}`,
      chunkIndex: i,
      text: 'a',
      tokenCount: 1,
    }));
    chunks.replaceForSource.mockResolvedValue(persisted);
    embeddingClient.embed.mockImplementation(async ({ inputs }) => ({
      dimension: 1,
      embeddings: inputs.map(() => [1]),
    }));

    await useCase.execute('tenant-1', 'source-1');

    expect(embeddingClient.embed).toHaveBeenCalledTimes(2);
    expect(embeddingClient.embed.mock.calls[0][0].inputs).toHaveLength(96);
    expect(embeddingClient.embed.mock.calls[1][0].inputs).toHaveLength(54);
  });

  it('zero-chunk source: marks failed with the specific message, attempts no embedding call, and does not throw', async () => {
    const getCurrent = wireSourcesAsStatefulFake(makeSourceRecord({ rawContent: Buffer.from('') }));

    await expect(useCase.execute('tenant-1', 'source-1')).resolves.toBeUndefined();

    expect(chunks.replaceForSource).not.toHaveBeenCalled();
    expect(embeddingClient.embed).not.toHaveBeenCalled();
    expect(getCurrent().status).toBe('failed');
    expect(getCurrent().errorMessage).toBe('Source produced no content to index.');
  });

  it('embedding client throwing: marks failed with a safe error message and rethrows for BullMQ retry', async () => {
    const getCurrent = wireSourcesAsStatefulFake(makeSourceRecord());
    chunks.replaceForSource.mockResolvedValue([
      { id: 'chunk-a', chunkIndex: 0, text: '0123456789', tokenCount: 3 },
      { id: 'chunk-b', chunkIndex: 1, text: '0123456789', tokenCount: 3 },
    ]);
    embeddingClient.embed.mockRejectedValue(new Error('vendor call failed'));

    await expect(useCase.execute('tenant-1', 'source-1')).rejects.toThrow('vendor call failed');

    expect(getCurrent().status).toBe('failed');
    expect(getCurrent().errorMessage).toBe('vendor call failed');
    expect(chunks.writeEmbeddings).not.toHaveBeenCalled();
  });

  it('unsupported parser defensive backstop: marks failed (not a crash that skips marking the source failed) and rethrows', async () => {
    const getCurrent = wireSourcesAsStatefulFake(makeSourceRecord({ parser: 'pdf' }));

    await expect(useCase.execute('tenant-1', 'source-1')).rejects.toThrow();

    expect(getCurrent().status).toBe('failed');
    expect(getCurrent().errorMessage).toEqual(expect.any(String));
    expect(chunks.replaceForSource).not.toHaveBeenCalled();
  });

  it('unsupported chunking strategy defensive backstop: marks failed and rethrows', async () => {
    const getCurrent = wireSourcesAsStatefulFake(makeSourceRecord({ chunkingStrategy: 'semantic' }));

    await expect(useCase.execute('tenant-1', 'source-1')).rejects.toThrow();

    expect(getCurrent().status).toBe('failed');
    expect(chunks.replaceForSource).not.toHaveBeenCalled();
  });

  it('a benign conflict flipping to processing does not hard-fail — re-fetches and continues with the fresher row\'s config', async () => {
    const stale = makeSourceRecord();
    // findById returns the stale row once; update() reports a conflict on
    // the processing-flip attempt (simulating a concurrent edit having
    // already bumped updatedAt); a second findById (the re-fetch) returns
    // the fresher row, which is empty (0 chunks) to distinguish "the
    // pipeline used the re-fetched row" from "it used the stale one" (the
    // stale row's default content would produce 2 chunks, not 0).
    const fresher = makeSourceRecord({ updatedAt: new Date('2026-01-01T00:00:05.000Z'), rawContent: Buffer.from('') });
    sources.findById.mockResolvedValueOnce(stale).mockResolvedValueOnce(fresher);
    sources.update.mockResolvedValueOnce('conflict');

    await useCase.execute('tenant-1', 'source-1');

    expect(chunks.replaceForSource).not.toHaveBeenCalled();
    // Falls through to the zero-chunk terminal path using the re-fetched row's updatedAt.
    expect(sources.update).toHaveBeenLastCalledWith('tenant-1', 'source-1', fresher.updatedAt, {
      status: 'failed',
      errorMessage: 'Source produced no content to index.',
    });
  });

  it('logs and returns (no throw) if the source disappears after a concurrent-edit conflict on the processing flip', async () => {
    sources.findById.mockResolvedValueOnce(makeSourceRecord()).mockResolvedValueOnce(null);
    sources.update.mockResolvedValueOnce('conflict');

    await expect(useCase.execute('tenant-1', 'source-1')).resolves.toBeUndefined();
    expect(chunks.replaceForSource).not.toHaveBeenCalled();
  });
});
