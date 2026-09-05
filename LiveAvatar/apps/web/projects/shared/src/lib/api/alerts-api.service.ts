import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  AlertEventDto,
  AlertPolicyResponse,
  FailoverStatsQuery,
  FailoverStatsResponse,
  ListAlertsQuery,
  UpdateAlertPolicyRequest,
} from '@liveavatar/contracts';
import { API_BASE_URL } from './api-base-url.token';

/** `GET /tenants/{id}/alerts` collection envelope. */
export interface AlertListResponse {
  items: AlertEventDto[];
  total: number;
}

/** Typed HTTP client for the Alerts & failover surface (Screen 7, FR-ALERT-1..4). */
@Injectable({ providedIn: 'root' })
export class AlertsApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** GET /api/tenants/{id}/alert-policy */
  getPolicy(tenantId: string): Observable<AlertPolicyResponse> {
    return this.http.get<AlertPolicyResponse>(`${this.baseUrl}/tenants/${tenantId}/alert-policy`);
  }

  /** PUT /api/tenants/{id}/alert-policy */
  updatePolicy(tenantId: string, body: UpdateAlertPolicyRequest, ifMatch: string): Observable<AlertPolicyResponse> {
    return this.http.put<AlertPolicyResponse>(`${this.baseUrl}/tenants/${tenantId}/alert-policy`, body, {
      headers: { 'If-Match': ifMatch },
    });
  }

  /** GET /api/tenants/{id}/alerts */
  listAlerts(tenantId: string, query: ListAlertsQuery = {}): Observable<AlertListResponse> {
    let params = new HttpParams();
    if (query.type) {
      params = params.set('type', query.type);
    }
    if (query.from) {
      params = params.set('from', query.from);
    }
    if (query.to) {
      params = params.set('to', query.to);
    }
    if (query.page) {
      params = params.set('page', String(query.page));
    }
    return this.http.get<AlertListResponse>(`${this.baseUrl}/tenants/${tenantId}/alerts`, { params });
  }

  /** GET /api/tenants/{id}/failover-stats */
  failoverStats(tenantId: string, query: FailoverStatsQuery = {}): Observable<FailoverStatsResponse> {
    let params = new HttpParams();
    if (query.range) {
      params = params.set('range', query.range);
    }
    return this.http.get<FailoverStatsResponse>(`${this.baseUrl}/tenants/${tenantId}/failover-stats`, { params });
  }
}
