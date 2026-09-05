import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  CreateSkillRequestSchema,
  UpdateSkillDraftRequestSchema,
  type CreateSkillRequest,
  type UpdateSkillDraftRequest,
} from '@liveavatar/contracts';
import { TypeBoxValidationPipe } from '../../../common/validation/typebox-pipe';
import { AdminJwtGuard } from '../../../common/auth/admin-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { CreateSkillUseCase } from '../application/create-skill.use-case';
import { ListSkillsUseCase } from '../application/list-skills.use-case';
import { GetSkillUseCase } from '../application/get-skill.use-case';
import { UpdateSkillDraftUseCase } from '../application/update-skill-draft.use-case';
import { PublishSkillUseCase } from '../application/publish-skill.use-case';
import { DeleteSkillUseCase } from '../application/delete-skill.use-case';
import { GetSkillUsageUseCase } from '../application/get-skill-usage.use-case';

/**
 * Skills registry HTTP surface (BL-049/050, `docs/v2/BACKLOG.md`). Nested
 * under `/tenants/:id` exactly like `tools`/`deployment-config` so the
 * global `TenantContextInterceptor` scopes every query correctly.
 */
@Controller('tenants/:id/skills')
@UseGuards(AdminJwtGuard, RolesGuard)
export class SkillsController {
  constructor(
    private readonly createSkill: CreateSkillUseCase,
    private readonly listSkills: ListSkillsUseCase,
    private readonly getSkill: GetSkillUseCase,
    private readonly updateSkillDraft: UpdateSkillDraftUseCase,
    private readonly publishSkill: PublishSkillUseCase,
    private readonly deleteSkill: DeleteSkillUseCase,
    private readonly getSkillUsage: GetSkillUsageUseCase,
  ) {}

  /** GET /api/tenants/:id/skills */
  @Get()
  list(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string) {
    return this.listSkills.execute(actor, tenantId);
  }

  /** POST /api/tenants/:id/skills */
  @Post()
  create(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @Body(new TypeBoxValidationPipe(CreateSkillRequestSchema, 'SKILL_NAME_REQUIRED'))
    body: CreateSkillRequest,
  ) {
    return this.createSkill.execute(actor, tenantId, body);
  }

  /** GET /api/tenants/:id/skills/:skillId */
  @Get(':skillId')
  get(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string, @Param('skillId') skillId: string) {
    return this.getSkill.execute(actor, tenantId, skillId);
  }

  /** GET /api/tenants/:id/skills/:skillId/usage — the pre-publish "used by N agents" warning (A5.3 UC-S2). */
  @Get(':skillId/usage')
  usage(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string, @Param('skillId') skillId: string) {
    return this.getSkillUsage.execute(actor, tenantId, skillId);
  }

  /** PATCH /api/tenants/:id/skills/:skillId/draft */
  @Patch(':skillId/draft')
  updateDraft(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @Param('skillId') skillId: string,
    @Body(new TypeBoxValidationPipe(UpdateSkillDraftRequestSchema, 'SKILL_NAME_REQUIRED'))
    body: UpdateSkillDraftRequest,
  ) {
    return this.updateSkillDraft.execute(actor, tenantId, skillId, body);
  }

  /** POST /api/tenants/:id/skills/:skillId/publish */
  @Post(':skillId/publish')
  publish(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string, @Param('skillId') skillId: string) {
    return this.publishSkill.execute(actor, tenantId, skillId);
  }

  /** DELETE /api/tenants/:id/skills/:skillId */
  @Delete(':skillId')
  @HttpCode(204)
  async remove(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string, @Param('skillId') skillId: string) {
    await this.deleteSkill.execute(actor, tenantId, skillId);
  }
}
