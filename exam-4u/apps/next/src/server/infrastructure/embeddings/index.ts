import { getEnv } from '@/server/config';
import type { EmbeddingsPort } from '@/server/vector';
import { NullEmbeddingsAdapter } from './null-embeddings.adapter';
import { OpenAiCompatibleEmbeddingsAdapter } from './openai-compatible-embeddings.adapter';

export { NullEmbeddingsAdapter, OpenAiCompatibleEmbeddingsAdapter };

/**
 * `server/infrastructure/embeddings`'s public barrel (migration plan Phase 5) — the two
 * {@link EmbeddingsPort} implementations this dispatch ports (`local-tei` is not ported, see the
 * plan doc's "Decisions made" #5). Cached on `globalThis` for the same Next.js dev-mode hot-reload
 * reason every other process-wide singleton in this app is.
 */
declare global {
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandEmbeddingsPort: EmbeddingsPort | undefined;
}

/** Resolves the process-wide {@link EmbeddingsPort} singleton per `EMBEDDINGS_PROVIDER` — the single
 * factory point every consumer (`RetrievalService`, `scripts/ai-smoke.ts`) goes through, so a config
 * change never requires touching more than one place. */
export function getEmbeddingsPort(): EmbeddingsPort {
  if (!globalThis.__examlandEmbeddingsPort) {
    const provider = getEnv().EMBEDDINGS_PROVIDER;
    globalThis.__examlandEmbeddingsPort = provider === 'null' ? new NullEmbeddingsAdapter() : new OpenAiCompatibleEmbeddingsAdapter();
  }
  return globalThis.__examlandEmbeddingsPort;
}
