import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * TypeORM mapping for the tenant-schema `question_image` table (migration plan Phase 6, sub-slice
 * "6b", migration `20260815000008-create-curriculum-document-and-media-tables.ts`) — ported from
 * `legacy/api/src/modules/files/infrastructure/entities/question-image.entity.ts`.
 *
 * One row per (generated question, image, position, option) association — that tuple is DB-unique
 * (`uq_qi`), which is what makes `ImageAssociationService.associateWithQuestion` idempotent at the
 * schema level rather than only by convention. `alt_text` is `NOT NULL` (FR-FILE-3's "required alt
 * text"); `caption` is optional. `position` is an inline literal union, matching this app's central-
 * entities convention of never importing a module's `domain/**` types into an entity file.
 */
@Entity({ name: 'question_image' })
export class QuestionImageEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'generated_question_id', type: 'char', length: 36 })
  generatedQuestionId!: string;

  @Column({ name: 'image_id', type: 'char', length: 36 })
  imageId!: string;

  @Column({ name: 'sequence_order', type: 'int', nullable: true })
  sequenceOrder!: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  caption!: string | null;

  @Column({ name: 'alt_text', type: 'varchar', length: 500 })
  altText!: string;

  @Column({ type: 'enum', enum: ['question_text', 'option', 'explanation'] })
  position!: 'question_text' | 'option' | 'explanation';

  @Column({ name: 'option_key', type: 'varchar', length: 10, nullable: true })
  optionKey!: string | null;

  @Column({ type: 'int', nullable: true })
  width!: number | null;

  @Column({ type: 'int', nullable: true })
  height!: number | null;
}
