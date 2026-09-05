import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import {
  PROVIDER_CREDENTIAL_REPOSITORY,
  PROVIDER_DEFINITION_REPOSITORY,
  type ProviderCredentialRepositoryPort,
  type ProviderDefinitionRepositoryPort,
} from '../domain/ports';
import { assertEndpointUrl, assertNoSecretInExtra } from '../domain/validation';
import { toProviderCredentialDto } from './provider-dto';

/** `POST /tenants/:id/provider-credentials` (FR-PROVIDER-2). */
@Injectable()
export class CreateProviderCredentialUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(PROVIDER_DEFINITION_REPOSITORY) private readonly definitions: ProviderDefinitionRepositoryPort,
    @Inject(PROVIDER_CREDENTIAL_REPOSITORY) private readonly credentials: ProviderCredentialRepositoryPort,
  ) {}

  /**
   * @param actor - Authenticated admin
   * @param tenantId - Path tenant id
   * @param input - provider_key, endpoint_url, optional credential_ref/display_label/extra
   */
  async execute(
    actor: AdminActor,
    tenantId: string,
    input: {
      provider_key: string;
      endpoint_url: string;
      credential_ref?: string;
      display_label?: string;
      extra?: Record<string, unknown>;
    },
  ) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }

    const definition = await this.definitions.findByKey(input.provider_key);
    if (!definition) {
      throw AppError.notFound('PROVIDER_UNKNOWN');
    }

    const endpointUrl = assertEndpointUrl(input.endpoint_url, definition.hosting);
    const extra = assertNoSecretInExtra(input.extra);
    const displayLabel = input.display_label ?? 'default';

    const existing = await this.credentials.findByLabel(tenantId, input.provider_key, displayLabel);
    if (existing) {
      throw AppError.conflict('PROVIDER_CREDENTIAL_EXISTS');
    }

    const created = await this.credentials.create({
      tenantId,
      providerKey: input.provider_key,
      displayLabel,
      endpointUrl,
      credentialRef: input.credential_ref ?? null,
      extra,
    });
    return toProviderCredentialDto(created);
  }
}
