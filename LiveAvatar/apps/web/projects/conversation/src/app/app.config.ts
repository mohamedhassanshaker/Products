import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { errorEnvelopeInterceptor } from '@liveavatar/web-shared';
import { routes } from './app.routes';

/**
 * Root providers for the unauthenticated conversation SPA (LLD §3.2). No
 * auth bearer interceptor — this app never presents an admin JWT to the
 * control plane (FR-AUTH-5). The error-envelope interceptor is still shared
 * so `AppClientError`/`toAppClientError` (the same shape the admin SPA
 * consumes) work identically here.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([errorEnvelopeInterceptor])),
  ],
};
