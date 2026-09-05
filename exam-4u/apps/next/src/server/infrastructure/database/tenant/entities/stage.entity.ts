import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * TypeORM mapping for the tenant-schema `stage` table (Phase 3, middle level of the FR-TAX-1
 * hierarchy) — ported verbatim from
 * `legacy/api/src/modules/taxonomy/infrastructure/entities/stage.entity.ts`. `educationLevelId` is
 * deliberately a plain FK column, not a `@ManyToOne` relation object — `TaxonomyService` only ever
 * needs the id (to scope `uq_stage_name`'s within-parent uniqueness check and to validate the parent
 * exists before creating a child), never a hydrated `EducationLevelEntity` graph.
 */
@Entity({ name: 'stage' })
export class StageEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'education_level_id', type: 'int' })
  educationLevelId!: number;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}
