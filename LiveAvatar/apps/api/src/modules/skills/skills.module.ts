import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants';
import { ToolsModule } from '../tools';
import { HitlModule } from '../hitl';
import { SKILL_REPOSITORY } from './domain/ports';
import { PrismaSkillRepository } from './infrastructure/prisma-skill.repository';
import { CreateSkillUseCase } from './application/create-skill.use-case';
import { ListSkillsUseCase } from './application/list-skills.use-case';
import { GetSkillUseCase } from './application/get-skill.use-case';
import { UpdateSkillDraftUseCase } from './application/update-skill-draft.use-case';
import { PublishSkillUseCase } from './application/publish-skill.use-case';
import { DeleteSkillUseCase } from './application/delete-skill.use-case';
import { GetSkillUsageUseCase } from './application/get-skill-usage.use-case';
import { GetSkillBodyUseCase } from './application/get-skill-body.use-case';
import { SkillsController } from './interface/skills.controller';

/**
 * `Skill`/`SkillVersion` bounded context (Phase 13, BL-049/050/051),
 * mirroring `ToolsModule`'s shape exactly. Imports `ToolsModule` for
 * `TOOL_DEFINITION_REPOSITORY` (publish-time tool-ref validation, and the
 * internal body endpoint's tool-definition enrichment) — one-directional,
 * same precedent `deployment-config` already sets by importing both
 * `tools`/`knowledge`.
 */
@Module({
  imports: [TenantsModule, ToolsModule, HitlModule],
  controllers: [SkillsController],
  providers: [
    PrismaSkillRepository,
    { provide: SKILL_REPOSITORY, useExisting: PrismaSkillRepository },
    CreateSkillUseCase,
    ListSkillsUseCase,
    GetSkillUseCase,
    UpdateSkillDraftUseCase,
    PublishSkillUseCase,
    DeleteSkillUseCase,
    GetSkillUsageUseCase,
    GetSkillBodyUseCase,
  ],
  // `SKILL_REPOSITORY` is consumed by `deployment-config` (V-11/V-12) and
  // `sessions` (`GetRuntimeConfigUseCase`'s skill-ref resolution);
  // `GetSkillBodyUseCase` is injected directly by `InternalModule`'s new
  // `SkillsInternalController` — same "export the use-case, not the
  // controller" precedent `KnowledgeModule` already sets for
  // `SearchKnowledgeUseCase`/`RecordKnowledgeGapUseCase`.
  exports: [SKILL_REPOSITORY, GetSkillBodyUseCase],
})
export class SkillsModule {}
