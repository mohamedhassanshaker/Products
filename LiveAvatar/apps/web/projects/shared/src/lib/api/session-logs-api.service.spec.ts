import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { SessionLogsApiService } from './session-logs-api.service';

describe('SessionLogsApiService', () => {
  let service: SessionLogsApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(SessionLogsApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('GETs /api/sessions with every filter set', () => {
    service.list({ tenant_id: 't1', q: 'hi', from: 'a', to: 'b', status: 'ended', page: 2, page_size: 50 }).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/sessions');
    expect(req.request.params.get('tenant_id')).toBe('t1');
    expect(req.request.params.get('q')).toBe('hi');
    expect(req.request.params.get('status')).toBe('ended');
    expect(req.request.params.get('page')).toBe('2');
    req.flush({ items: [], total: 0, page: 2, page_size: 50 });
  });

  it('GETs /api/sessions with defaults when filters are omitted', () => {
    service.list({}).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/sessions');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('page_size')).toBe('25');
    req.flush({ items: [], total: 0, page: 1, page_size: 25 });
  });

  it('GETs /api/sessions/{id}', () => {
    service.detail('s1').subscribe();
    httpMock.expectOne('/api/sessions/s1').flush({});
  });

  it('GETs /api/sessions/{id}/transcript', () => {
    service.transcript('s1').subscribe();
    httpMock.expectOne('/api/sessions/s1/transcript').flush({ items: [] });
  });

  it('GETs /api/sessions/{id}/hops', () => {
    service.hops('s1').subscribe();
    httpMock.expectOne('/api/sessions/s1/hops').flush({ cycles: [] });
  });
});
