import { Injectable } from '@angular/core';

const REFRESH_TOKEN_KEY = 'la_admin_refresh_token';

/**
 * Persists the refresh token across page reloads.
 *
 * Security trade-off (judgment call — LLD leaves this open, §9.1/security
 * note in the Phase 1 task): the API issues bearer tokens, not httpOnly
 * cookies (LLD §5.2), so the SPA itself must hold the refresh token
 * somewhere for it to survive a reload. `localStorage` is readable by any
 * script executing on this origin, so an XSS bug would let an attacker
 * read the refresh token and mint new sessions until it is rotated or
 * revoked. To shrink that blast radius, the *access* token is never
 * persisted here — `AuthStore` only ever holds it in an in-memory signal,
 * so a reload always costs one refresh round-trip but a stolen access
 * token cannot outlive the tab. This is the smallest reasonable choice
 * given the current bearer-token API; a later phase could move to an
 * httpOnly-cookie-issued refresh token if the backend adds that flow.
 */
@Injectable({ providedIn: 'root' })
export class TokenStorageService {
  getRefreshToken(): string | null {
    try {
      return localStorage.getItem(REFRESH_TOKEN_KEY);
    } catch {
      return null;
    }
  }

  setRefreshToken(token: string): void {
    try {
      localStorage.setItem(REFRESH_TOKEN_KEY, token);
    } catch {
      // Storage unavailable (private mode / quota) — session won't survive reload.
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    } catch {
      // ignore
    }
  }
}
