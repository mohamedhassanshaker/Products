import { Inject, Injectable } from '@nestjs/common';
import type { CreateReviewerGroupRequest } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { REVIEWER_GROUP_REPOSITORY, type ReviewerGroupRepositoryPort } from '../domain/ports';
import { toReviewerGroupDto } from './reviewer-group-dto';

/** `POST /tenants/:id/hitl/reviewer-groups` (BL-052). */
@Injectable()
export class CreateReviewerGroupUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(REVIEWER_GROUP_REPOSITORY) private readonly reviewerGroups: ReviewerGroupRepositoryPort,
  ) {}

  async execute(actor: AdminActor, tenantId: string, input: CreateReviewerGroupRequest) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }

    const name = input.name.trim();
    if (name.length < 1 || name.length > 80) {
      throw AppError.badRequest('HITL_REVIEWER_GROUP_NAME_REQUIRED');
    }
    const existing = await this.reviewerGroups.findByName(tenantId, name);
    if (existing) {
      throw AppError.conflict('HITL_REVIEWER_GROUP_NAME_EXISTS');
    }

    const created = await this.reviewerGroups.create({
      tenantId,
      name,
      members: input.members ?? [],
      notificationChannels: input.notification_channels ?? [],
    });
    return toReviewerGroupDto(created);
  }
}
