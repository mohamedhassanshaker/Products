import { Inject, Injectable } from '@nestjs/common';
import type { UpdateReviewerGroupRequest } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { REVIEWER_GROUP_REPOSITORY, type ReviewerGroupRepositoryPort, type UpdateReviewerGroupInput } from '../domain/ports';
import { toReviewerGroupDto } from './reviewer-group-dto';

/** `PATCH /tenants/:id/hitl/reviewer-groups/:groupId` (BL-052). */
@Injectable()
export class UpdateReviewerGroupUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(REVIEWER_GROUP_REPOSITORY) private readonly reviewerGroups: ReviewerGroupRepositoryPort,
  ) {}

  async execute(actor: AdminActor, tenantId: string, groupId: string, input: UpdateReviewerGroupRequest) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }
    const existing = await this.reviewerGroups.findById(tenantId, groupId);
    if (!existing) {
      throw AppError.notFound('HITL_REVIEWER_GROUP_NOT_FOUND');
    }

    const patch: UpdateReviewerGroupInput = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name.length < 1 || name.length > 80) {
        throw AppError.badRequest('HITL_REVIEWER_GROUP_NAME_REQUIRED');
      }
      if (name !== existing.name) {
        const conflict = await this.reviewerGroups.findByName(tenantId, name);
        if (conflict) {
          throw AppError.conflict('HITL_REVIEWER_GROUP_NAME_EXISTS');
        }
      }
      patch.name = name;
    }
    if (input.members !== undefined) {
      patch.members = input.members;
    }
    if (input.notification_channels !== undefined) {
      patch.notificationChannels = input.notification_channels;
    }

    const updated = await this.reviewerGroups.update(tenantId, groupId, patch);
    if (!updated) {
      throw AppError.notFound('HITL_REVIEWER_GROUP_NOT_FOUND');
    }
    return toReviewerGroupDto(updated);
  }
}
