import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  FailoverStatsQuery,
  FailoverStatsResponse,
  ListAlertsQuery,
  UpdateAlertPolicyRequest,
} from '@liveavatar/contracts';
import { AlertsApiService, type AlertListResponse } from '@liveavatar/web-shared';

/** Feature-scoped HTTP facade over `AlertsApiService` (LLD §3.2 feature rule). */
@Injectable({ providedIn: 'root' })
export class AlertsService {
  private readonly api = inject(AlertsApiService);

  getPolicy(tenantId: string) {
    return this.api.getPolicy(tenantId);
  }

  updatePolicy(tenantId: string, body: UpdateAlertPolicyRequest, ifMatch: string) {
    return this.api.updatePolicy(tenantId, body, ifMatch);
  }

  listAlerts(tenantId: string, query: ListAlertsQuery = {}): Observable<AlertListResponse> {
    return this.api.listAlerts(tenantId, query);
  }

  failoverStats(tenantId: string, query: FailoverStatsQuery = {}): Observable<FailoverStatsResponse> {
    return this.api.failoverStats(tenantId, query);
  }
}
