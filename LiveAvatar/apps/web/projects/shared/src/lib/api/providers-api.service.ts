import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  CreateProviderCredentialRequest,
  ListProviderCredentialsQuery,
  ListProviderDefinitionsQuery,
  ProbeResultDto,
  ProviderCredentialDto,
  ProviderDefinitionDto,
  SetProviderDefinitionEnabledRequest,
  UpdateProviderCredentialRequest,
} from '@liveavatar/contracts';
import { API_BASE_URL } from './api-base-url.token';

/** `GET /provider-definitions` collection envelope. */
export interface ProviderDefinitionListResponse {
  items: ProviderDefinitionDto[];
}

/** `GET /tenants/:id/provider-credentials` collection envelope. */
export interface ProviderCredentialListResponse {
  items: ProviderCredentialDto[];
}

/**
 * Typed HTTP client for the provider catalog + per-tenant credential
 * registry (Screen 4, FR-PROVIDER-1..7, LLD §5.4).
 */
@Injectable({ providedIn: 'root' })
export class ProvidersApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** GET /api/provider-definitions */
  listDefinitions(query: ListProviderDefinitionsQuery = {}): Observable<ProviderDefinitionListResponse> {
    let params = new HttpParams();
    if (query.category) {
      params = params.set('category', query.category);
    }
    if (query.enabled !== undefined) {
      params = params.set('enabled', String(query.enabled));
    }
    return this.http.get<ProviderDefinitionListResponse>(`${this.baseUrl}/provider-definitions`, { params });
  }

  /** PATCH /api/provider-definitions/{key} (operator only, FR-PROVIDER-1). */
  setDefinitionEnabled(key: string, body: SetProviderDefinitionEnabledRequest): Observable<ProviderDefinitionDto> {
    return this.http.patch<ProviderDefinitionDto>(`${this.baseUrl}/provider-definitions/${key}`, body);
  }

  /** GET /api/tenants/{id}/provider-credentials */
  listCredentials(
    tenantId: string,
    query: ListProviderCredentialsQuery = {},
  ): Observable<ProviderCredentialListResponse> {
    let params = new HttpParams();
    if (query.category) {
      params = params.set('category', query.category);
    }
    if (query.provider_key) {
      params = params.set('provider_key', query.provider_key);
    }
    return this.http.get<ProviderCredentialListResponse>(`${this.baseUrl}/tenants/${tenantId}/provider-credentials`, {
      params,
    });
  }

  /** POST /api/tenants/{id}/provider-credentials */
  createCredential(
    tenantId: string,
    body: CreateProviderCredentialRequest,
    idempotencyKey: string,
  ): Observable<ProviderCredentialDto> {
    return this.http.post<ProviderCredentialDto>(`${this.baseUrl}/tenants/${tenantId}/provider-credentials`, body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  /** PATCH /api/tenants/{id}/provider-credentials/{credId} */
  updateCredential(
    tenantId: string,
    credId: string,
    body: UpdateProviderCredentialRequest,
    ifMatch: string,
  ): Observable<ProviderCredentialDto> {
    return this.http.patch<ProviderCredentialDto>(
      `${this.baseUrl}/tenants/${tenantId}/provider-credentials/${credId}`,
      body,
      { headers: { 'If-Match': ifMatch } },
    );
  }

  /** DELETE /api/tenants/{id}/provider-credentials/{credId} */
  deleteCredential(tenantId: string, credId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/tenants/${tenantId}/provider-credentials/${credId}`);
  }

  /** POST /api/tenants/{id}/provider-credentials/{credId}/probe (FR-PROVIDER-3). */
  probeCredential(tenantId: string, credId: string): Observable<ProbeResultDto> {
    return this.http.post<ProbeResultDto>(
      `${this.baseUrl}/tenants/${tenantId}/provider-credentials/${credId}/probe`,
      {},
    );
  }
}
