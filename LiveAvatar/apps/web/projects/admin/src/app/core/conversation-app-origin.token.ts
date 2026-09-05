import { InjectionToken } from '@angular/core';

/**
 * Base URL prepended to a caller-facing conversation link (`/c/:slug`) built
 * from the admin app — e.g. the Deployments list's "Open conversation
 * experience" action. Mirrors `API_BASE_URL`'s own rationale
 * (`@liveavatar/web-shared`'s `api-base-url.token.ts`): both SPAs are served
 * behind the same NestJS host in production (`apps/api` serves `/admin`,
 * `/c`, and `/api` — LLD §3.2), so the relative default is correct there and
 * can be overridden for local dev setups that run the two SPAs on separate
 * origins/ports.
 */
export const CONVERSATION_APP_ORIGIN = new InjectionToken<string>('CONVERSATION_APP_ORIGIN', {
  providedIn: 'root',
  factory: () => '',
});
