import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { GpuApiService } from './gpu-api.service';

describe('GpuApiService', () => {
  let service: GpuApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(GpuApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('GETs /api/gpu/nodes with no params by default', () => {
    service.list().subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/gpu/nodes');
    expect(req.request.params.has('role')).toBe(false);
    expect(req.request.params.has('tenant_id')).toBe(false);
    req.flush({ items: [], total: 0 });
  });

  it('GETs /api/gpu/nodes with role/tenant_id filters', () => {
    service.list({ role: 'stt', tenant_id: 't1' }).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/gpu/nodes');
    expect(req.request.params.get('role')).toBe('stt');
    expect(req.request.params.get('tenant_id')).toBe('t1');
    req.flush({ items: [], total: 0 });
  });
});
