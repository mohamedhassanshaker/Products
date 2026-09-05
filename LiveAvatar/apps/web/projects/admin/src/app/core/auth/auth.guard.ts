import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from './auth.store';

/**
 * Redirects unauthenticated users to `/admin/login` with a `returnUrl`
 * (UX_GUIDELINES §1.7 route map, "Guarded deep links store returnUrl").
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  if (authStore.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/**
 * Redirects already-authenticated users away from login/invite routes
 * (UX_GUIDELINES §2.1/§1.7): "Already authenticated users hitting
 * `/admin/login` skip the form and go to `/admin/deployments`."
 */
export const guestGuard: CanActivateFn = () => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  if (!authStore.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree(['/deployments']);
};
