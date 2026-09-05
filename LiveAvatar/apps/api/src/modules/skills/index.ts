/** Public API of the skills module. */
export { SkillsModule } from './skills.module';
export { SKILL_REPOSITORY } from './domain/ports';
export type {
  SkillRepositoryPort,
  CreateSkillInput,
  UpdateSkillDraftInput,
  PublishedSkillSummaryRecord,
  ResolvedSkillVersionRecord,
  SkillBodyRecord,
} from './domain/ports';
export type {
  SkillRecord,
  SkillVersionRecord,
  SkillWithVersionsRecord,
  SkillKnowledgeFilterRecord,
  SkillTriggerMode,
  SkillVersionStatus,
} from './domain/skill';
export { GetSkillBodyUseCase } from './application/get-skill-body.use-case';
