import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ToolsApiService } from './tools-api.service';

describe('ToolsApiService', () => {
  let service: ToolsApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ToolsApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('GETs /api/tenants/{id}/tools', () => {
    service.list('t-1').subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/tools');
    expect(req.request.method).toBe('GET');
    req.flush({ items: [] });
  });

  it('GETs /api/tenants/{id}/tools/{toolId}', () => {
    service.get('t-1', 'tool-1').subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/tools/tool-1');
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('POSTs /api/tenants/{id}/tools', () => {
    const body = { name: 'Lookup order', method: 'GET' as const, url: 'https://api.example.com/orders' };
    service.create('t-1', body).subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/tools');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush({});
  });

  it('PATCHes /api/tenants/{id}/tools/{toolId} with an If-Match header', () => {
    service.update('t-1', 'tool-1', { name: 'Renamed' }, '2026-01-01').subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/tools/tool-1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.headers.get('If-Match')).toBe('2026-01-01');
    req.flush({});
  });

  it('DELETEs /api/tenants/{id}/tools/{toolId}', () => {
    service.delete('t-1', 'tool-1').subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/tools/tool-1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('POSTs /api/tenants/{id}/tools/{toolId}/test-invoke', () => {
    service.testInvoke('t-1', 'tool-1', { arguments: { order_id: '4821' } }).subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/tools/tool-1/test-invoke');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ arguments: { order_id: '4821' } });
    req.flush({ ok: true, duration_ms: 100 });
  });
});
