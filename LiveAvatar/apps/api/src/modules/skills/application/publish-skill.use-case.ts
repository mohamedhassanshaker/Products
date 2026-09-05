import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { TOOL_DEFINITION_REPOSITORY, type ToolDefinitionRepositoryPort } from '../../tools';
import { HITL_GATE_REPOSITORY, type HitlGateRepositoryPort } from '../../hitl';
import { SKILL_REPOSITORY, type SkillRepositoryPort } from '../domain/ports';
import { validateSkillDraftForPublish } from '../domain/skill-validation';
import { toSkillDto } from './skill-dto';

/**
 * `POST /tenants/:id/skills/:skillId/publish` (BL-049/050) — runs the
 * skills module's own two-gate validator (`domain/skill-validation.ts`)
 * against the current draft, then flips it to `published` (immutable from
 * this point on, R-S3). Publishing an already-published skill with no
 * subsequent edit (no draft exists) is a `SKILL_NOT_FOUND`-adjacent
 * no-op-turned-error — mirrors `PublishDraft`'s own `'no-draft'` sentinel:
 * there is nothing new to publish.
 */
@Injectable()
export class PublishSkillUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(SKILL_REPOSITORY) private readonly skills: SkillRepositoryPort,
    @Inject(TOOL_DEFINITION_REPOSITORY) private readonly toolDefs: ToolDefinitionRepositoryPort,
    @Inject(HITL_GATE_REPOSITORY) private readonly hitlGates: HitlGateRepositoryPort,
  ) {}

  async execute(actor: AdminActor, tenantId: string, skillId: string) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }
    const existing = await this.skills.findById(tenantId, skillId);
    if (!existing) {
      throw AppError.notFound('SKILL_NOT_FOUND');
    }
    const draft = existing.draftVersion;
    if (!draft) {
      throw AppError.badRequest('SKILL_INSTRUCTIONS_REQUIRED', { reason: 'no pending draft to publish' });
    }

    const toolDefs = await this.toolDefs.listByTenant(tenantId);
    const knownApiRefs = new Set(toolDefs.map((t) => t.apiRef));
    const hitlGates = await this.hitlGates.listByTenant(tenantId);
    const knownHitlGateIds = new Set(hitlGates.map((g) => g.id));
    const issues = validateSkillDraftForPublish(draft, knownApiRefs, knownHitlGateIds);
    if (issues.length > 0) {
      const first = issues[0];
      throw new AppError(first.code, 422, { errors: issues });
    }

    const result = await this.skills.publishDraft(tenantId, skillId);
    if (result === 'missing' || result === 'no-draft') {
      throw AppError.notFound('SKILL_NOT_FOUND');
    }
    const usage = await this.skills.agentUsageCounts(tenantId, [skillId]);
    return { skill: toSkillDto(result, usage.get(skillId) ?? 0) };
  }
}
