/**
 * Platform-admin bearer-token storage — `localStorage` under a platform-specific key, matching the
 * legacy Angular app's own documented convention (`docs/design/UX_GUIDELINES.md` §3.0: "its own token
 * storage key (distinct from `el.tok.{slug}` — e.g. `el.tok.platform`)"). This realm has no tenant
 * concept at all, so unlike a future tenant-realm client there's exactly one fixed key, never a
 * per-slug one.
 *
 * Deliberately plain `localStorage` (not a cookie) — this app's `withPlatformAuth` (like every other
 * realm's guard) only ever reads a bearer token from the `Authorization` header (see
 * `server/context/with-platform-auth.ts`), never a cookie/session, so the client has no reason to
 * carry one. Every read is defensively guarded for a non-browser (SSR) execution context — these
 * helpers are only ever meaningfully *called* from a Client Component's event handler/effect, but
 * guarding here too costs nothing and avoids a `ReferenceError: localStorage is not defined` if a
 * caller is ever refactored into a server-evaluated code path by mistake.
 */
const TOKEN_KEY = 'el.tok.platform';

export function getStoredPlatformToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setStoredPlatformToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredPlatformToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
}
