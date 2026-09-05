import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { DashboardApiService } from './dashboard-api.service';

describe('DashboardApiService', () => {
  let service: DashboardApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(DashboardApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('GETs /api/dashboard/summary with range and tenant_id when provided', () => {
    service.summary({ range: '7d', tenant_id: 't1' }).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/dashboard/summary');
    expect(req.request.params.get('range')).toBe('7d');
    expect(req.request.params.get('tenant_id')).toBe('t1');
    req.flush({ active_deployments: 0, sessions: { started: 0, ended: 0, failed: 0, abandoned: 0 }, error_rate: 0, range: '7d' });
  });

  it('GETs /api/dashboard/summary with no params when omitted', () => {
    service.summary({}).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/dashboard/summary');
    expect(req.request.params.has('range')).toBe(false);
    expect(req.request.params.has('tenant_id')).toBe(false);
    req.flush({});
  });

  it('GETs /api/dashboard/provider-health', () => {
    service.providerHealth().subscribe();
    const req = httpMock.expectOne('/api/dashboard/provider-health');
    expect(req.request.method).toBe('GET');
    req.flush({ categories: [] });
  });
});
