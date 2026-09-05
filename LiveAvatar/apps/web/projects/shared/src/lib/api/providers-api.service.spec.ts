import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ProvidersApiService } from './providers-api.service';

describe('ProvidersApiService', () => {
  let service: ProvidersApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ProvidersApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('GETs /api/provider-definitions with no params by default', () => {
    service.listDefinitions().subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/provider-definitions');
    expect(req.request.params.has('category')).toBe(false);
    expect(req.request.params.has('enabled')).toBe(false);
    req.flush({ items: [] });
  });

  it('GETs /api/provider-definitions with category/enabled filters', () => {
    service.listDefinitions({ category: 'llm', enabled: true }).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/provider-definitions');
    expect(req.request.params.get('category')).toBe('llm');
    expect(req.request.params.get('enabled')).toBe('true');
    req.flush({ items: [] });
  });

  it('PATCHes /api/provider-definitions/{key}', () => {
    service.setDefinitionEnabled('openai', { enabled: false }).subscribe();
    const req = httpMock.expectOne('/api/provider-definitions/openai');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ enabled: false });
    req.flush({});
  });

  it('GETs /api/tenants/{id}/provider-credentials', () => {
    service.listCredentials('t-1').subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/tenants/t-1/provider-credentials');
    expect(req.request.method).toBe('GET');
    req.flush({ items: [] });
  });

  it('POSTs /api/tenants/{id}/provider-credentials with an Idempotency-Key', () => {
    service
      .createCredential('t-1', { provider_key: 'openai', endpoint_url: 'https://api.openai.com' }, 'key-1')
      .subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/provider-credentials');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Idempotency-Key')).toBe('key-1');
    req.flush({});
  });

  it('PATCHes /api/tenants/{id}/provider-credentials/{credId} with an If-Match header', () => {
    service.updateCredential('t-1', 'cred-1', { display_label: 'lab' }, '2026-01-01').subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/provider-credentials/cred-1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.headers.get('If-Match')).toBe('2026-01-01');
    req.flush({});
  });

  it('DELETEs /api/tenants/{id}/provider-credentials/{credId}', () => {
    service.deleteCredential('t-1', 'cred-1').subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/provider-credentials/cred-1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('POSTs /api/tenants/{id}/provider-credentials/{credId}/probe', () => {
    service.probeCredential('t-1', 'cred-1').subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/provider-credentials/cred-1/probe');
    expect(req.request.method).toBe('POST');
    req.flush({ status: 'healthy', probed_at: '2026-01-01T00:00:00.000Z' });
  });
});
