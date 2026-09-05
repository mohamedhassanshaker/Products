import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { ListSessionsQuery, SessionDetailDto, SessionListItemDto } from '@liveavatar/contracts';
import { API_BASE_URL } from './api-base-url.token';

/** `GET /sessions` collection envelope. */
export interface SessionListResponse {
  items: SessionListItemDto[];
  total: number;
  page: number;
  page_size: number;
}

/** `GET /sessions/{id}/transcript` response. */
export interface TranscriptResponse {
  items: { seq: number; role: 'user' | 'assistant'; text: string | null; started_at: string; ended_at: string | null }[];
}

/**
 * One graph-node execution within a hop cycle (Phase 9, BL-039). Unlike
 * `stt`/`llm`/`tts`/`avatar`/`e2e` (at most one row per utterance), a turn
 * can execute many nodes per utterance, so these collect into an array —
 * mirrors `NodeTraceItemDto` (`@liveavatar/contracts`).
 */
export interface NodeTraceItem {
  node_id: string;
  node_type?: string;
  lane?: string;
  total_ms?: number;
  provider_key?: string;
  used_fallback?: boolean;
  first_token_ms?: number;
  error_code?: string;
}

/** One utterance cycle's hop timings (FR-SESS-3) — missing hops are simply absent keys. */
export interface HopCycle {
  utterance_seq: number;
  stt?: { total_ms?: number; first_partial_ms?: number };
  llm?: { total_ms?: number; first_token_ms?: number };
  tts?: { total_ms?: number; first_audio_ms?: number };
  avatar?: { total_ms?: number; first_frame_ms?: number };
  e2e?: { total_ms?: number };
  /** Phase 9 (BL-039) — one entry per graph node executed this utterance, in execution order. */
  nodes?: NodeTraceItem[];
}

/** `GET /sessions/{id}/hops` response. */
export interface HopsResponse {
  cycles: HopCycle[];
}

/** Typed HTTP client for the Session Logs surface (Screen 5, FR-SESS-1/2/3). */
@Injectable({ providedIn: 'root' })
export class SessionLogsApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** GET /api/sessions */
  list(query: ListSessionsQuery): Observable<SessionListResponse> {
    let params = new HttpParams();
    if (query.tenant_id) {
      params = params.set('tenant_id', query.tenant_id);
    }
    if (query.q) {
      params = params.set('q', query.q);
    }
    if (query.from) {
      params = params.set('from', query.from);
    }
    if (query.to) {
      params = params.set('to', query.to);
    }
    if (query.status) {
      params = params.set('status', query.status);
    }
    params = params.set('page', String(query.page ?? 1));
    params = params.set('page_size', String(query.page_size ?? 25));
    return this.http.get<SessionListResponse>(`${this.baseUrl}/sessions`, { params });
  }

  /** GET /api/sessions/{id} */
  detail(id: string): Observable<SessionDetailDto> {
    return this.http.get<SessionDetailDto>(`${this.baseUrl}/sessions/${id}`);
  }

  /** GET /api/sessions/{id}/transcript */
  transcript(id: string): Observable<TranscriptResponse> {
    return this.http.get<TranscriptResponse>(`${this.baseUrl}/sessions/${id}/transcript`);
  }

  /** GET /api/sessions/{id}/hops */
  hops(id: string): Observable<HopsResponse> {
    return this.http.get<HopsResponse>(`${this.baseUrl}/sessions/${id}/hops`);
  }
}
