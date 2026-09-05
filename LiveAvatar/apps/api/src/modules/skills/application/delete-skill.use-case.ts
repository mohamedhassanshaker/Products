import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { SKILL_REPOSITORY, type SkillRepositoryPort } from '../domain/ports';

/**
 * `DELETE /tenants/:id/skills/:skillId` (BL-049/050). Deliberately does not
 * block deleting a skill still referenced by an agent's `skills[]`/a
 * `skill`-type graph node — same documented simplification
 * `DeleteToolUseCase` already established for `ToolDefinition`: V-12
 * (`skillRefsKnownAndEnabledRule`) catches the dangling reference the next
 * time that config is validated/published.
 */
@Injectable()
export class DeleteSkillUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(SKILL_REPOSITORY) private readonly skills: SkillRepositoryPort,
  ) {}

  async execute(actor: AdminActor, tenantId: string, skillId: string): Promise<void> {
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
    const deleted = await this.skills.delete(tenantId, skillId);
    if (!deleted) {
      throw AppError.notFound('SKILL_NOT_FOUND');
    }
  }
}
