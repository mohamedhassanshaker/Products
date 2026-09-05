import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { REVIEWER_GROUP_REPOSITORY, type ReviewerGroupRepositoryPort } from '../domain/ports';

/** `DELETE /tenants/:id/hitl/reviewer-groups/:groupId` (BL-052). */
@Injectable()
export class DeleteReviewerGroupUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(REVIEWER_GROUP_REPOSITORY) private readonly reviewerGroups: ReviewerGroupRepositoryPort,
  ) {}

  async execute(actor: AdminActor, tenantId: string, groupId: string): Promise<void> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }
    const deleted = await this.reviewerGroups.delete(tenantId, groupId);
    if (!deleted) {
      throw AppError.notFound('HITL_REVIEWER_GROUP_NOT_FOUND');
    }
  }
}
