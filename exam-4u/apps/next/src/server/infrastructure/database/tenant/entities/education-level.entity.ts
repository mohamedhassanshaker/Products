import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * TypeORM mapping for the tenant-schema `education_level` table (Phase 3, migration
 * `20260815000003-create-taxonomy-tables.ts`) — ported verbatim from
 * `legacy/api/src/modules/taxonomy/infrastructure/entities/education-level.entity.ts`. Top level of
 * the FR-TAX-1 hierarchy `Education Level -> Stage -> Subject`. `uq_edu_name`'s case-insensitive
 * uniqueness comes entirely from the table's `utf8mb4_0900_ai_ci` collation (see the migration's own
 * doc comment) — nothing in this entity needs to normalize case itself.
 */
@Entity({ name: 'education_level' })
export class EducationLevelEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}
