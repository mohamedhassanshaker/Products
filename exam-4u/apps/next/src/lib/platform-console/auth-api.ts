import { platformFetch } from './http-client';

/** Local mirror of `PlatformAdminSummary` (server: `@/server/platform/auth`'s `domain/platform-admin.types.ts`)
 * — kept as its own client-side type rather than re-imported from `server/**`, matching the legacy
 * Angular app's own `core/platform-auth/platform-auth.service.ts` convention of owning its wire-shape
 * types independently of the backend's internal ones. */
export interface PlatformAdminSummary {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface PlatformLoginResult {
  accessToken: string;
  expiresInSeconds: number;
  admin: PlatformAdminSummary;
}

/** `POST /api/platform/auth/login` — public, no token yet. */
export function login(email: string, password: string): Promise<PlatformLoginResult> {
  return platformFetch<PlatformLoginResult>('/api/platform/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

/** `GET /api/platform/auth/me` — authenticated; used to validate an already-stored token on app load
 * (e.g. a page refresh) before trusting it enough to render the console shell. */
export function me(): Promise<PlatformAdminSummary> {
  return platformFetch<PlatformAdminSummary>('/api/platform/auth/me', { method: 'GET' });
}
