import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AlertsApiService } from './alerts-api.service';

describe('AlertsApiService', () => {
  let service: AlertsApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(AlertsApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('GETs /api/tenants/{id}/alert-policy', () => {
    service.getPolicy('t1').subscribe();
    httpMock.expectOne('/api/tenants/t1/alert-policy').flush({});
  });

  it('PUTs /api/tenants/{id}/alert-policy with an If-Match header', () => {
    service.updatePolicy('t1', { retry_max_attempts: 3, retry_backoff_ms: [1, 2, 3], degraded_mode_message: 'm' }, 'if-match').subscribe();
    const req = httpMock.expectOne('/api/tenants/t1/alert-policy');
    expect(req.request.method).toBe('PUT');
    expect(req.request.headers.get('If-Match')).toBe('if-match');
    req.flush({});
  });

  it('GETs /api/tenants/{id}/alerts with filters', () => {
    service.listAlerts('t1', { type: 'gpu_unhealthy', page: 2 }).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/tenants/t1/alerts');
    expect(req.request.params.get('type')).toBe('gpu_unhealthy');
    expect(req.request.params.get('page')).toBe('2');
    req.flush({ items: [], total: 0 });
  });

  it('GETs /api/tenants/{id}/failover-stats with a range', () => {
    service.failoverStats('t1', { range: '7d' }).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/tenants/t1/failover-stats');
    expect(req.request.params.get('range')).toBe('7d');
    req.flush({ primary_failures: 0, fallback_successes: 0, degraded_invocations: 0 });
  });
});
