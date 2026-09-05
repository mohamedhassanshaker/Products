import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import type { ProviderCategory } from '../domain/provider';
import { PROVIDER_CREDENTIAL_REPOSITORY, type ProviderCredentialRepositoryPort } from '../domain/ports';
import { toProviderCredentialDto } from './provider-dto';

/** `GET /tenants/:id/provider-credentials` (FR-PROVIDER-2). */
@Injectable()
export class ListProviderCredentialsUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(PROVIDER_CREDENTIAL_REPOSITORY) private readonly credentials: ProviderCredentialRepositoryPort,
  ) {}

  /**
   * @param actor - Authenticated admin
   * @param tenantId - Path tenant id
   * @param query - Optional category/provider_key filters
   */
  async execute(
    actor: AdminActor,
    tenantId: string,
    query: { category?: ProviderCategory; provider_key?: string },
  ) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant || !canAccessTenant(actor, tenant.id)) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    const rows = await this.credentials.list(tenantId, {
      category: query.category,
      providerKey: query.provider_key,
    });
    return { items: rows.map(toProviderCredentialDto) };
  }
}
