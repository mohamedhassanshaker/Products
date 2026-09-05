import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TenantsApiService } from './tenants-api.service';

describe('TenantsApiService', () => {
  let service: TenantsApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TenantsApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('GETs /api/tenants with query params, defaulting page and page_size', () => {
    service.list({}).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/tenants');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('page_size')).toBe('25');
    expect(req.request.params.has('q')).toBe(false);
    expect(req.request.params.has('status')).toBe(false);
    req.flush({ items: [], total: 0, page: 1, page_size: 25 });
  });

  it('includes q and status when provided', () => {
    service.list({ q: 'acme', status: 'active', page: 2, page_size: 50 }).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/tenants');
    expect(req.request.params.get('q')).toBe('acme');
    expect(req.request.params.get('status')).toBe('active');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('page_size')).toBe('50');
    req.flush({ items: [], total: 0, page: 2, page_size: 50 });
  });

  it('GETs /api/tenants/{id}', () => {
    service.get('t-1').subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1');
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('POSTs /api/tenants with an Idempotency-Key header', () => {
    service.create({ name: 'Acme', slug: 'acme' }, 'key-1').subscribe();
    const req = httpMock.expectOne('/api/tenants');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Acme', slug: 'acme' });
    expect(req.request.headers.get('Idempotency-Key')).toBe('key-1');
    req.flush({});
  });

  it('PATCHes /api/tenants/{id} with an If-Match header', () => {
    service.update('t-1', { name: 'New name' }, '2026-01-01T00:00:00.000Z').subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'New name' });
    expect(req.request.headers.get('If-Match')).toBe('2026-01-01T00:00:00.000Z');
    req.flush({});
  });

  it('POSTs /api/tenants/{id}/status', () => {
    service.changeStatus('t-1', { status: 'paused' }).subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/status');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ status: 'paused' });
    req.flush({});
  });
});
