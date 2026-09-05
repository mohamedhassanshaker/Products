import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  CreateProviderCredentialRequest,
  ProbeResultDto,
  ProviderCredentialDto,
  ProviderDefinitionDto,
  SetProviderDefinitionEnabledRequest,
  UpdateProviderCredentialRequest,
} from '@liveavatar/contracts';
import { ProvidersApiService, createIdempotencyKey } from '@liveavatar/web-shared';

/**
 * Feature-scoped HTTP facade over `ProvidersApiService` (LLD §3.2 feature
 * rule) — owns idempotency-key minting for credential create.
 */
@Injectable({ providedIn: 'root' })
export class ProviderRegistryService {
  private readonly api = inject(ProvidersApiService);

  listDefinitions(): Observable<{ items: ProviderDefinitionDto[] }> {
    return this.api.listDefinitions();
  }

  setDefinitionEnabled(key: string, body: SetProviderDefinitionEnabledRequest): Observable<ProviderDefinitionDto> {
    return this.api.setDefinitionEnabled(key, body);
  }

  listCredentials(tenantId: string): Observable<{ items: ProviderCredentialDto[] }> {
    return this.api.listCredentials(tenantId);
  }

  createCredential(tenantId: string, body: CreateProviderCredentialRequest): Observable<ProviderCredentialDto> {
    return this.api.createCredential(tenantId, body, createIdempotencyKey());
  }

  updateCredential(
    tenantId: string,
    credId: string,
    body: UpdateProviderCredentialRequest,
    ifMatch: string,
  ): Observable<ProviderCredentialDto> {
    return this.api.updateCredential(tenantId, credId, body, ifMatch);
  }

  deleteCredential(tenantId: string, credId: string): Observable<void> {
    return this.api.deleteCredential(tenantId, credId);
  }

  probeCredential(tenantId: string, credId: string): Observable<ProbeResultDto> {
    return this.api.probeCredential(tenantId, credId);
  }
}
