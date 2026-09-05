import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  ChangeTenantStatusRequest,
  CreateTenantRequest,
  ListTenantsQuery,
  TenantDto,
} from '@liveavatar/contracts';
import { TenantsApiService, type TenantListResponse, createIdempotencyKey } from '@liveavatar/web-shared';

/**
 * Feature-scoped HTTP facade over `TenantsApiService` (LLD §3.2 feature
 * rule: `services/` per feature). Owns idempotency-key minting for create
 * so the dialog component doesn't have to know about that header contract.
 */
@Injectable({ providedIn: 'root' })
export class DeploymentsService {
  private readonly api = inject(TenantsApiService);

  list(query: ListTenantsQuery): Observable<TenantListResponse> {
    return this.api.list(query);
  }

  get(id: string): Observable<TenantDto> {
    return this.api.get(id);
  }

  create(body: CreateTenantRequest): Observable<TenantDto> {
    return this.api.create(body, createIdempotencyKey());
  }

  rename(id: string, name: string, ifMatch: string): Observable<TenantDto> {
    return this.api.update(id, { name }, ifMatch);
  }

  changeStatus(id: string, body: ChangeTenantStatusRequest): Observable<TenantDto> {
    return this.api.changeStatus(id, body);
  }
}
