import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  DeploymentConfigDto,
  SaveConfigRequest,
  TestCallRequest,
  TestCallResponseDto,
  ValidateConfigRequest,
  ValidateConfigResponseDto,
} from '@liveavatar/contracts';
import { API_BASE_URL } from './api-base-url.token';

/**
 * Typed HTTP client for Agent Builder / deployment config (Screen 2,
 * FR-CONFIG-1..5, LLD §5.5).
 */
@Injectable({ providedIn: 'root' })
export class DeploymentConfigApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** GET /api/tenants/{id}/config */
  get(tenantId: string): Observable<DeploymentConfigDto> {
    return this.http.get<DeploymentConfigDto>(`${this.baseUrl}/tenants/${tenantId}/config`);
  }

  /** POST /api/tenants/{id}/config/validate — always 200 (FR-CONFIG-4). */
  validate(tenantId: string, body: ValidateConfigRequest): Observable<ValidateConfigResponseDto> {
    return this.http.post<ValidateConfigResponseDto>(`${this.baseUrl}/tenants/${tenantId}/config/validate`, body);
  }

  /** PUT /api/tenants/{id}/config (FR-CONFIG-3). */
  save(tenantId: string, body: SaveConfigRequest, ifMatch: string): Observable<DeploymentConfigDto> {
    return this.http.put<DeploymentConfigDto>(`${this.baseUrl}/tenants/${tenantId}/config`, body, {
      headers: { 'If-Match': ifMatch },
    });
  }

  /**
   * POST /api/tenants/{id}/config/test-call (Phase 9, BL-037) — runs the
   * shared "Test call" harness against a draft config: a NestJS-side
   * structural simulation of the reasoning graph, not a live model/vendor
   * call (see `TestCallResponseSchema` doc comment). Deliberately generic
   * over the caller (Reasoning tab today; Skills/Knowledge playground later
   * per the plan doc) — this client has no feature-specific naming.
   */
  testCall(tenantId: string, body: TestCallRequest): Observable<TestCallResponseDto> {
    return this.http.post<TestCallResponseDto>(`${this.baseUrl}/tenants/${tenantId}/config/test-call`, body);
  }
}
