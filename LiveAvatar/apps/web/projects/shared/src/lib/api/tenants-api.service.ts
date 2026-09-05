import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  ChangeTenantStatusRequest,
  CreateTenantRequest,
  ListTenantsQuery,
  TenantDto,
  TenantListItemDto,
  UpdateTenantRequest,
} from '@liveavatar/contracts';
import { API_BASE_URL } from './api-base-url.token';

/** `GET /api/tenants` collection envelope (LLD §4.4 `CollectionSchema<TenantListItem>`). */
export interface TenantListResponse {
  items: TenantListItemDto[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * Typed HTTP client for the tenants surface (Screen 3 / FR-TENANT-*).
 * Header names mirror `packages/contracts` common envelope constants.
 */
@Injectable({ providedIn: 'root' })
export class TenantsApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** GET /api/tenants */
  list(query: ListTenantsQuery): Observable<TenantListResponse> {
    let params = new HttpParams();
    if (query.q) {
      params = params.set('q', query.q);
    }
    if (query.status) {
      params = params.set('status', query.status);
    }
    params = params.set('page', String(query.page ?? 1));
    params = params.set('page_size', String(query.page_size ?? 25));
    return this.http.get<TenantListResponse>(`${this.baseUrl}/tenants`, { params });
  }

  /** GET /api/tenants/{id} */
  get(id: string): Observable<TenantDto> {
    return this.http.get<TenantDto>(`${this.baseUrl}/tenants/${id}`);
  }

  /** POST /api/tenants (operator role, fresh Idempotency-Key per FR-TENANT-1). */
  create(body: CreateTenantRequest, idempotencyKey: string): Observable<TenantDto> {
    return this.http.post<TenantDto>(`${this.baseUrl}/tenants`, body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  /** PATCH /api/tenants/{id} — `If-Match` is the resource's current `updated_at` (FR-TENANT-3). */
  update(id: string, body: UpdateTenantRequest, ifMatch: string): Observable<TenantDto> {
    return this.http.patch<TenantDto>(`${this.baseUrl}/tenants/${id}`, body, {
      headers: { 'If-Match': ifMatch },
    });
  }

  /** POST /api/tenants/{id}/status (operator role, FR-TENANT-4). */
  changeStatus(id: string, body: ChangeTenantStatusRequest): Observable<TenantDto> {
    return this.http.post<TenantDto>(`${this.baseUrl}/tenants/${id}/status`, body);
  }
}
