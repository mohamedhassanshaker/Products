import { Inject, Injectable } from '@nestjs/common';
import type { RunRetrievalPlaygroundRequest, RunRetrievalPlaygroundResponseDto } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { AI_SERVICE_CLIENT, KNOWLEDGE_SOURCE_REPOSITORY, type AiServiceClientPort, type KnowledgeSourceRepositoryPort } from '../../knowledge';
import { DEPLOYMENT_CONFIG_REPOSITORY, type DeploymentConfigRepositoryPort } from '../domain/ports';

/**
 * This use-case lives in `deployment-config` (not `knowledge`, despite
 * being a "knowledge playground" feature) specifically to avoid a module
 * cycle: `deployment-config` already depends one-directionally on
 * `knowledge` (`ValidateConfigUseCase` needs `KNOWLEDGE_SOURCE_REPOSITORY`
 * for V-9); if this use-case lived in `knowledge` instead, it would need
 * `DEPLOYMENT_CONFIG_REPOSITORY` back from `deployment-config`, a genuine
 * circular NestJS module import. Mirrors `TestCallGraphUseCase`'s existing
 * precedent of living here while reaching into another module (`tools`,
 * for `TOOL_INVOKER`) for what it needs.
 *
 * The one shape this use-case needs out of `PartialAgentConfig` is read via
 * a local, minimal duck-typed interface rather than importing this
 * module's own internal domain type (`PartialAgentConfig` is intentionally
 * not exported from this module's barrel) — keeps this file decoupled from
 * that type's own evolution.
 */
interface StructuredConfigShape {
  reasoning?: {
    graph?: {
      type: string;
      source_refs?: string[];
      provider?: string;
      model?: string;
      credential_ref?: string;
    }[];
  };
  knowledge?: {
    pipeline?: RunRetrievalPlaygroundResponseShapePipeline;
  };
}

/** Mirrors `RetrievalPipelineConfig` — duck-typed locally for the same reason as `StructuredConfigShape` above. */
interface RunRetrievalPlaygroundResponseShapePipeline {
  rewrite: { enabled: boolean; context_turns: number; budget_ms: number };
  hybrid_search: { vector_weight: number; keyword_weight: number; candidates: number; budget_ms: number };
  metadata_filter: { enabled: boolean; condition?: { field: string; op: 'eq' | 'neq' | 'contains'; value: string }; budget_ms: number };
  rerank: { enabled: false };
  threshold: { min_score: number; budget_ms: number };
  inject: { token_cap: number; citation_format: 'numbered' | 'inline' | 'none'; budget_ms: number };
}

const DEFAULT_PIPELINE: RunRetrievalPlaygroundResponseShapePipeline = {
  rewrite: { enabled: true, context_turns: 3, budget_ms: 150 },
  hybrid_search: { vector_weight: 0.6, keyword_weight: 0.4, candidates: 20, budget_ms: 100 },
  metadata_filter: { enabled: false, budget_ms: 20 },
  rerank: { enabled: false },
  threshold: { min_score: 0.5, budget_ms: 10 },
  inject: { token_cap: 1200, citation_format: 'numbered', budget_ms: 30 },
};

/**
 * `POST /tenants/:id/knowledge/playground/run` (Phase 12b, BL-045/047/048,
 * R-R9/UC-R1) — the Retrieval playground's "Run" action. **Not** the Phase 9
 * generic test-call harness (see the plan doc's "Decisions made this phase"
 * #8): it calls `ai_service`'s `/retrieve-preview`, which runs the exact
 * same `retrieval_pipeline.py` module the live Retrieve node executor uses
 * against the tenant's real pgvector index — a real diagnostic tool, not a
 * structural simulation.
 */
@Injectable()
export class RunRetrievalPlaygroundUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(DEPLOYMENT_CONFIG_REPOSITORY) private readonly configs: DeploymentConfigRepositoryPort,
    @Inject(KNOWLEDGE_SOURCE_REPOSITORY) private readonly knowledgeSources: KnowledgeSourceRepositoryPort,
    @Inject(AI_SERVICE_CLIENT) private readonly aiService: AiServiceClientPort,
  ) {}

  async execute(actor: AdminActor, tenantId: string, input: RunRetrievalPlaygroundRequest): Promise<RunRetrievalPlaygroundResponseDto> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant || !canAccessTenant(actor, tenant.id)) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }

    const config = await this.configs.findByTenantId(tenantId);
    const structured = (config?.structured ?? {}) as StructuredConfigShape;

    const retrieveNodes = (structured.reasoning?.graph ?? []).filter((n) => n.type === 'retrieve');
    const sourceRefs = input.source_refs ?? [...new Set(retrieveNodes.flatMap((n) => n.source_refs ?? []))];
    if (sourceRefs.length === 0) {
      throw AppError.badRequest('KNOWLEDGE_SOURCE_NOT_FOUND', { reason: 'no knowledge source configured to search' });
    }

    const pipeline = structured.knowledge?.pipeline ?? DEFAULT_PIPELINE;

    const [primaryLlmNode] = (structured.reasoning?.graph ?? []).filter((n) => n.type === 'llm');
    const llm =
      pipeline.rewrite.enabled && primaryLlmNode?.provider && primaryLlmNode?.model
        ? { provider: primaryLlmNode.provider, model: primaryLlmNode.model, credentialRef: primaryLlmNode.credential_ref ?? null }
        : null;

    // Every source referenced must be embedded with a comparable vector
    // space to be meaningfully compared by cosine distance — 12a fixes
    // embedding to one model/dimension platform-wide (`text-embedding-3-small`,
    // 1536-dim) for exactly this reason, so any referenced source's own
    // `embeddingCredentialRef` is a safe stand-in for the query embedding's
    // credential (falls back to the platform default when absent, same as
    // ingestion already does).
    const sources = await Promise.all(sourceRefs.map((id) => this.knowledgeSources.findById(tenantId, id)));
    const firstSource = sources.find((s) => s !== null);

    const result = await this.aiService.retrievePreview({
      tenantId,
      query: input.query,
      conversationContext: input.conversation_context ?? null,
      sourceRefs,
      llm,
      embeddingModel: firstSource?.embeddingModel ?? 'text-embedding-3-small',
      embeddingCredentialRef: firstSource?.embeddingCredentialRef ?? null,
      pipeline,
    });

    return {
      rewrite: result.rewrite,
      hybrid_search: {
        ms: result.hybrid_search.ms,
        timed_out: result.hybrid_search.timed_out,
        candidates: result.hybrid_search.candidates.map((c) => ({
          chunk_id: c.chunk_id,
          source_id: c.source_id,
          source_name: c.source_name,
          text_excerpt: c.text_excerpt,
          vector_score: c.vector_score,
          keyword_score: c.keyword_score,
          blend_score: c.blend_score,
          passed_filter: c.passed_filter,
          passed_threshold: c.passed_threshold,
        })),
      },
      filter: result.filter,
      rerank: result.rerank,
      threshold: result.threshold,
      inject: {
        token_total: result.inject.token_total,
        token_cap: result.inject.token_cap,
        ms: result.inject.ms,
        chunks: result.inject.chunks.map((c) => ({
          citation_label: c.citation_label,
          source_name: c.source_name,
          text_excerpt: c.text_excerpt,
          token_count: c.token_count,
        })),
      },
      total_ms: result.total_ms,
      budget_ms: result.budget_ms,
      over_budget: result.over_budget,
    };
  }
}
