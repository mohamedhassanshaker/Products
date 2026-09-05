import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  CreateSkillRequest,
  ListSkillsResponseDto,
  PublishSkillResponseDto,
  SkillDto,
  SkillUsageResponseDto,
  UpdateSkillDraftRequest,
} from '@liveavatar/contracts';
import { API_BASE_URL } from './api-base-url.token';

/**
 * Typed HTTP client for the Skills registry (Skills tab, BL-049/050/051,
 * `docs/v2/BACKLOG.md`) — mirrors `ToolsApiService`'s shape exactly.
 */
@Injectable({ providedIn: 'root' })
export class SkillsApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** GET /api/tenants/{id}/skills */
  list(tenantId: string): Observable<ListSkillsResponseDto> {
    return this.http.get<ListSkillsResponseDto>(`${this.baseUrl}/tenants/${tenantId}/skills`);
  }

  /** GET /api/tenants/{id}/skills/{skillId} */
  get(tenantId: string, skillId: string): Observable<SkillDto> {
    return this.http.get<SkillDto>(`${this.baseUrl}/tenants/${tenantId}/skills/${skillId}`);
  }

  /** GET /api/tenants/{id}/skills/{skillId}/usage — the pre-publish "used by N agents" warning (A5.3 UC-S2). */
  usage(tenantId: string, skillId: string): Observable<SkillUsageResponseDto> {
    return this.http.get<SkillUsageResponseDto>(`${this.baseUrl}/tenants/${tenantId}/skills/${skillId}/usage`);
  }

  /** POST /api/tenants/{id}/skills */
  create(tenantId: string, body: CreateSkillRequest): Observable<SkillDto> {
    return this.http.post<SkillDto>(`${this.baseUrl}/tenants/${tenantId}/skills`, body);
  }

  /** PATCH /api/tenants/{id}/skills/{skillId}/draft */
  updateDraft(tenantId: string, skillId: string, body: UpdateSkillDraftRequest): Observable<SkillDto> {
    return this.http.patch<SkillDto>(`${this.baseUrl}/tenants/${tenantId}/skills/${skillId}/draft`, body);
  }

  /** POST /api/tenants/{id}/skills/{skillId}/publish */
  publish(tenantId: string, skillId: string): Observable<PublishSkillResponseDto> {
    return this.http.post<PublishSkillResponseDto>(`${this.baseUrl}/tenants/${tenantId}/skills/${skillId}/publish`, {});
  }

  /** DELETE /api/tenants/{id}/skills/{skillId} */
  delete(tenantId: string, skillId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/tenants/${tenantId}/skills/${skillId}`);
  }
}
