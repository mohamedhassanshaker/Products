import { InjectionToken } from '@angular/core';

/**
 * Base URL prepended to every typed HTTP client call in this library.
 * Both SPAs are served behind the same NestJS host (`apps/api` serves
 * `/admin`, `/c`, and `/api` — LLD §3.2), so the relative default is
 * correct for production and can be overridden for local dev proxies.
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => '/api',
});
