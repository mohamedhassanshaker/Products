import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { SKILL_REPOSITORY, type SkillRepositoryPort } from '../domain/ports';

/**
 * `GET /tenants/:id/skills/:skillId/usage` (BL-049/050) — the pre-publish
 * "used by N agents" warning (A5.3 UC-S2), fetched by the editor before
 * opening the publish confirm dialog so the admin sees the affected-agents
 * count before committing, not just after.
 */
@Injectable()
export class GetSkillUsageUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(SKILL_REPOSITORY) private readonly skills: SkillRepositoryPort,
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
    const usage = await this.skills.agentUsageCounts(tenantId, [skillId]);
    return { used_by_agent_count: usage.get(skillId) ?? 0 };
  }
}
