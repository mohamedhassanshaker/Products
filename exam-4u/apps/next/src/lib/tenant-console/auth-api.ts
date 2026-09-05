import { tenantFetch } from './http-client';

/** Local mirror of `GET /api/auth/me`'s response shape (server: `@/server/auth`). Kept as its own
 * client-side type rather than re-imported from `server/**`, matching `lib/platform-console/
 * auth-api.ts`'s identical "the frontend HTTP client owns its own wire-shape types" convention. */
export interface TenantUserSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  permissions: string[];
}

export interface TenantLoginResult {
  accessToken: string;
  expiresInSeconds: number;
  user: { id: string; email: string; firstName: string; lastName: string };
}

/** `POST /api/auth/login` — public, no token yet. */
export function login(email: string, password: string): Promise<TenantLoginResult> {
  return tenantFetch<TenantLoginResult>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

/** `GET /api/auth/me` — authenticated; used both to validate an already-stored token on app load and
 * to resolve the permission set nav-item gating (`TenantAuthProvider`) reads. */
export function me(): Promise<TenantUserSummary> {
  return tenantFetch<TenantUserSummary>('/api/auth/me', { method: 'GET' });
}
