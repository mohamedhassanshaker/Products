import { Injectable, inject } from '@angular/core';
import type { UpdateResidencyRequest } from '@liveavatar/contracts';
import { ResidencyApiService } from '@liveavatar/web-shared';

/** Feature-scoped HTTP facade over `ResidencyApiService` (LLD §3.2 feature rule). */
@Injectable({ providedIn: 'root' })
export class ResidencyService {
  private readonly api = inject(ResidencyApiService);

  get(tenantId: string) {
    return this.api.get(tenantId);
  }

  update(tenantId: string, body: UpdateResidencyRequest, ifMatch: string) {
    return this.api.update(tenantId, body, ifMatch);
  }
}
