import { ApplicationConfig, inject, provideAppInitializer, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withRouterConfig } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { firstValueFrom, switchMap } from 'rxjs';
import { errorEnvelopeInterceptor } from '@liveavatar/web-shared';
import { routes } from './app.routes';
import { AuthStore } from './core/auth/auth.store';
import { authBearerInterceptor } from './core/auth/auth-bearer.interceptor';
import { TokenStorageService } from './core/auth/token-storage.service';

/**
 * Root providers (LLD §1.2/§9.1): router, HttpClient with the functional
 * interceptor chain (error envelope unwrap → auth bearer attach), and an
 * app initializer that restores a session from the persisted refresh token
 * before any route guard evaluates `AuthStore.isAuthenticated()`.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    // `paramsInheritanceStrategy: 'always'` (Phase 16, BL-065 — the Agent
    // Builder shell) — the shell mounts at `tenants/:id/builder` and nests
    // every tab (Overview/Pipeline/.../Skills/:skillId/...) as a *child*
    // route under it so tabs are independently linkable (deep links, back
    // button). Angular's default `'emptyOnly'` strategy only merges a
    // parent's route params into a child when the parent's own path is
    // empty (`path: ''`) — ours is `tenants/:id/builder`, not empty — so
    // without this, every embedded tab page's `route.snapshot.paramMap.get
    // ('id')` (e.g. `ToolsPageComponent`, `ReasoningPageComponent`) would
    // read `null` once nested, even though nothing about those components
    // changed. No route in this app nests non-empty-path segments today, so
    // this has no effect on any existing route.
    provideRouter(routes, withRouterConfig({ paramsInheritanceStrategy: 'always' })),
    provideAnimationsAsync(),
    provideHttpClient(withInterceptors([errorEnvelopeInterceptor, authBearerInterceptor])),
    provideAppInitializer(() => {
      const authStore = inject(AuthStore);
      const tokenStorage = inject(TokenStorageService);

      if (!tokenStorage.getRefreshToken()) {
        authStore.markUnauthenticated();
        return undefined;
      }

      return firstValueFrom(authStore.refresh().pipe(switchMap(() => authStore.loadCurrentUser()))).then(
        () => undefined,
        () => undefined,
      );
    }),
  ],
};
