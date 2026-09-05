import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AiServiceClientPort, RetrievePreviewRequest, RetrievePreviewResponse } from '../domain/ports';

/** Local dev default — overridden by `EMBEDDING_SERVICE_URL` in every real deployment (same env var `EmbeddingHttpClient` uses; `ai_service` is the one process, `/embed` and `/retrieve-preview` are two of its routes). */
const DEFAULT_AI_SERVICE_URL = 'http://localhost:8082';

/**
 * Calls the Python `ai_service`'s `POST /retrieve-preview` (Phase 12b,
 * `apps/agent/src/avatar_agent/services/ai_service.py`) over internal HTTP,
 * guarded by the same shared `X-Internal-Token` secret `EmbeddingHttpClient`
 * already uses for this Nest -> Python direction. This is the Playground's
 * real code path — `ai_service` runs the exact same `retrieval_pipeline.py`
 * module the live Retrieve node executor uses (`ARCHITECTURE_NOTES.md` §4.5),
 * never a structural simulation.
 */
@Injectable()
export class AiServiceHttpClient implements AiServiceClientPort {
  /** @inheritdoc */
  async retrievePreview(request: RetrievePreviewRequest): Promise<RetrievePreviewResponse> {
    const baseUrl = process.env.EMBEDDING_SERVICE_URL ?? DEFAULT_AI_SERVICE_URL;
    const internalToken = process.env.INTERNAL_TOKEN ?? '';

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/retrieve-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Token': internalToken },
        body: JSON.stringify({
          tenant_id: request.tenantId,
          query: request.query,
          conversation_context: request.conversationContext,
          source_refs: request.sourceRefs,
          llm: request.llm
            ? { provider: request.llm.provider, model: request.llm.model, credential_ref: request.llm.credentialRef }
            : null,
          embedding_model: request.embeddingModel,
          embedding_credential_ref: request.embeddingCredentialRef,
          pipeline: request.pipeline,
        }),
      });
    } catch {
      // Network-level failure (connection refused, DNS, etc.) — never
      // surface the raw cause, it could echo internal network details.
      throw AppError.badRequest('KNOWLEDGE_INGEST_FAILED');
    }

    if (!response.ok) {
      // Never surface ai_service's raw response body — vendor/service
      // -controlled text must not leak into a client-facing error or log.
      throw AppError.badRequest('KNOWLEDGE_INGEST_FAILED');
    }

    return (await response.json()) as RetrievePreviewResponse;
  }
}
