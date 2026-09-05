import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { KNOWLEDGE_SOURCE_REPOSITORY, type KnowledgeSourceRepositoryPort } from '../domain/ports';

/** `DELETE /tenants/:id/knowledge-sources/:sourceId`. */
@Injectable()
export class DeleteKnowledgeSourceUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(KNOWLEDGE_SOURCE_REPOSITORY) private readonly sources: KnowledgeSourceRepositoryPort,
  ) {}

  /**
   * @param actor - Authenticated admin
   * @param tenantId - Path tenant id
   * @param sourceId - Knowledge source id
   */
  async execute(actor: AdminActor, tenantId: string, sourceId: string): Promise<void> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }
    const existing = await this.sources.findById(tenantId, sourceId);
    if (!existing) {
      throw AppError.notFound('KNOWLEDGE_SOURCE_NOT_FOUND');
    }
    const deleted = await this.sources.delete(tenantId, sourceId);
    if (!deleted) {
      throw AppError.notFound('KNOWLEDGE_SOURCE_NOT_FOUND');
    }
  }
}
