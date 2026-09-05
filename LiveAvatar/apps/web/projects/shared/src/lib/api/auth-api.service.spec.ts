import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AuthApiService } from './auth-api.service';

describe('AuthApiService', () => {
  let service: AuthApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('POSTs login to /api/auth/login with the given body', () => {
    service.login({ email: 'a@b.com', password: 'secret1' }).subscribe();
    const req = httpMock.expectOne('/api/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'a@b.com', password: 'secret1' });
    req.flush({});
  });

  it('POSTs refresh to /api/auth/refresh', () => {
    service.refresh({ refresh_token: 'rt' }).subscribe();
    const req = httpMock.expectOne('/api/auth/refresh');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ refresh_token: 'rt' });
    req.flush({});
  });

  it('POSTs logout to /api/auth/logout with the refresh token', () => {
    service.logout('rt-123').subscribe();
    const req = httpMock.expectOne('/api/auth/logout');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ refresh_token: 'rt-123' });
    req.flush(null);
  });

  it('GETs /api/auth/me', () => {
    service.me().subscribe();
    const req = httpMock.expectOne('/api/auth/me');
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('POSTs invite accept to /api/auth/invites/accept', () => {
    service.acceptInvite({ token: 't', password: 'password1' }).subscribe();
    const req = httpMock.expectOne('/api/auth/invites/accept');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ token: 't', password: 'password1' });
    req.flush({});
  });
});
