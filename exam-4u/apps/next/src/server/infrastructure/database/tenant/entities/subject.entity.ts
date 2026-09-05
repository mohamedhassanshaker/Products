import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * TypeORM mapping for the tenant-schema `subject` table (Phase 3, leaf level of the FR-TAX-1
 * hierarchy) — ported verbatim from
 * `legacy/api/src/modules/taxonomy/infrastructure/entities/subject.entity.ts`. Same "plain FK column,
 * no relation object" judgment call as {@link import('./stage.entity').StageEntity.educationLevelId}.
 */
@Entity({ name: 'subject' })
export class SubjectEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'stage_id', type: 'int' })
  stageId!: number;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}
