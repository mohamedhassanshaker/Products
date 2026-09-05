import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * TypeORM mapping for the tenant-schema `stored_image` table (migration plan Phase 6, sub-slice "6b",
 * migration `20260815000008-create-curriculum-document-and-media-tables.ts`) — ported from
 * `legacy/api/src/modules/files/infrastructure/entities/stored-image.entity.ts`.
 *
 * One row per distinct image *content* in the tenant (`file_hash` is DB-unique, `uq_image_hash`) —
 * FR-PDF-11's content-hash dedup guarantee is enforced at the schema level, not just in application
 * code. `usage_count` is the reference count `ImageAssociationService` increments/decrements exactly
 * once per `question_image` association, and the row is deleted only when it reaches zero.
 */
@Entity({ name: 'stored_image' })
export class StoredImageEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName!: string;

  @Column({ name: 'original_file_name', type: 'varchar', length: 255, nullable: true })
  originalFileName!: string | null;

  @Column({ name: 'content_type', type: 'varchar', length: 100 })
  contentType!: string;

  @Column({ name: 'file_size', type: 'int' })
  fileSize!: number;

  @Column({ name: 'file_hash', type: 'char', length: 64 })
  fileHash!: string;

  @Column({ name: 'storage_key', type: 'varchar', length: 512 })
  storageKey!: string;

  @Column({ name: 'source_page_number', type: 'int', nullable: true })
  sourcePageNumber!: number | null;

  @Column({ name: 'source_document_id', type: 'char', length: 36, nullable: true })
  sourceDocumentId!: string | null;

  /** The WCAG alt text produced by vision captioning (`ImageCaptioningService`), or `null` when
   * captioning never ran/failed — also the "already captioned, never re-caption identical bytes" flag
   * `ImageExtractionService` checks after a hash-dedup reuse. */
  @Column({ name: 'generated_alt_text', type: 'varchar', length: 500, nullable: true })
  generatedAltText!: string | null;

  @Column({ type: 'int', nullable: true })
  width!: number | null;

  @Column({ type: 'int', nullable: true })
  height!: number | null;

  @CreateDateColumn({ name: 'extracted_at', type: 'datetime', precision: 3 })
  extractedAt!: Date;

  @Column({ name: 'usage_count', type: 'int', default: 0 })
  usageCount!: number;
}
