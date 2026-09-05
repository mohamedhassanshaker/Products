import { createHash } from 'node:crypto';
import { getEnv } from '@/server/config';
import type { EmbeddingsPort } from '@/server/vector';

/**
 * Dev/test-only {@link EmbeddingsPort} binding (migration plan Phase 5) — ported verbatim from
 * `legacy/api/src/infrastructure/ai/embeddings/null.adapter.ts`: deterministic, hash-based
 * pseudo-vectors, no network call, no credential, same input always produces the same vector —
 * useful for reproducible fixtures and for exercising Qdrant upsert/search code paths without a real
 * embeddings provider (this environment has no live `EMBEDDINGS_API_KEY`/OpenAI-compatible credential
 * — see `docs/plans/nextjs-rewrite-phase5-plan.md`'s "Decisions made" #2).
 *
 * **Refuses to construct in production** (`env.schema.ts`'s boot-time validation already rejects
 * `EMBEDDINGS_PROVIDER=null` in `NODE_ENV=production/staging`) — this constructor-level check is a
 * second, defense-in-depth layer covering any code path that could construct this adapter directly
 * (e.g. a future test helper reused by mistake in a production build), matching this codebase's
 * existing "belt-and-braces" pattern (`createPlatformDataSource`'s own `synchronize` guard is the
 * precedent).
 */
export class NullEmbeddingsAdapter implements EmbeddingsPort {
  constructor() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'NullEmbeddingsAdapter must never be used in NODE_ENV=production — set EMBEDDINGS_PROVIDER to ' +
          '"openai-compatible" with a real credential/endpoint.',
      );
    }
  }

  get model(): string {
    return 'null-hash-embeddings';
  }

  get dims(): number {
    return getEnv().EMBEDDING_DIMS;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.pseudoVector(text));
  }

  /** Derives a deterministic unit-ish vector of length `dims` from `text`'s SHA-256 digest, cycling
   * the digest bytes as needed to fill longer dimensionalities. Not a real embedding — only useful for
   * exercising storage/retrieval plumbing, never for real semantic search quality. */
  private pseudoVector(text: string): number[] {
    const digest = createHash('sha256').update(text).digest();
    const dims = this.dims;
    const vector = new Array<number>(dims);
    for (let i = 0; i < dims; i += 1) {
      // Map each byte (0-255) to a small signed float in [-1, 1).
      vector[i] = digest[i % digest.length] / 128 - 1;
    }
    return vector;
  }
}
