/**
 * Tenant-realm bearer-token storage — `localStorage` under a fixed key (`el.tok.tenant`), not one
 * embedding the tenant slug (`el.tok.{slug}`, legacy Angular's own convention). This app's tenant realm
 * is subdomain-scoped by construction — each tenant is already a distinct browser origin, so
 * `localStorage` is naturally isolated per tenant without needing the slug embedded in the key. See
 * `docs/plans/nextjs-rewrite-phase3-plan.md`'s "Decisions made" #4 for the full reasoning; mirrors
 * `lib/platform-console/token-storage.ts`'s identical fixed-key precedent (`el.tok.platform`), which
 * has the same single-realm-per-origin property.
 *
 * Deliberately plain `localStorage` (not a cookie) — `withTenantContext`/`requireTenantUser` only ever
 * read a bearer token from the `Authorization` header, never a cookie/session. Every read is
 * defensively guarded for a non-browser (SSR) execution context.
 */
const TOKEN_KEY = 'el.tok.tenant';

export function getStoredTenantToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setStoredTenantToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredTenantToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
}
