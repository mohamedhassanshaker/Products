import { Inject, Injectable } from '@nestjs/common';
import type { CreateSkillRequest } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { deriveSkillSlug } from '../domain/skill';
import { SKILL_REPOSITORY, type SkillRepositoryPort } from '../domain/ports';
import { toSkillDto } from './skill-dto';

/** `POST /tenants/:id/skills` (BL-049/050) — creates the `Skill` row plus its v1 draft `SkillVersion` in one call. */
@Injectable()
export class CreateSkillUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(SKILL_REPOSITORY) private readonly skills: SkillRepositoryPort,
  ) {}

  /**
   * @param actor - Authenticated admin
   * @param tenantId - Path tenant id
   * @param input - Create-skill request body
   */
  async execute(actor: AdminActor, tenantId: string, input: CreateSkillRequest) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }

    const name = input.name.trim();
    if (name.length < 1 || name.length > 80) {
      throw AppError.badRequest('SKILL_NAME_REQUIRED');
    }
    const slug = deriveSkillSlug(name);
    const existing = await this.skills.findBySlug(tenantId, slug);
    if (existing) {
      throw AppError.conflict('SKILL_SLUG_EXISTS');
    }

    const created = await this.skills.create({
      tenantId,
      name,
      slug,
      description: input.description ?? '',
      instructions: input.instructions ?? '',
      triggerMode: input.trigger_mode ?? 'model',
      tools: input.tools ?? [],
      knowledgeFilters: {
        sourceRefs: input.knowledge_filters?.source_refs ?? [],
        topK: input.knowledge_filters?.top_k,
        minScore: input.knowledge_filters?.min_score,
      },
      budgetMs: input.budget_ms ?? 1500,
      hitlGateId: input.hitl_gate_id ?? null,
      environments: input.environments ?? ['dev', 'staging', 'production'],
      createdBy: actor.id,
    });
    return toSkillDto(created, 0);
  }
}
