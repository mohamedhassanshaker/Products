import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { ListSessionsQuery, SessionDetailDto } from '@liveavatar/contracts';
import {
  SessionLogsApiService,
  type HopsResponse,
  type SessionListResponse,
  type TranscriptResponse,
} from '@liveavatar/web-shared';

/** Feature-scoped HTTP facade over `SessionLogsApiService` (LLD §3.2 feature rule). */
@Injectable({ providedIn: 'root' })
export class SessionLogsService {
  private readonly api = inject(SessionLogsApiService);

  list(query: ListSessionsQuery): Observable<SessionListResponse> {
    return this.api.list(query);
  }

  detail(id: string): Observable<SessionDetailDto> {
    return this.api.detail(id);
  }

  transcript(id: string): Observable<TranscriptResponse> {
    return this.api.transcript(id);
  }

  hops(id: string): Observable<HopsResponse> {
    return this.api.hops(id);
  }
}
