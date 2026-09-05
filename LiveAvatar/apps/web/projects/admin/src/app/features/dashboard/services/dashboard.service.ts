import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { DashboardSummaryQuery, DashboardSummaryResponse, ProviderHealthResponse } from '@liveavatar/contracts';
import { DashboardApiService } from '@liveavatar/web-shared';

/** Feature-scoped HTTP facade over `DashboardApiService` (LLD §3.2 feature rule). */
@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly api = inject(DashboardApiService);

  summary(query: DashboardSummaryQuery): Observable<DashboardSummaryResponse> {
    return this.api.summary(query);
  }

  providerHealth(): Observable<ProviderHealthResponse> {
    return this.api.providerHealth();
  }
}
