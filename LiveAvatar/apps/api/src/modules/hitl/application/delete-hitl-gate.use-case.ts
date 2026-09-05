import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { HITL_GATE_REPOSITORY, type HitlGateRepositoryPort } from '../domain/ports';

/** `DELETE /tenants/:id/hitl/gates/:gateId` (BL-052/054). */
@Injectable()
export class DeleteHitlGateUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(HITL_GATE_REPOSITORY) private readonly gates: HitlGateRepositoryPort,
  ) {}

  async execute(actor: AdminActor, tenantId: string, gateId: string): Promise<void> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }
    const deleted = await this.gates.delete(tenantId, gateId);
    if (!deleted) {
      throw AppError.notFound('HITL_GATE_NOT_FOUND');
    }
  }
}
