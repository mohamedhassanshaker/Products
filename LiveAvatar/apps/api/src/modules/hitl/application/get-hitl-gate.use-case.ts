import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { HITL_GATE_REPOSITORY, type HitlGateRepositoryPort } from '../domain/ports';
import { toHitlGateDto } from './hitl-gate-dto';

/** `GET /tenants/:id/hitl/gates/:gateId` (BL-052/054). */
@Injectable()
export class GetHitlGateUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(HITL_GATE_REPOSITORY) private readonly gates: HitlGateRepositoryPort,
  ) {}

  async execute(actor: AdminActor, tenantId: string, gateId: string) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }
    const gate = await this.gates.findById(tenantId, gateId);
    if (!gate) {
      throw AppError.notFound('HITL_GATE_NOT_FOUND');
    }
    return toHitlGateDto(gate);
  }
}
