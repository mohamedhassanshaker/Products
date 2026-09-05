import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { REVIEWER_GROUP_REPOSITORY, type ReviewerGroupRepositoryPort } from '../domain/ports';
import { toReviewerGroupDto } from './reviewer-group-dto';

/** `GET /tenants/:id/hitl/reviewer-groups` (BL-052). */
@Injectable()
export class ListReviewerGroupsUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(REVIEWER_GROUP_REPOSITORY) private readonly reviewerGroups: ReviewerGroupRepositoryPort,
  ) {}

  async execute(actor: AdminActor, tenantId: string) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }
    const items = await this.reviewerGroups.listByTenant(tenantId);
    return { items: items.map(toReviewerGroupDto) };
  }
}
