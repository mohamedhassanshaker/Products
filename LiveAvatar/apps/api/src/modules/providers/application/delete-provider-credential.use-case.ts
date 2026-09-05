import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import {
  PROVIDER_CREDENTIAL_REPOSITORY,
  PUBLISHED_CONFIG_LOOKUP,
  type ProviderCredentialRepositoryPort,
  type PublishedConfigLookupPort,
} from '../domain/ports';

/** `DELETE /tenants/:id/provider-credentials/:credId` (FR-PROVIDER-2). */
@Injectable()
export class DeleteProviderCredentialUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(PROVIDER_CREDENTIAL_REPOSITORY) private readonly credentials: ProviderCredentialRepositoryPort,
    @Inject(PUBLISHED_CONFIG_LOOKUP) private readonly publishedConfigs: PublishedConfigLookupPort,
  ) {}

  /**
   * @param actor - Authenticated admin
   * @param tenantId - Path tenant id
   * @param credId - Credential id
   */
  async execute(actor: AdminActor, tenantId: string, credId: string): Promise<void> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }
    const existing = await this.credentials.findById(tenantId, credId);
    if (!existing) {
      throw AppError.notFound('PROVIDER_UNKNOWN');
    }

    const inUse = await this.publishedConfigs.isProviderInUse(tenantId, existing.providerKey);
    if (inUse) {
      throw new AppError('CONFIG_CREDENTIAL_MISSING', 422);
    }

    const deleted = await this.credentials.delete(tenantId, credId);
    if (!deleted) {
      throw AppError.notFound('PROVIDER_UNKNOWN');
    }
  }
}
