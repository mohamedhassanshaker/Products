import { Column, Entity, PrimaryColumn } from 'typeorm';

/** TypeORM mapping for the tenant-schema `exam_module` table (Phase 4) — ported from
 * `legacy/api/src/modules/exam-authoring/infrastructure/entities/exam-module.entity.ts`. `examTypeId`
 * is a plain FK column — this entity is always loaded/written scoped to one `ExamTypeEntity` via
 * `ExamAuthoringRepository`, never independently, so a relation object would add join overhead with no
 * consumer (same judgment call as `StageEntity.educationLevelId`). */
@Entity({ name: 'exam_module' })
export class ExamModuleEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'exam_type_id', type: 'char', length: 36 })
  examTypeId!: string;

  @Column({ name: 'module_name', type: 'varchar', length: 200 })
  moduleName!: string;

  @Column({ name: 'question_count', type: 'int' })
  questionCount!: number;
}
