import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { DeploymentConfigApiService } from './deployment-config-api.service';

describe('DeploymentConfigApiService', () => {
  let service: DeploymentConfigApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(DeploymentConfigApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('GETs /api/tenants/{id}/config', () => {
    service.get('t-1').subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/config');
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('POSTs /api/tenants/{id}/config/validate', () => {
    service.validate('t-1', { config: { version: 1 } }).subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/config/validate');
    expect(req.request.method).toBe('POST');
    req.flush({ valid: false, errors: [], resolved: {}, redacted_yaml: '' });
  });

  it('PUTs /api/tenants/{id}/config with an If-Match header', () => {
    service.save('t-1', { config: { version: 1 }, save_as: 'draft' }, '2026-01-01').subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/config');
    expect(req.request.method).toBe('PUT');
    expect(req.request.headers.get('If-Match')).toBe('2026-01-01');
    req.flush({});
  });

  it('POSTs /api/tenants/{id}/config/test-call', () => {
    service.testCall('t-1', { config: { version: 1 }, utterance: 'hi' }).subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/config/test-call');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ config: { version: 1 }, utterance: 'hi' });
    req.flush({ ok: true, final_text: 'hello', nodes: [], errors: [] });
  });
});
