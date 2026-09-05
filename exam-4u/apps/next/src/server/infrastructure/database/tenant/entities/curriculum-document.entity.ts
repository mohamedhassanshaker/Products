import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * TypeORM mapping for the tenant-schema `curriculum_document` table (migration plan Phase 6,
 * sub-slice "6b", migration `20260815000008-create-curriculum-document-and-media-tables.ts`) — ported
 * from `legacy/api/src/modules/curricula/infrastructure/entities/curriculum-document.entity.ts`.
 *
 * Phase 3 deliberately deferred this table until its first real writer existed (see
 * `docs/plans/nextjs-rewrite-phase3-plan.md`'s "curricula scope-split judgment call"): its
 * `page_count`/`chunk_count`/`content_type` columns are products of a text-extraction/chunking/
 * embedding pipeline that only came into existence with Phase 5's vector infrastructure and Phase 6's
 * PDF text extraction. It is created here, alongside its two genuine writers — `CurriculaService`'s
 * document-upload ingestion (FR-CUR-2) and `ReferenceIndexingService` (FR-PDF-6).
 *
 * `contentType` is an inline literal union (`'Reference'`), never an import from a module's
 * `domain/**` — this app's established central-entities convention (see `PdfProcessingSessionEntity`).
 * `storageKey` points at an object the *caller* already wrote (the Reference branch reuses the PDF
 * session's own `source_storage_key` verbatim rather than re-storing the same bytes twice).
 */
@Entity({ name: 'curriculum_document' })
export class CurriculumDocumentEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'curriculum_id', type: 'char', length: 36 })
  curriculumId!: string;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title!: string | null;

  @Column({ name: 'content_type', type: 'enum', enum: ['Reference'], default: 'Reference' })
  contentType!: 'Reference';

  @Column({ name: 'storage_key', type: 'varchar', length: 512 })
  storageKey!: string;

  @Column({ name: 'file_hash', type: 'char', length: 64 })
  fileHash!: string;

  @Column({ name: 'page_count', type: 'int', nullable: true })
  pageCount!: number | null;

  @Column({ name: 'chunk_count', type: 'int', default: 0 })
  chunkCount!: number;

  @CreateDateColumn({ name: 'uploaded_at', type: 'datetime', precision: 3 })
  uploadedAt!: Date;
}
