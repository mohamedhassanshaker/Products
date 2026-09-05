import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { ResidencyResponse, UpdateResidencyRequest, UpdateResidencyResponse } from '@liveavatar/contracts';
import { API_BASE_URL } from './api-base-url.token';

/** Typed HTTP client for the Data residency / privacy settings surface (Screen 8, FR-PRIV-1/2). */
@Injectable({ providedIn: 'root' })
export class ResidencyApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** GET /api/tenants/{id}/residency */
  get(tenantId: string): Observable<ResidencyResponse> {
    return this.http.get<ResidencyResponse>(`${this.baseUrl}/tenants/${tenantId}/residency`);
  }

  /** PUT /api/tenants/{id}/residency */
  update(tenantId: string, body: UpdateResidencyRequest, ifMatch: string): Observable<UpdateResidencyResponse> {
    return this.http.put<UpdateResidencyResponse>(`${this.baseUrl}/tenants/${tenantId}/residency`, body, {
      headers: { 'If-Match': ifMatch },
    });
  }
}
