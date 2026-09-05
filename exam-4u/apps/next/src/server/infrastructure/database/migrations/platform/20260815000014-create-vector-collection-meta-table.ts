import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `platform.vector_collection_meta` (migration plan Phase 5) — ported verbatim from
 * `legacy/api/src/infrastructure/database/migrations/platform/*-create-vector-collection-meta-table.ts`.
 *
 * `VectorBootstrapService` reads/writes this table on every process boot to enforce the embedding
 * model/dimensionality drift guard: the first boot for a given collection records what it was built
 * with; every subsequent boot compares the current `EMBEDDINGS_MODEL`/`EMBEDDING_DIMS` config against
 * the recorded row and fails hard (loud, at boot, not silently) on a mismatch — an embedding-model
 * change invalidates every vector already stored under the old model, so this must stop the process,
 * not warn and continue serving stale/incompatible retrieval results.
 */
export class CreateVectorCollectionMetaTable20260815000014 implements MigrationInterface {
  name = 'CreateVectorCollectionMetaTable20260815000014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS vector_collection_meta (
        collection      VARCHAR(120) NOT NULL,
        embedding_model VARCHAR(200) NOT NULL,
        dims            INT          NOT NULL,
        created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (collection)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS vector_collection_meta`);
  }
}
