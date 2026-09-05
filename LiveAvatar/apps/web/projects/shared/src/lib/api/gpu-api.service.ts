import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { ListGpuNodesQuery, ListGpuNodesResponse } from '@liveavatar/contracts';
import { API_BASE_URL } from './api-base-url.token';

/** Typed HTTP client for the GPU/node health monitor (Screen 6, FR-GPU-1/2/3). */
@Injectable({ providedIn: 'root' })
export class GpuApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** GET /api/gpu/nodes */
  list(query: ListGpuNodesQuery = {}): Observable<ListGpuNodesResponse> {
    let params = new HttpParams();
    if (query.role) {
      params = params.set('role', query.role);
    }
    if (query.tenant_id) {
      params = params.set('tenant_id', query.tenant_id);
    }
    return this.http.get<ListGpuNodesResponse>(`${this.baseUrl}/gpu/nodes`, { params });
  }
}
