import { Inject, Injectable } from '@nestjs/common';
import type { UpdateSkillDraftRequest } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { SKILL_REPOSITORY, type SkillRepositoryPort, type UpdateSkillDraftInput } from '../domain/ports';
import { toSkillDto } from './skill-dto';

/**
 * `PATCH /tenants/:id/skills/:skillId/draft` (BL-049/050). If the skill has
 * no current draft (it was just published and hasn't been edited since),
 * the repository auto-forks a new draft version from the published
 * content first — see `SkillRepositoryPort.updateDraft`'s doc comment.
 */
@Injectable()
export class UpdateSkillDraftUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(SKILL_REPOSITORY) private readonly skills: SkillRepositoryPort,
  ) {}

  async execute(actor: AdminActor, tenantId: string, skillId: string, input: UpdateSkillDraftRequest) {
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

    const patch: UpdateSkillDraftInput = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name.length < 1 || name.length > 80) {
        throw AppError.badRequest('SKILL_NAME_REQUIRED');
      }
      patch.name = name;
    }
    if (input.description !== undefined) {
      patch.description = input.description;
    }
    if (input.instructions !== undefined) {
      patch.instructions = input.instructions;
    }
    if (input.trigger_mode !== undefined) {
      patch.triggerMode = input.trigger_mode;
    }
    if (input.tools !== undefined) {
      patch.tools = input.tools;
    }
    if (input.knowledge_filters !== undefined) {
      patch.knowledgeFilters = {
        sourceRefs: input.knowledge_filters.source_refs,
        topK: input.knowledge_filters.top_k,
        minScore: input.knowledge_filters.min_score,
      };
    }
    if (input.budget_ms !== undefined) {
      patch.budgetMs = input.budget_ms;
    }
    if (input.hitl_gate_id !== undefined) {
      patch.hitlGateId = input.hitl_gate_id;
    }
    if (input.environments !== undefined) {
      patch.environments = input.environments;
    }

    const result = await this.skills.updateDraft(tenantId, skillId, patch, actor.id);
    if (result === 'missing') {
      throw AppError.notFound('SKILL_NOT_FOUND');
    }
    const usage = await this.skills.agentUsageCounts(tenantId, [skillId]);
    return toSkillDto(result, usage.get(skillId) ?? 0);
  }
}
