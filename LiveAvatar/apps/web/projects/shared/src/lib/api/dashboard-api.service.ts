import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { DashboardSummaryQuery, DashboardSummaryResponse, ProviderHealthResponse } from '@liveavatar/contracts';
import { API_BASE_URL } from './api-base-url.token';

/** Typed HTTP client for the Dashboard surface (Screen 1, FR-DASH-1/2). */
@Injectable({ providedIn: 'root' })
export class DashboardApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** GET /api/dashboard/summary */
  summary(query: DashboardSummaryQuery): Observable<DashboardSummaryResponse> {
    let params = new HttpParams();
    if (query.range) {
      params = params.set('range', query.range);
    }
    if (query.tenant_id) {
      params = params.set('tenant_id', query.tenant_id);
    }
    return this.http.get<DashboardSummaryResponse>(`${this.baseUrl}/dashboard/summary`, { params });
  }

  /** GET /api/dashboard/provider-health */
  providerHealth(): Observable<ProviderHealthResponse> {
    return this.http.get<ProviderHealthResponse>(`${this.baseUrl}/dashboard/provider-health`);
  }
}
