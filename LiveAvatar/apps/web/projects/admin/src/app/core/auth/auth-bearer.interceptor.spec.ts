import { HttpEvent, HttpHandlerFn, HttpRequest } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AuthStore } from './auth.store';
import { authBearerInterceptor } from './auth-bearer.interceptor';

describe('authBearerInterceptor', () => {
  function run(authStore: Partial<InstanceType<typeof AuthStore>>, req: HttpRequest<unknown>) {
    let seen: HttpRequest<unknown> | undefined;
    const next: HttpHandlerFn = (r) => {
      seen = r;
      return of({} as HttpEvent<unknown>);
    };
    TestBed.configureTestingModule({ providers: [{ provide: AuthStore, useValue: authStore }] });
    TestBed.runInInjectionContext(() => authBearerInterceptor(req, next).subscribe());
    return seen;
  }

  it('attaches the bearer token to a normal request', () => {
    const seen = run({ accessToken: () => 'tok-123' } as never, new HttpRequest('GET', '/api/tenants'));
    expect(seen?.headers.get('Authorization')).toBe('Bearer tok-123');
  });

  it('does not attach a header when there is no token', () => {
    const seen = run({ accessToken: () => null } as never, new HttpRequest('GET', '/api/tenants'));
    expect(seen?.headers.has('Authorization')).toBe(false);
  });

  it('never attaches a token to the login request', () => {
    const seen = run(
      { accessToken: () => 'tok-123' } as never,
      new HttpRequest('POST', '/api/auth/login', {}),
    );
    expect(seen?.headers.has('Authorization')).toBe(false);
  });

  it('never attaches a token to the invite-accept request', () => {
    const seen = run(
      { accessToken: () => 'tok-123' } as never,
      new HttpRequest('POST', '/api/auth/invites/accept', {}),
    );
    expect(seen?.headers.has('Authorization')).toBe(false);
  });
});
