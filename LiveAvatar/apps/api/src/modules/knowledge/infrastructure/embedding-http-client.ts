import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { EmbeddingClientPort } from '../domain/ports';

/** Local dev default — overridden by `EMBEDDING_SERVICE_URL` in every real deployment. */
const DEFAULT_EMBEDDING_SERVICE_URL = 'http://localhost:8082';

/** Matches the Python `/embed` endpoint's documented `inputs` cap. */
const MAX_INPUTS_PER_CALL = 96;

/**
 * Calls the Python `ai_service`'s `POST /embed` (Phase 12a plan doc,
 * `apps/agent/src/avatar_agent/services/ai_service.py`) over internal HTTP,
 * guarded by the shared `X-Internal-Token` secret (the same symmetric token
 * `InternalTokenGuard` uses for the Python -> Nest direction, mirrored here
 * for this Nest -> Python direction). Uses Node's built-in `fetch` (Node 22
 * runtime per `apps/api`'s `@types/node ^24`/lockfile) — no new HTTP-client
 * dependency needed.
 */
@Injectable()
export class EmbeddingHttpClient implements EmbeddingClientPort {
  /** @inheritdoc */
  async embed(request: {
    provider: string;
    model: string;
    credentialRef: string | null;
    inputs: string[];
  }): Promise<{ dimension: number; embeddings: number[][] }> {
    if (request.inputs.length === 0 || request.inputs.length > MAX_INPUTS_PER_CALL) {
      throw AppError.badRequest('KNOWLEDGE_INGEST_FAILED');
    }

    const baseUrl = process.env.EMBEDDING_SERVICE_URL ?? DEFAULT_EMBEDDING_SERVICE_URL;
    const internalToken = process.env.INTERNAL_TOKEN ?? '';

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Token': internalToken },
        body: JSON.stringify({
          provider: request.provider,
          model: request.model,
          credential_ref: request.credentialRef,
          inputs: request.inputs,
        }),
      });
    } catch {
      // Network-level failure (connection refused, DNS, etc.) — never
      // surface the raw cause, it could echo internal network details.
      throw AppError.badRequest('KNOWLEDGE_INGEST_FAILED');
    }

    if (!response.ok) {
      // Never surface the embedding service's raw response body in the
      // thrown error's details — it is vendor/service-controlled text and
      // must not leak into a client-facing error or a log line.
      throw AppError.badRequest('KNOWLEDGE_INGEST_FAILED');
    }

    const body = (await response.json()) as { model: string; dimension: number; embeddings: number[][] };
    return { dimension: body.dimension, embeddings: body.embeddings };
  }
}
