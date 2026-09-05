import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `curriculum_document`, `stored_image`, and `question_image` in every tenant schema
 * (migration plan Phase 6, sub-slice "6b" — FR-CUR-2, FR-PDF-6, FR-PDF-11, FR-FILE-3). Adapted from
 * `legacy/api/src/infrastructure/database/migrations/tenant/1730000000005-create-curriculum-tables.ts`
 * (the `curriculum_document` half Phase 3 deliberately did not port) and `1730000000012-create-media-
 * tables.ts`.
 *
 * **`curriculum_document` closes Phase 3's own documented deferral.** That phase created `curriculum`
 * (ownership/metadata) but left this table out precisely because its `page_count`/`chunk_count`/
 * `content_type` columns are products of a text-extraction/chunking/embedding pipeline that did not
 * exist yet — "define it once, correctly, alongside its first real writer". Both of its real writers
 * land in this sub-slice: `CurriculaService.uploadDocument` (FR-CUR-2 Curriculum document ingestion)
 * and `ReferenceIndexingService` (FR-PDF-6's Reference content-type branch). `ON DELETE CASCADE` on
 * `fk_doc_cur` matches legacy verbatim — a deleted Curriculum takes its document rows with it (the
 * owning service is separately responsible for deleting the corresponding Qdrant chunks and storage
 * objects, which no FK can express).
 *
 * **`stored_image.file_hash` is UNIQUE (`uq_image_hash`)** — this is the schema-level half of
 * FR-PDF-11's content-hash dedup guarantee, so a lost `findByHash` race between two concurrent
 * extraction passes fails loudly at the DB rather than silently double-storing.
 * **`question_image`'s `uq_qi` (generated_question_id, image_id, position, option_key)** is likewise
 * the schema-level half of `ImageAssociationService.associateWithQuestion`'s idempotency.
 * `fk_qi_gq` is `ON DELETE CASCADE` (deleting a generated question drops its associations);
 * `fk_qi_img` is `ON DELETE RESTRICT` (a still-referenced image can never be deleted out from under an
 * association — which is what makes `removeAssociation`'s "delete the association row first, then the
 * image only if the count hit zero" ordering safe).
 *
 * Ordering: this migration FKs `curriculum` (`20260815000004`) and `generated_question`
 * (`20260815000007`), both applied earlier in `TENANT_MIGRATIONS`' array order.
 *
 * `CREATE TABLE IF NOT EXISTS` matches every prior tenant migration's idempotent-retry convention.
 */
export class CreateCurriculumDocumentAndMediaTables20260815000008 implements MigrationInterface {
  name = 'CreateCurriculumDocumentAndMediaTables20260815000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS curriculum_document (
        id CHAR(36) NOT NULL,
        curriculum_id CHAR(36) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        title VARCHAR(255) NULL,
        content_type ENUM('Reference') NOT NULL DEFAULT 'Reference',
        storage_key VARCHAR(512) NOT NULL,
        file_hash CHAR(64) NOT NULL,
        page_count INT NULL,
        chunk_count INT NOT NULL DEFAULT 0,
        uploaded_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        KEY ix_doc_cur (curriculum_id),
        KEY ix_doc_hash (file_hash),
        CONSTRAINT fk_doc_cur FOREIGN KEY (curriculum_id) REFERENCES curriculum(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS stored_image (
        id CHAR(36) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        original_file_name VARCHAR(255) NULL,
        content_type VARCHAR(100) NOT NULL,
        file_size INT NOT NULL,
        file_hash CHAR(64) NOT NULL,
        storage_key VARCHAR(512) NOT NULL,
        source_page_number INT NULL,
        source_document_id CHAR(36) NULL,
        generated_alt_text VARCHAR(500) NULL,
        width INT NULL,
        height INT NULL,
        extracted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        usage_count INT NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        UNIQUE KEY uq_image_hash (file_hash)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS question_image (
        id CHAR(36) NOT NULL,
        generated_question_id CHAR(36) NOT NULL,
        image_id CHAR(36) NOT NULL,
        sequence_order INT NULL,
        caption VARCHAR(500) NULL,
        alt_text VARCHAR(500) NOT NULL,
        position ENUM('question_text','option','explanation') NOT NULL,
        option_key VARCHAR(10) NULL,
        width INT NULL,
        height INT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_qi (generated_question_id, image_id, position, option_key),
        KEY ix_qi_image (image_id),
        CONSTRAINT fk_qi_gq FOREIGN KEY (generated_question_id) REFERENCES generated_question(id) ON DELETE CASCADE,
        CONSTRAINT fk_qi_img FOREIGN KEY (image_id) REFERENCES stored_image(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse dependency order: `question_image` FKs both of the others.
    await queryRunner.query(`DROP TABLE IF EXISTS question_image`);
    await queryRunner.query(`DROP TABLE IF EXISTS stored_image`);
    await queryRunner.query(`DROP TABLE IF EXISTS curriculum_document`);
  }
}
