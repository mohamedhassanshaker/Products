import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * TypeORM mapping for the tenant-schema `curriculum` table (Phase 3, migration
 * `20260815000004-create-curriculum-table.ts`) — ported from
 * `legacy/api/src/modules/curricula/infrastructure/entities/curriculum.entity.ts`, **ownership/
 * metadata columns only**. `curriculum_document` (and every column that would only ever be populated
 * by the document-ingestion pipeline) is deliberately not part of this phase's schema at all — see
 * `docs/plans/nextjs-rewrite-phase3-plan.md`'s "The curricula scope-split judgment call" for the full
 * reasoning (Phase 5/6 add that table once the vector/embeddings infrastructure it depends on exists).
 *
 * `ownerUserId` is a **soft reference** (no FK to `user(id)`) — matches FR-IAM-7's "a deleted user's
 * created content is retained, not cascade-deleted" rule, ported verbatim from legacy's identical DDL
 * comment. `subjectId` **is** a real FK (`ON DELETE RESTRICT`) — a Subject still referenced by a
 * Curriculum cannot be deleted, mirroring `TaxonomyService`'s own FR-TAX-4 enforcement.
 */
@Entity({ name: 'curriculum' })
export class CurriculumEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description!: string | null;

  @Column({ name: 'subject_id', type: 'int' })
  subjectId!: number;

  @Column({ name: 'owner_user_id', type: 'char', length: 36 })
  ownerUserId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt!: Date;
}
