/**
 * The embeddings port (migration plan Phase 5) — ported verbatim from
 * `legacy/api/src/vector/domain/embeddings.port.ts`. Framework-free by construction. `model`/`dims`
 * are exposed as read-only properties (not just config) so {@link import('../application/vector-bootstrap.service').VectorBootstrapService}
 * can compare "what the adapter actually is" against `platform.vector_collection_meta` and the live
 * Qdrant collection config without re-reading raw env vars — the adapter is the single source of
 * truth for "what did we embed with."
 */
export interface EmbeddingsPort {
  /** Batched, order-preserving: `embed(texts)[i]` is the embedding of `texts[i]`. */
  embed(texts: string[]): Promise<number[][]>;
  readonly model: string;
  readonly dims: number;
}
