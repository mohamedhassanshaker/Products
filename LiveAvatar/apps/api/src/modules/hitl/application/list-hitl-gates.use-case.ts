import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { HITL_GATE_REPOSITORY, type HitlGateRepositoryPort } from '../domain/ports';
import { toHitlGateDto } from './hitl-gate-dto';

/** `GET /tenants/:id/hitl/gates` (BL-052/054). */
@Injectable()
export class ListHitlGatesUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(HITL_GATE_REPOSITORY) private readonly gates: HitlGateRepositoryPort,
  ) {}

  async execute(actor: AdminActor, tenantId: string) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }
    const items = await this.gates.listByTenant(tenantId);
    return { items: items.map(toHitlGateDto) };
  }
}
