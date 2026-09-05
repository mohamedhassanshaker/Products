import type { TenantRepositoryPort } from '../../tenants';
import type { AiServiceClientPort, KnowledgeSourceRepositoryPort, RetrievePreviewResponse } from '../../knowledge';
import type { DeploymentConfigRecord, DeploymentConfigRepositoryPort } from '../domain/ports';
import { RunRetrievalPlaygroundUseCase } from './run-retrieval-playground.use-case';

const actor = { id: 'admin-1', email: 'a@b.com', roles: ['operator'], tenantIds: [] };

function makeTenant(overrides: Record<string, unknown> = {}) {
  return { id: 'tenant-1', name: 'Acme', slug: 'acme', ...overrides };
}

function makeConfig(overrides: Partial<DeploymentConfigRecord> = {}): DeploymentConfigRecord {
  return {
    id: 'config-1',
    tenantId: 'tenant-1',
    yamlText: '',
    status: 'published',
    providers: { transport: null, stt: null, llm: null, llmFallback: null, tts: null, avatar: null },
    updatedAt: new Date(),
    updatedBy: null,
    publishedAt: new Date(),
    structured: {
      reasoning: {
        graph: [
          {
            id: 'llm-1',
            type: 'llm',
            provider: 'openai',
            model: 'gpt-4o-mini',
            credential_ref: 'secrets/openai',
          },
          {
            id: 'retrieve-1',
            type: 'retrieve',
            source_refs: ['source-1'],
          },
        ],
      },
      knowledge: {
        pipeline: {
          rewrite: { enabled: true, context_turns: 3, budget_ms: 150 },
          hybrid_search: { vector_weight: 0.6, keyword_weight: 0.4, candidates: 20, budget_ms: 100 },
          metadata_filter: { enabled: false, budget_ms: 20 },
          rerank: { enabled: false },
          threshold: { min_score: 0.5, budget_ms: 10 },
          inject: { token_cap: 1200, citation_format: 'numbered', budget_ms: 30 },
        },
      },
    } as never,
    pendingRollbackFromVersionId: null,
    ...overrides,
  };
}

function makePreviewResponse(overrides: Partial<RetrievePreviewResponse> = {}): RetrievePreviewResponse {
  return {
    rewrite: { enabled: true, rewritten_query: 'refund eligibility after 30 days', ms: 118, timed_out: false },
    hybrid_search: { candidates: [], ms: 58, timed_out: false },
    filter: { enabled: false, before_count: 0, after_count: 0, ms: 0 },
    rerank: { enabled: false, note: 'Reranking is not available yet (BL-070).' },
    threshold: { min_score: 0.5, pass_count: 0, dropped_count: 0, ms: 1 },
    inject: { chunks: [], token_total: 0, token_cap: 1200, ms: 1 },
    total_ms: 178,
    budget_ms: 400,
    over_budget: false,
    ...overrides,
  };
}

describe('RunRetrievalPlaygroundUseCase', () => {
  function make(config: DeploymentConfigRecord | null = makeConfig()) {
    const tenants = { findById: jest.fn().mockResolvedValue(makeTenant()) } as unknown as jest.Mocked<TenantRepositoryPort>;
    const configs = { findByTenantId: jest.fn().mockResolvedValue(config), save: jest.fn() } as unknown as jest.Mocked<DeploymentConfigRepositoryPort>;
    const knowledgeSources = {
      create: jest.fn(),
      findById: jest.fn().mockResolvedValue({ id: 'source-1', embeddingModel: 'text-embedding-3-small', embeddingCredentialRef: null }),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<KnowledgeSourceRepositoryPort>;
    const aiService = { retrievePreview: jest.fn().mockResolvedValue(makePreviewResponse()) } as unknown as jest.Mocked<AiServiceClientPort>;
    const useCase = new RunRetrievalPlaygroundUseCase(tenants, configs, knowledgeSources, aiService);
    return { tenants, configs, knowledgeSources, aiService, useCase };
  }

  it('404s an unknown tenant', async () => {
    const { useCase, tenants } = make();
    tenants.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', { query: 'refund' })).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it("defaults source_refs to the union of every retrieve node's source_refs when omitted", async () => {
    const { useCase, aiService } = make();
    await useCase.execute(actor, 'tenant-1', { query: 'refund after 30 days' });
    expect(aiService.retrievePreview).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRefs: ['source-1'] }),
    );
  });

  it('uses caller-supplied source_refs when provided, instead of the config default', async () => {
    const { useCase, aiService } = make();
    await useCase.execute(actor, 'tenant-1', { query: 'refund', source_refs: ['source-2'] });
    expect(aiService.retrievePreview).toHaveBeenCalledWith(expect.objectContaining({ sourceRefs: ['source-2'] }));
  });

  it('400s when no source is configured or supplied to search', async () => {
    const { useCase } = make(
      makeConfig({ structured: { reasoning: { graph: [] }, knowledge: { pipeline: undefined } } as never }),
    );
    await expect(useCase.execute(actor, 'tenant-1', { query: 'refund' })).rejects.toMatchObject({
      code: 'KNOWLEDGE_SOURCE_NOT_FOUND',
    });
  });

  it("resolves the primary LLM leg for rewrite from the config's first llm-type node when rewrite is enabled", async () => {
    const { useCase, aiService } = make();
    await useCase.execute(actor, 'tenant-1', { query: 'refund' });
    expect(aiService.retrievePreview).toHaveBeenCalledWith(
      expect.objectContaining({ llm: { provider: 'openai', model: 'gpt-4o-mini', credentialRef: 'secrets/openai' } }),
    );
  });

  it('passes llm: null when the pipeline has rewrite disabled', async () => {
    const config = makeConfig();
    (config.structured as never as { knowledge: { pipeline: { rewrite: { enabled: boolean } } } }).knowledge.pipeline.rewrite.enabled = false;
    const { useCase, aiService } = make(config);
    await useCase.execute(actor, 'tenant-1', { query: 'refund' });
    expect(aiService.retrievePreview).toHaveBeenCalledWith(expect.objectContaining({ llm: null }));
  });

  it("resolves the embedding model/credential from the first referenced source's own record", async () => {
    const { useCase, aiService, knowledgeSources } = make();
    knowledgeSources.findById.mockResolvedValue({
      id: 'source-1',
      embeddingModel: 'text-embedding-3-small',
      embeddingCredentialRef: 'secrets/embedding',
    } as never);
    await useCase.execute(actor, 'tenant-1', { query: 'refund' });
    expect(aiService.retrievePreview).toHaveBeenCalledWith(
      expect.objectContaining({ embeddingModel: 'text-embedding-3-small', embeddingCredentialRef: 'secrets/embedding' }),
    );
  });

  it('maps the ai_service response into the RunRetrievalPlaygroundResponseDto shape', async () => {
    const { useCase, aiService } = make();
    aiService.retrievePreview.mockResolvedValue(
      makePreviewResponse({
        hybrid_search: {
          ms: 58,
          timed_out: false,
          candidates: [
            {
              chunk_id: 'chunk-1',
              source_id: 'source-1',
              source_name: 'returns-policy',
              text_excerpt: 'Refunds are available within 30 days.',
              vector_score: 0.81,
              keyword_score: 0.74,
              blend_score: 0.78,
              passed_filter: true,
              passed_threshold: true,
            },
          ],
        },
      }),
    );
    const result = await useCase.execute(actor, 'tenant-1', { query: 'refund' });
    expect(result.hybrid_search.candidates).toHaveLength(1);
    expect(result.hybrid_search.candidates[0]).toEqual({
      chunk_id: 'chunk-1',
      source_id: 'source-1',
      source_name: 'returns-policy',
      text_excerpt: 'Refunds are available within 30 days.',
      vector_score: 0.81,
      keyword_score: 0.74,
      blend_score: 0.78,
      passed_filter: true,
      passed_threshold: true,
    });
    expect(result.total_ms).toBe(178);
    expect(result.budget_ms).toBe(400);
    expect(result.over_budget).toBe(false);
  });

  it('never leaks another tenant\'s config — findByTenantId is always called with the path tenant id', async () => {
    const { useCase, configs } = make();
    await useCase.execute(actor, 'tenant-1', { query: 'refund' });
    expect(configs.findByTenantId).toHaveBeenCalledWith('tenant-1');
  });
});
