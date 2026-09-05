import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { SKILL_REPOSITORY, type SkillRepositoryPort } from '../domain/ports';
import { toSkillDto } from './skill-dto';

/** `GET /tenants/:id/skills/:skillId` (BL-049/050) — the Skill editor's own fetch (full draft body). */
@Injectable()
export class GetSkillUseCase {
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
    const skill = await this.skills.findById(tenantId, skillId);
    if (!skill) {
      throw AppError.notFound('SKILL_NOT_FOUND');
    }
    const usage = await this.skills.agentUsageCounts(tenantId, [skillId]);
    return toSkillDto(skill, usage.get(skillId) ?? 0);
  }
}
