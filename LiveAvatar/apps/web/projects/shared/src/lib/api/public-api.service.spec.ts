import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { PublicApiService } from './public-api.service';

describe('PublicApiService', () => {
  let service: PublicApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PublicApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('GETs the preflight endpoint for a slug', () => {
    service.preflight('acme').subscribe();
    const req = httpMock.expectOne('/api/public/deployments/acme/preflight');
    expect(req.request.method).toBe('GET');
    req.flush({
      deployment: { slug: 'acme', name: 'Acme' },
      transport: { reachable: true, ws_url: 'ws://x' },
      config: { complete: true },
      avatar: {},
    });
  });

  it('POSTs to create a session with the request body', () => {
    service.createSession({ slug: 'acme', display_name: 'Alice' }).subscribe();
    const req = httpMock.expectOne('/api/public/sessions');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ slug: 'acme', display_name: 'Alice' });
    req.flush({ session_id: 's1', room_name: 'acme_s1', ws_url: 'ws://x', token: 'tok', expires_at: 'now' });
  });

  it('POSTs to end a session with the token', () => {
    service.endSession('s1', { token: 'tok' }).subscribe();
    const req = httpMock.expectOne('/api/public/sessions/s1/end');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ token: 'tok' });
    req.flush({ status: 'ended' });
  });

  it('GETs the post-call summary with the X-Summary-Token header', () => {
    service.summary('s1', 'sum-tok').subscribe();
    const req = httpMock.expectOne('/api/public/sessions/s1/summary');
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('X-Summary-Token')).toBe('sum-tok');
    req.flush({ status: 'ended', summary_status: 'ready', feedback_submitted: false });
  });

  it('POSTs feedback with the X-Summary-Token header', () => {
    service.submitFeedback('s1', 'sum-tok', { rating: 5, comment: 'Great!' }).subscribe();
    const req = httpMock.expectOne('/api/public/sessions/s1/feedback');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('X-Summary-Token')).toBe('sum-tok');
    expect(req.request.body).toEqual({ rating: 5, comment: 'Great!' });
    req.flush(null);
  });
});
