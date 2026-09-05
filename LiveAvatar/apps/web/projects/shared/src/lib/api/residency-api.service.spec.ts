import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ResidencyApiService } from './residency-api.service';

describe('ResidencyApiService', () => {
  let service: ResidencyApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ResidencyApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('GETs /api/tenants/{id}/residency', () => {
    service.get('t1').subscribe();
    httpMock.expectOne('/api/tenants/t1/residency').flush({});
  });

  it('PUTs /api/tenants/{id}/residency with an If-Match header', () => {
    service.update('t1', { send_to_remote_llm: 'none', retain_transcripts_days: 30, recordings_enabled: false }, 'if-match').subscribe();
    const req = httpMock.expectOne('/api/tenants/t1/residency');
    expect(req.request.method).toBe('PUT');
    expect(req.request.headers.get('If-Match')).toBe('if-match');
    req.flush({});
  });
});
