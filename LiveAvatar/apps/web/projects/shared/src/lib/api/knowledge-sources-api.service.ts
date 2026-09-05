import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  CreateKnowledgeSourceRequest,
  KnowledgeSourceDto,
  ListKnowledgeSourcesResponseDto,
  ReindexEstimateResponseDto,
  RunRetrievalPlaygroundRequest,
  RunRetrievalPlaygroundResponseDto,
  TriggerReindexResponseDto,
  UpdateKnowledgeSourceRequest,
} from '@liveavatar/contracts';
import { API_BASE_URL } from './api-base-url.token';

/**
 * Typed HTTP client for the knowledge-source registry (Phase 12a RAG
 * ingestion, `docs/plans/agent-builder-v2-plan.md`). Mirrors
 * `ToolsApiService`'s shape exactly, including the `If-Match` convention on
 * `update()`.
 */
@Injectable({ providedIn: 'root' })
export class KnowledgeSourcesApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** GET /api/tenants/{id}/knowledge-sources */
  list(tenantId: string): Observable<ListKnowledgeSourcesResponseDto> {
    return this.http.get<ListKnowledgeSourcesResponseDto>(`${this.baseUrl}/tenants/${tenantId}/knowledge-sources`);
  }

  /** GET /api/tenants/{id}/knowledge-sources/{sourceId} */
  get(tenantId: string, sourceId: string): Observable<KnowledgeSourceDto> {
    return this.http.get<KnowledgeSourceDto>(`${this.baseUrl}/tenants/${tenantId}/knowledge-sources/${sourceId}`);
  }

  /**
   * POST /api/tenants/{id}/knowledge-sources (multipart/form-data). Every
   * defined config field is sent as a text part alongside the file part
   * (field name `file`, matching the server's multer field name).
   */
  create(tenantId: string, fields: CreateKnowledgeSourceRequest, file: File): Observable<KnowledgeSourceDto> {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null) {
        continue;
      }
      formData.append(key, String(value));
    }
    formData.append('file', file, file.name);
    return this.http.post<KnowledgeSourceDto>(`${this.baseUrl}/tenants/${tenantId}/knowledge-sources`, formData);
  }

  /** PATCH /api/tenants/{id}/knowledge-sources/{sourceId} */
  update(
    tenantId: string,
    sourceId: string,
    body: UpdateKnowledgeSourceRequest,
    ifMatch: string,
  ): Observable<KnowledgeSourceDto> {
    return this.http.patch<KnowledgeSourceDto>(
      `${this.baseUrl}/tenants/${tenantId}/knowledge-sources/${sourceId}`,
      body,
      { headers: { 'If-Match': ifMatch } },
    );
  }

  /** DELETE /api/tenants/{id}/knowledge-sources/{sourceId} */
  delete(tenantId: string, sourceId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/tenants/${tenantId}/knowledge-sources/${sourceId}`);
  }

  /**
   * GET /api/tenants/{id}/knowledge-sources/{sourceId}/reindex-estimate —
   * side-effect-free preview, safe to call just to render the estimate.
   */
  estimateReindex(tenantId: string, sourceId: string): Observable<ReindexEstimateResponseDto> {
    return this.http.get<ReindexEstimateResponseDto>(
      `${this.baseUrl}/tenants/${tenantId}/knowledge-sources/${sourceId}/reindex-estimate`,
    );
  }

  /** POST /api/tenants/{id}/knowledge-sources/{sourceId}/reindex — actually enqueues the job. */
  triggerReindex(tenantId: string, sourceId: string): Observable<TriggerReindexResponseDto> {
    return this.http.post<TriggerReindexResponseDto>(
      `${this.baseUrl}/tenants/${tenantId}/knowledge-sources/${sourceId}/reindex`,
      {},
    );
  }

  /**
   * POST /api/tenants/{id}/knowledge/playground/run (Phase 12b, BL-045/047)
   * — the Retrieval playground's dedicated endpoint. Runs the real six-stage
   * pipeline against the tenant's live index, always 200 (errors arrive as
   * normal HTTP error envelopes, not an `ok:false` body like the generic
   * test-call harness — see `RunRetrievalPlaygroundResponseSchema`'s doc
   * comment in `@liveavatar/contracts`).
   */
  runRetrievalPlayground(
    tenantId: string,
    body: RunRetrievalPlaygroundRequest,
  ): Observable<RunRetrievalPlaygroundResponseDto> {
    return this.http.post<RunRetrievalPlaygroundResponseDto>(
      `${this.baseUrl}/tenants/${tenantId}/knowledge/playground/run`,
      body,
    );
  }
}
