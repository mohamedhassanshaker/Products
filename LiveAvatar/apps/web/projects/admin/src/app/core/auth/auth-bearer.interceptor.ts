import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthStore } from './auth.store';

/** Login/invite-accept must never carry a (possibly stale) bearer token. */
const UNAUTHENTICATED_PATHS = [/\/auth\/login$/, /\/auth\/refresh$/, /\/auth\/invites\/accept$/];

/**
 * Attaches the in-memory access token to every other outgoing request
 * (LLD §1.2 functional interceptor: auth bearer-token attach).
 */
export const authBearerInterceptor: HttpInterceptorFn = (req, next) => {
  const authStore = inject(AuthStore);
  const token = authStore.accessToken();

  if (!token || UNAUTHENTICATED_PATHS.some((pattern) => pattern.test(req.url))) {
    return next(req);
  }

  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
