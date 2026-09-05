import type { KnowledgeChunkRepositoryPort, KnowledgeSearchCandidate } from '../domain/ports';
import { SearchKnowledgeUseCase } from './search-knowledge.use-case';

function candidate(overrides: Partial<KnowledgeSearchCandidate> = {}): KnowledgeSearchCandidate {
  return {
    chunkId: 'chunk-1',
    sourceId: 'source-1',
    sourceName: 'Docs',
    text: 'Refunds are available within 30 days.',
    vectorScore: 0.81,
    keywordScore: 0.74,
    blendScore: 0.78,
    passedFilter: true,
    ...overrides,
  };
}

describe('SearchKnowledgeUseCase', () => {
  let chunks: jest.Mocked<KnowledgeChunkRepositoryPort>;
  let useCase: SearchKnowledgeUseCase;

  beforeEach(() => {
    chunks = { replaceForSource: jest.fn(), writeEmbeddings: jest.fn(), hybridSearch: jest.fn() };
    useCase = new SearchKnowledgeUseCase(chunks);
  });

  it('maps the request into a HybridSearchQuery and the repository result into the wire DTO shape', async () => {
    chunks.hybridSearch.mockResolvedValue([candidate()]);

    const result = await useCase.execute({
      tenant_id: 'tenant-1',
      source_refs: ['source-1'],
      query_text: 'refund after 30 days',
      query_embedding: [0.1, 0.2, 0.3],
      vector_weight: 0.6,
      keyword_weight: 0.4,
      candidates: 20,
    });

    expect(chunks.hybridSearch).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      sourceRefs: ['source-1'],
      queryText: 'refund after 30 days',
      queryEmbedding: [0.1, 0.2, 0.3],
      vectorWeight: 0.6,
      keywordWeight: 0.4,
      candidates: 20,
      filter: undefined,
    });
    expect(result).toEqual({
      candidates: [
        {
          chunk_id: 'chunk-1',
          source_id: 'source-1',
          source_name: 'Docs',
          text: 'Refunds are available within 30 days.',
          vector_score: 0.81,
          keyword_score: 0.74,
          blend_score: 0.78,
          passed_filter: true,
        },
      ],
    });
  });

  it('threads a metadata filter condition through to the repository unchanged', async () => {
    chunks.hybridSearch.mockResolvedValue([]);
    await useCase.execute({
      tenant_id: 'tenant-1',
      source_refs: ['source-1'],
      query_text: 'q',
      query_embedding: [0.1],
      vector_weight: 0.5,
      keyword_weight: 0.5,
      candidates: 10,
      filter: { field: 'section', op: 'eq', value: 'refunds' },
    });
    expect(chunks.hybridSearch).toHaveBeenCalledWith(
      expect.objectContaining({ filter: { field: 'section', op: 'eq', value: 'refunds' } }),
    );
  });
});
