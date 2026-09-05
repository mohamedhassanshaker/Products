import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  CreateToolRequest,
  TestInvokeToolRequest,
  TestInvokeToolResultDto,
  ToolDto,
  UpdateToolRequest,
} from '@liveavatar/contracts';
import { API_BASE_URL } from './api-base-url.token';

/** `GET /tenants/:id/tools` collection envelope. */
export interface ToolListResponse {
  items: ToolDto[];
}

/**
 * Typed HTTP client for the tool registry (Tools tab, BL-033/034,
 * `docs/v2/BACKLOG.md`).
 */
@Injectable({ providedIn: 'root' })
export class ToolsApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** GET /api/tenants/{id}/tools */
  list(tenantId: string): Observable<ToolListResponse> {
    return this.http.get<ToolListResponse>(`${this.baseUrl}/tenants/${tenantId}/tools`);
  }

  /** GET /api/tenants/{id}/tools/{toolId} */
  get(tenantId: string, toolId: string): Observable<ToolDto> {
    return this.http.get<ToolDto>(`${this.baseUrl}/tenants/${tenantId}/tools/${toolId}`);
  }

  /** POST /api/tenants/{id}/tools */
  create(tenantId: string, body: CreateToolRequest): Observable<ToolDto> {
    return this.http.post<ToolDto>(`${this.baseUrl}/tenants/${tenantId}/tools`, body);
  }

  /** PATCH /api/tenants/{id}/tools/{toolId} */
  update(tenantId: string, toolId: string, body: UpdateToolRequest, ifMatch: string): Observable<ToolDto> {
    return this.http.patch<ToolDto>(`${this.baseUrl}/tenants/${tenantId}/tools/${toolId}`, body, {
      headers: { 'If-Match': ifMatch },
    });
  }

  /** DELETE /api/tenants/{id}/tools/{toolId} */
  delete(tenantId: string, toolId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/tenants/${tenantId}/tools/${toolId}`);
  }

  /** POST /api/tenants/{id}/tools/{toolId}/test-invoke */
  testInvoke(tenantId: string, toolId: string, body: TestInvokeToolRequest): Observable<TestInvokeToolResultDto> {
    return this.http.post<TestInvokeToolResultDto>(
      `${this.baseUrl}/tenants/${tenantId}/tools/${toolId}/test-invoke`,
      body,
    );
  }
}
