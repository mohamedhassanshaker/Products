import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  PreflightResponse,
  PublicFeedbackRequest,
  PublicSessionCreateRequest,
  PublicSessionEndRequest,
  PublicSessionEndResponse,
  PublicSessionResponse,
  PublicSessionSummary,
} from '@liveavatar/contracts';
import { API_BASE_URL } from './api-base-url.token';

/**
 * Typed HTTP client for the unauthenticated end-user surface (FR-CALL-1,
 * FR-AUTH-4, FR-TRANSPORT-4). No admin JWT, no `Authorization` header —
 * end users have no accounts. Consumed only by the `conversation` SPA.
 */
@Injectable({ providedIn: 'root' })
export class PublicApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** GET /api/public/deployments/{slug}/preflight (FR-CALL-1 step 2). */
  preflight(slug: string): Observable<PreflightResponse> {
    return this.http.get<PreflightResponse>(`${this.baseUrl}/public/deployments/${slug}/preflight`);
  }

  /** POST /api/public/sessions — the only legal way a conversation token is minted. */
  createSession(body: PublicSessionCreateRequest): Observable<PublicSessionResponse> {
    return this.http.post<PublicSessionResponse>(`${this.baseUrl}/public/sessions`, body);
  }

  /** POST /api/public/sessions/{id}/end */
  endSession(sessionId: string, body: PublicSessionEndRequest): Observable<PublicSessionEndResponse> {
    return this.http.post<PublicSessionEndResponse>(`${this.baseUrl}/public/sessions/${sessionId}/end`, body);
  }

  /** GET /api/public/sessions/{id}/summary (FR-CALL-4, Screen 11). `X-Summary-Token` is the sole credential. */
  summary(sessionId: string, summaryToken: string): Observable<PublicSessionSummary> {
    return this.http.get<PublicSessionSummary>(`${this.baseUrl}/public/sessions/${sessionId}/summary`, {
      headers: { 'X-Summary-Token': summaryToken },
    });
  }

  /** POST /api/public/sessions/{id}/feedback (FR-CALL-4). The only end-user write path. */
  submitFeedback(sessionId: string, summaryToken: string, body: PublicFeedbackRequest): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/public/sessions/${sessionId}/feedback`, body, {
      headers: { 'X-Summary-Token': summaryToken },
    });
  }
}
