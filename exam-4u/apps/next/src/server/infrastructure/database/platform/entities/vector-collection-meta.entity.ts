import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * TypeORM mapping for `platform.vector_collection_meta` (migration plan Phase 5) — ported verbatim
 * from `legacy/api/src/infrastructure/database/platform/entities/vector-collection-meta.entity.ts`
 * (mirrored 1:1 from the same-named entity referenced by
 * `legacy/api/src/vector/infrastructure/repositories/vector-collection-meta.repository.ts`).
 *
 * Records "what embedding model/dimensionality was this Qdrant collection actually built with" —
 * `VectorBootstrapService` compares this recorded history against the current config on every boot
 * and fails hard on a mismatch (an embedding-model change invalidates every previously stored vector).
 * Platform-schema, not tenant-schema: a Qdrant collection is a single shared resource across every
 * tenant (tenant isolation happens via payload filter, not a separate collection per tenant), so its
 * drift-guard bookkeeping belongs alongside the platform's other cross-tenant infrastructure state.
 */
@Entity({ name: 'vector_collection_meta' })
export class VectorCollectionMetaEntity {
  /** The full collection name (e.g. `examland_next_chunks`) — natural key, not a synthetic UUID,
   * since there is exactly one row per physical Qdrant collection and no other identity is useful. */
  @PrimaryColumn({ type: 'varchar', length: 120 })
  collection!: string;

  @Column({ name: 'embedding_model', type: 'varchar', length: 200 })
  embeddingModel!: string;

  @Column({ type: 'int' })
  dims!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}
