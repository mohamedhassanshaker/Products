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

/** `PATCH /tenants/:id/provider-credentials/:credId` (FR-PROVIDER-2). */
@Injectable()
export class UpdateProviderCredentialUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(PROVIDER_CREDENTIAL_REPOSITORY) private readonly credentials: ProviderCredentialRepositoryPort,
    @Inject(PROVIDER_DEFINITION_REPOSITORY) private readonly definitions: ProviderDefinitionRepositoryPort,
  ) {}

  /**
   * @param actor - Authenticated admin
   * @param tenantId - Path tenant id
   * @param credId - Credential id
   * @param input - Partial fields
   * @param ifMatch - Required `If-Match` header value (ISO `updated_at`)
   */
  async execute(
    actor: AdminActor,
    tenantId: string,
    credId: string,
    input: {
      endpoint_url?: string;
      credential_ref?: string;
      display_label?: string;
      extra?: Record<string, unknown>;
    },
    ifMatch: string,
  ) {
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

    const patch: Partial<{
      endpointUrl: string;
      credentialRef: string | null;
      displayLabel: string;
      extra: Record<string, unknown>;
    }> = {};
    if (input.endpoint_url !== undefined) {
      const definition = await this.definitions.findByKey(existing.providerKey);
      patch.endpointUrl = assertEndpointUrl(input.endpoint_url, definition?.hosting ?? 'remote');
    }
    if (input.credential_ref !== undefined) {
      patch.credentialRef = input.credential_ref;
    }
    if (input.display_label !== undefined) {
      patch.displayLabel = input.display_label;
    }
    if (input.extra !== undefined) {
      patch.extra = assertNoSecretInExtra(input.extra);
    }

    const ifMatchDate = new Date(ifMatch);
    if (Number.isNaN(ifMatchDate.getTime())) {
      throw AppError.conflict('CONFIG_CONFLICT');
    }

    const result = await this.credentials.update(tenantId, credId, patch, ifMatchDate);
    if (result === 'missing') {
      throw AppError.notFound('PROVIDER_UNKNOWN');
    }
    if (result === 'conflict') {
      throw AppError.conflict('CONFIG_CONFLICT');
    }
    return toProviderCredentialDto(result);
  }
}
