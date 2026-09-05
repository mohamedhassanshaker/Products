import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { KnowledgeSourcesApiService } from './knowledge-sources-api.service';

describe('KnowledgeSourcesApiService', () => {
  let service: KnowledgeSourcesApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(KnowledgeSourcesApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('GETs /api/tenants/{id}/knowledge-sources', () => {
    service.list('t-1').subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/knowledge-sources');
    expect(req.request.method).toBe('GET');
    req.flush({ items: [] });
  });

  it('GETs /api/tenants/{id}/knowledge-sources/{sourceId}', () => {
    service.get('t-1', 'src-1').subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/knowledge-sources/src-1');
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('POSTs /api/tenants/{id}/knowledge-sources as FormData with the file and every defined field', () => {
    const file = new File(['hello world'], 'notes.txt', { type: 'text/plain' });
    service
      .create(
        't-1',
        {
          name: 'Handbook',
          parser: 'plain_text',
          chunking_strategy: 'fixed',
          chunk_size: 1000,
          chunk_overlap: 100,
          embedding_model: 'text-embedding-3-small',
        },
        file,
      )
      .subscribe();

    const req = httpMock.expectOne('/api/tenants/t-1/knowledge-sources');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBeInstanceOf(FormData);

    const body = req.request.body as FormData;
    expect(body.get('name')).toBe('Handbook');
    expect(body.get('parser')).toBe('plain_text');
    expect(body.get('chunking_strategy')).toBe('fixed');
    expect(body.get('chunk_size')).toBe('1000');
    expect(body.get('chunk_overlap')).toBe('100');
    expect(body.get('embedding_model')).toBe('text-embedding-3-small');
    // jsdom's FormData clones File parts rather than preserving object identity,
    // so compare by name/type/size rather than `toBe`.
    const gotFile = body.get('file');
    expect(gotFile).toBeInstanceOf(File);
    expect((gotFile as File).name).toBe(file.name);
    expect((gotFile as File).type).toBe(file.type);
    expect((gotFile as File).size).toBe(file.size);
    // Optional fields left undefined must not appear as literal "undefined" parts.
    expect(body.has('embedding_credential_ref')).toBe(false);

    req.flush({});
  });

  it('omits null/undefined optional fields from the FormData', () => {
    const file = new File(['hello'], 'notes.md', { type: 'text/markdown' });
    service.create('t-1', { name: 'Handbook', embedding_credential_ref: null }, file).subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/knowledge-sources');
    const body = req.request.body as FormData;
    expect(body.has('embedding_credential_ref')).toBe(false);
    req.flush({});
  });

  it('PATCHes /api/tenants/{id}/knowledge-sources/{sourceId} with an If-Match header', () => {
    service.update('t-1', 'src-1', { name: 'Renamed' }, '2026-01-01T00:00:00.000Z').subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/knowledge-sources/src-1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'Renamed' });
    expect(req.request.headers.get('If-Match')).toBe('2026-01-01T00:00:00.000Z');
    req.flush({});
  });

  it('DELETEs /api/tenants/{id}/knowledge-sources/{sourceId}', () => {
    service.delete('t-1', 'src-1').subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/knowledge-sources/src-1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('GETs /api/tenants/{id}/knowledge-sources/{sourceId}/reindex-estimate', () => {
    service.estimateReindex('t-1', 'src-1').subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/knowledge-sources/src-1/reindex-estimate');
    expect(req.request.method).toBe('GET');
    req.flush({ chunk_count: 12, estimated_cost_usd: 0.000048, estimated_duration_ms: 600, is_estimate: true });
  });

  it('POSTs /api/tenants/{id}/knowledge-sources/{sourceId}/reindex', () => {
    service.triggerReindex('t-1', 'src-1').subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/knowledge-sources/src-1/reindex');
    expect(req.request.method).toBe('POST');
    req.flush({ enqueued: true });
  });

  it('POSTs /api/tenants/{id}/knowledge/playground/run with the query body', () => {
    service.runRetrievalPlayground('t-1', { query: 'refund after 30 days' }).subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/knowledge/playground/run');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ query: 'refund after 30 days' });
    req.flush({
      rewrite: { enabled: false, rewritten_query: null, ms: 0, timed_out: false },
      hybrid_search: { candidates: [], ms: 0, timed_out: false },
      filter: { enabled: false, before_count: 0, after_count: 0, ms: 0 },
      rerank: { enabled: false, note: 'not available' },
      threshold: { min_score: 0.5, pass_count: 0, dropped_count: 0, ms: 0 },
      inject: { chunks: [], token_total: 0, token_cap: 1200, ms: 0 },
      total_ms: 0,
      budget_ms: 400,
      over_budget: false,
    });
  });
});
