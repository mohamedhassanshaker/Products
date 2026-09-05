import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { AuthStore } from './auth.store';
import { authGuard, guestGuard } from './auth.guard';

describe('authGuard / guestGuard', () => {
  function setup(isAuthenticated: boolean) {
    TestBed.configureTestingModule({
      providers: [{ provide: AuthStore, useValue: { isAuthenticated: () => isAuthenticated } }],
    });
  }

  it('authGuard allows navigation when authenticated', () => {
    setup(true);
    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as never, { url: '/deployments' } as never),
    );
    expect(result).toBe(true);
  });

  it('authGuard redirects to login with returnUrl when unauthenticated', () => {
    setup(false);
    const router = TestBed.inject(Router);
    const spy = jest.spyOn(router, 'createUrlTree');
    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as never, { url: '/deployments' } as never),
    );
    expect(result).toBeInstanceOf(UrlTree);
    expect(spy).toHaveBeenCalledWith(['/login'], { queryParams: { returnUrl: '/deployments' } });
  });

  it('guestGuard allows navigation when unauthenticated', () => {
    setup(false);
    const result = TestBed.runInInjectionContext(() => guestGuard({} as never, {} as never));
    expect(result).toBe(true);
  });

  it('guestGuard redirects to deployments when already authenticated', () => {
    setup(true);
    const result = TestBed.runInInjectionContext(() => guestGuard({} as never, {} as never));
    expect(result).toBeInstanceOf(UrlTree);
  });
});
