import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { ListGpuNodesQuery, ListGpuNodesResponse } from '@liveavatar/contracts';
import { GpuApiService } from '@liveavatar/web-shared';

/** Feature-scoped HTTP facade over `GpuApiService` (LLD §3.2 feature rule). */
@Injectable({ providedIn: 'root' })
export class GpuService {
  private readonly api = inject(GpuApiService);

  list(query: ListGpuNodesQuery): Observable<ListGpuNodesResponse> {
    return this.api.list(query);
  }
}
