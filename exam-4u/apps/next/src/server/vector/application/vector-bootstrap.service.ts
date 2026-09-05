import { getEnv } from '@/server/config';
import { logger } from '@/server/logging';
import { getPlatformDataSource } from '@/server/infrastructure/database';
import { getQdrantVectorStoreAdapter, type QdrantVectorStoreAdapter } from '@/server/infrastructure/vector';
import { VectorCollectionMetaRepository } from '../infrastructure/vector-collection-meta.repository';

/** One collection's bootstrap spec: its logical name plus the extra (non-`tenantId`) payload fields
 * that get a keyword index. */
interface CollectionSpec {
  name: string;
  extraIndexes: string[];
}

/**
 * Idempotently ensures the three Qdrant collections and their payload indexes exist, and enforces the
 * embedding-model/dims safety guard against `platform.vector_collection_meta` — the migration plan's
 * own "Qdrant single-chokepoint adapter + tenant-payload-filter isolation" prerequisite, ported from
 * `legacy/api/src/vector/application/vector-bootstrap.service.ts`.
 *
 * Unlike legacy's `OnApplicationBootstrap`-hooked version (this app has no Nest DI container/module
 * lifecycle), {@link run} is called explicitly by whichever composition root needs the collections to
 * exist first (`scripts/ai-smoke.ts`, and any later Route Handler wiring) — matching this app's own
 * "migrations/bootstrap happen explicitly, never implicitly on request boot" established convention
 * (`createPlatformDataSource`'s own doc comment).
 */
export class VectorBootstrapService {
  constructor(
    private readonly adapter: QdrantVectorStoreAdapter,
    private readonly metaRepo: VectorCollectionMetaRepository,
  ) {}

  async run(): Promise<void> {
    const { EMBEDDING_DIMS: dims, EMBEDDINGS_MODEL: model } = getEnv();
    const names = this.adapter.collectionNames();
    const specs: CollectionSpec[] = [
      { name: names.chunks, extraIndexes: ['curriculumId', 'documentId'] },
      { name: names.fingerprints, extraIndexes: ['fileHash'] },
      { name: names.questionBank, extraIndexes: ['scopeKey', 'examTypeId'] },
    ];

    for (const spec of specs) {
      await this.ensureOne(spec, model, dims);
    }
    logger.info({ collections: specs.map((s) => s.name), model, dims }, 'vector_bootstrap.complete');
  }

  /**
   * Bootstraps a single collection and enforces the dim/model guard for it.
   * @throws {Error} with an actionable remediation message if the live Qdrant collection's vector
   *   size does not match `EMBEDDING_DIMS`, or if `vector_collection_meta` recorded a different
   *   `embedding_model`/`dims` than the current config — an embedding-model change invalidates every
   *   previously stored vector, so this must stop the process, not warn and continue.
   */
  private async ensureOne(spec: CollectionSpec, model: string, dims: number): Promise<void> {
    await this.adapter.ensureCollection(spec.name, dims, spec.extraIndexes);

    const liveSize = await this.adapter.getCollectionVectorSize(spec.name);
    if (liveSize !== dims) {
      throw new Error(
        `Vector collection "${spec.name}" has vector size ${liveSize ?? 'unknown'} in Qdrant but ` +
          `EMBEDDING_DIMS=${dims} is configured. This collection was likely built with a different ` +
          `embeddings model/dimensionality. Rebuild it with the current config, or restore the ` +
          `previous EMBEDDING_DIMS value.`,
      );
    }

    let meta;
    try {
      meta = await this.metaRepo.findByCollection(spec.name);
    } catch (err) {
      // `platform.vector_collection_meta` not existing yet means platform migrations simply have not
      // been applied ahead of this boot — a migrations-ordering concern entirely orthogonal to the
      // embedding-drift guard this method exists to enforce, and (per this codebase's own established
      // convention) not this service's job to fail hard over. The Qdrant-side collection/dims check
      // above still ran unconditionally; only the MySQL-recorded-history half of the guard is skipped
      // here, and it re-runs (and can still fail) on every subsequent boot once migrations have been
      // applied.
      if (this.isMissingTableError(err)) {
        logger.warn(
          { collection: spec.name },
          'vector_bootstrap.meta_table_missing — run pending platform migrations before relying on the drift guard',
        );
        return;
      }
      throw err;
    }

    if (!meta) {
      // First boot for this collection: record what it was built with.
      await this.metaRepo.createIfAbsent({ collection: spec.name, embeddingModel: model, dims });
      return;
    }
    if (meta.embeddingModel !== model || meta.dims !== dims) {
      throw new Error(
        `Vector collection "${spec.name}" was built with embedding_model="${meta.embeddingModel}" ` +
          `dims=${meta.dims} (recorded in platform.vector_collection_meta), but the current config ` +
          `specifies EMBEDDINGS_MODEL="${model}" EMBEDDING_DIMS=${dims}. An embedding-model change ` +
          `invalidates every stored vector. Reindex before restarting with the new config, or restore ` +
          `the previous EMBEDDINGS_MODEL/EMBEDDING_DIMS values.`,
      );
    }
  }

  /** True for MySQL's "table doesn't exist" error (`ER_NO_SUCH_TABLE`, `errno` 1146) — the only
   * database error this service treats as non-fatal (see {@link ensureOne}'s doc comment). Any other
   * database error (connection failure, permissions, …) still propagates and fails boot. */
  private isMissingTableError(err: unknown): boolean {
    const code = (err as { code?: string; errno?: number } | undefined)?.code;
    const errno = (err as { code?: string; errno?: number } | undefined)?.errno;
    return code === 'ER_NO_SUCH_TABLE' || errno === 1146;
  }
}

/** Composition root: builds a fresh {@link VectorBootstrapService} against the process-wide Qdrant
 * adapter singleton and the platform `DataSource`. Not cached on `globalThis` itself (its own `run()`
 * is naturally idempotent and cheap to re-invoke; only the underlying Qdrant client/`DataSource` need
 * to be process-wide singletons, and both already are via their own barrels). */
export async function createVectorBootstrapService(): Promise<VectorBootstrapService> {
  const dataSource = await getPlatformDataSource();
  return new VectorBootstrapService(getQdrantVectorStoreAdapter(), new VectorCollectionMetaRepository(dataSource));
}
