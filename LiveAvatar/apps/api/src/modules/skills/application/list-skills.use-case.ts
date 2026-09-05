import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { SKILL_REPOSITORY, type SkillRepositoryPort } from '../domain/ports';
import { toSkillDto } from './skill-dto';

/** `GET /tenants/:id/skills` (BL-049/050) — the Skills library table view. */
@Injectable()
export class ListSkillsUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(SKILL_REPOSITORY) private readonly skills: SkillRepositoryPort,
  ) {}

  async execute(actor: AdminActor, tenantId: string) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }
    const rows = await this.skills.listByTenant(tenantId);
    const usage = await this.skills.agentUsageCounts(
      tenantId,
      rows.map((r) => r.id),
    );
    return { items: rows.map((r) => toSkillDto(r, usage.get(r.id) ?? 0)) };
  }
}
