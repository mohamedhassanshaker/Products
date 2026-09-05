import { QdrantVectorStoreAdapter } from './qdrant.adapter';

export { QdrantVectorStoreAdapter };

/**
 * `server/infrastructure/vector`'s public barrel (migration plan Phase 5) — the sole module allowed
 * to import `@qdrant/js-client-rest` (enforced by `apps/next/.eslintrc.cjs`'s
 * `infrastructure/vector` module-boundary rule). Cached on `globalThis` for the same Next.js
 * dev-mode hot-reload reason every other process-wide singleton in this app is.
 */
declare global {
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandQdrantAdapter: QdrantVectorStoreAdapter | undefined;
}

/** Returns the process-wide `QdrantVectorStoreAdapter` singleton — one live `QdrantClient` per
 * process, matching every other shared-resource singleton's construction pattern in this app. */
export function getQdrantVectorStoreAdapter(): QdrantVectorStoreAdapter {
  if (!globalThis.__examlandQdrantAdapter) {
    globalThis.__examlandQdrantAdapter = new QdrantVectorStoreAdapter();
  }
  return globalThis.__examlandQdrantAdapter;
}
