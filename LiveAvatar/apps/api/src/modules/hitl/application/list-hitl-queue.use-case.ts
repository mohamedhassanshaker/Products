import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { HITL_DECISION_REPOSITORY, type HitlDecisionRepositoryPort } from '../domain/ports';
import { toHitlDecisionDto } from './hitl-decision-dto';

/** `GET /tenants/:id/hitl/queue` (BL-055) — the reviewer console's pending queue, refetched on an interval by the client (`UX_SCOPE.md`: "no websocket needed for v1"). */
@Injectable()
export class ListHitlQueueUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(HITL_DECISION_REPOSITORY) private readonly decisions: HitlDecisionRepositoryPort,
  ) {}

  async execute(actor: AdminActor, tenantId: string) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }
    const items = await this.decisions.listPendingByTenant(tenantId);
    return { items: items.map(toHitlDecisionDto) };
  }
}
