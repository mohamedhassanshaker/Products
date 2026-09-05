import { getEnv } from '@/server/config';
import { logger } from '@/server/logging';
import type { EmbeddingsPort } from '@/server/vector';

interface OpenAiEmbeddingsResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

/**
 * Default {@link EmbeddingsPort} binding (migration plan Phase 5) — ported verbatim from
 * `legacy/api/src/infrastructure/ai/embeddings/openai-compatible.adapter.ts`: any OpenAI-compatible
 * `POST {base}/embeddings` endpoint, configured entirely by env (`EMBEDDINGS_BASE_URL`/`_API_KEY`/
 * `_MODEL`/`_BATCH_SIZE`, `EMBEDDING_DIMS`) — swappable to a different OpenAI-compatible provider
 * with zero code change.
 *
 * Batches requests at `EMBEDDINGS_BATCH_SIZE` and **re-orders results to input order** — the API
 * contract doesn't guarantee response order matches request order, so every result's own `index`
 * field is used to place it.
 */
export class OpenAiCompatibleEmbeddingsAdapter implements EmbeddingsPort {
  get model(): string {
    return getEnv().EMBEDDINGS_MODEL;
  }

  get dims(): number {
    return getEnv().EMBEDDING_DIMS;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const batchSize = getEnv().EMBEDDINGS_BATCH_SIZE;
    const results: number[][] = new Array(texts.length);
    for (let start = 0; start < texts.length; start += batchSize) {
      const batch = texts.slice(start, start + batchSize);
      const batchResults = await this.embedBatch(batch);
      for (let i = 0; i < batchResults.length; i += 1) {
        results[start + i] = batchResults[i];
      }
    }
    return results;
  }

  private async embedBatch(batch: string[]): Promise<number[][]> {
    const { EMBEDDINGS_BASE_URL: baseUrl, EMBEDDINGS_API_KEY: apiKey, EMBEDDINGS_MODEL: model } = getEnv();
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model, input: batch }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.error({ status: response.status, body }, 'embeddings.request_failed');
      throw new Error(`Embeddings provider returned ${response.status}`);
    }
    const json = (await response.json()) as OpenAiEmbeddingsResponse;
    const ordered = new Array<number[]>(batch.length);
    for (const item of json.data) {
      ordered[item.index] = item.embedding;
    }
    return ordered;
  }
}
