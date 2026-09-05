import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  CreateHitlGateRequest,
  CreateReviewerGroupRequest,
  DecideHitlDecisionRequest,
  HitlDecisionDto,
  HitlGateDto,
  ListHitlGatesResponseDto,
  ListHitlQueueResponseDto,
  ListReviewerGroupsResponseDto,
  ReviewerGroupDto,
  UpdateHitlGateRequest,
  UpdateReviewerGroupRequest,
} from '@liveavatar/contracts';
import { API_BASE_URL } from './api-base-url.token';

/**
 * Typed HTTP client for the `hitl` module (HITL tab + Reviewer console,
 * Phase 14, BL-052..057 — `docs/v2/UX_SCOPE.md` "HITL tab + Reviewer
 * console"). Mirrors `SkillsApiService`/`ToolsApiService`'s shape exactly —
 * full CRUD for `ReviewerGroup`/`HitlGate`, plus the reviewer-console
 * queue/decision endpoints (`docs/v2/ARCHITECTURE_NOTES.md` §6.3).
 */
@Injectable({ providedIn: 'root' })
export class HitlApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** GET /api/tenants/{id}/hitl/reviewer-groups */
  listReviewerGroups(tenantId: string): Observable<ListReviewerGroupsResponseDto> {
    return this.http.get<ListReviewerGroupsResponseDto>(`${this.baseUrl}/tenants/${tenantId}/hitl/reviewer-groups`);
  }

  /** POST /api/tenants/{id}/hitl/reviewer-groups */
  createReviewerGroup(tenantId: string, body: CreateReviewerGroupRequest): Observable<ReviewerGroupDto> {
    return this.http.post<ReviewerGroupDto>(`${this.baseUrl}/tenants/${tenantId}/hitl/reviewer-groups`, body);
  }

  /** PATCH /api/tenants/{id}/hitl/reviewer-groups/{groupId} */
  updateReviewerGroup(tenantId: string, groupId: string, body: UpdateReviewerGroupRequest): Observable<ReviewerGroupDto> {
    return this.http.patch<ReviewerGroupDto>(`${this.baseUrl}/tenants/${tenantId}/hitl/reviewer-groups/${groupId}`, body);
  }

  /** DELETE /api/tenants/{id}/hitl/reviewer-groups/{groupId} */
  deleteReviewerGroup(tenantId: string, groupId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/tenants/${tenantId}/hitl/reviewer-groups/${groupId}`);
  }

  /** GET /api/tenants/{id}/hitl/gates */
  listGates(tenantId: string): Observable<ListHitlGatesResponseDto> {
    return this.http.get<ListHitlGatesResponseDto>(`${this.baseUrl}/tenants/${tenantId}/hitl/gates`);
  }

  /** GET /api/tenants/{id}/hitl/gates/{gateId} */
  getGate(tenantId: string, gateId: string): Observable<HitlGateDto> {
    return this.http.get<HitlGateDto>(`${this.baseUrl}/tenants/${tenantId}/hitl/gates/${gateId}`);
  }

  /** POST /api/tenants/{id}/hitl/gates */
  createGate(tenantId: string, body: CreateHitlGateRequest): Observable<HitlGateDto> {
    return this.http.post<HitlGateDto>(`${this.baseUrl}/tenants/${tenantId}/hitl/gates`, body);
  }

  /** PATCH /api/tenants/{id}/hitl/gates/{gateId} */
  updateGate(tenantId: string, gateId: string, body: UpdateHitlGateRequest): Observable<HitlGateDto> {
    return this.http.patch<HitlGateDto>(`${this.baseUrl}/tenants/${tenantId}/hitl/gates/${gateId}`, body);
  }

  /** DELETE /api/tenants/{id}/hitl/gates/{gateId} */
  deleteGate(tenantId: string, gateId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/tenants/${tenantId}/hitl/gates/${gateId}`);
  }

  /** GET /api/tenants/{id}/hitl/queue — pending decisions for gates this tenant owns (Reviewer console). */
  listQueue(tenantId: string): Observable<ListHitlQueueResponseDto> {
    return this.http.get<ListHitlQueueResponseDto>(`${this.baseUrl}/tenants/${tenantId}/hitl/queue`);
  }

  /** POST /api/tenants/{id}/hitl/decisions/{decisionId}/decide — approve/deny/edit_approve (R-H6). */
  decide(tenantId: string, decisionId: string, body: DecideHitlDecisionRequest): Observable<HitlDecisionDto> {
    return this.http.post<HitlDecisionDto>(`${this.baseUrl}/tenants/${tenantId}/hitl/decisions/${decisionId}/decide`, body);
  }
}
