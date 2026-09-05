import type { DataSource, Repository } from 'typeorm';
import { VectorCollectionMetaEntity } from '@/server/infrastructure/database';

/**
 * Data access over `platform.vector_collection_meta` — ported from
 * `legacy/api/src/vector/infrastructure/repositories/vector-collection-meta.repository.ts`. Uses the
 * literal table-name string form (never the entity class) when acquiring the repository, per this
 * app's cross-webpack-bundle TypeORM fix (every prior module's own identical convention).
 *
 * Exactly one caller (`VectorBootstrapService`) and no business invariant beyond "read the recorded
 * model/dims, write them once" — kept as a small, standalone repository rather than folded into a
 * larger class for that reason.
 */
export class VectorCollectionMetaRepository {
  private readonly repo: Repository<VectorCollectionMetaEntity>;

  constructor(dataSource: DataSource) {
    this.repo = dataSource.getRepository<VectorCollectionMetaEntity>('vector_collection_meta');
  }

  async findByCollection(collection: string): Promise<VectorCollectionMetaEntity | null> {
    return this.repo.findOne({ where: { collection } });
  }

  /** Idempotent insert-if-absent — never overwrites an existing row (an existing row's model/dims
   * mismatching config is `VectorBootstrapService`'s job to detect and fail boot over, not this
   * repository's job to silently correct). */
  async createIfAbsent(input: { collection: string; embeddingModel: string; dims: number }): Promise<void> {
    const existing = await this.findByCollection(input.collection);
    if (existing) return;
    await this.repo.insert({ collection: input.collection, embeddingModel: input.embeddingModel, dims: input.dims });
  }
}
