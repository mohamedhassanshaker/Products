'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as authApi from './auth-api';
import { clearStoredPlatformToken, getStoredPlatformToken, setStoredPlatformToken } from './token-storage';
import { isPlatformApiError } from './api-error';

/**
 * Platform-admin session state, held client-side only (this app's equivalent of legacy Angular's
 * `PlatformAuthStore`, `docs/design/UX_GUIDELINES.md` §3.0/§3's `platform-shell` account-menu source).
 * `status` starts `'checking'` on every mount (including a hard page reload) — a stored token is
 * re-validated via a real `GET /api/platform/auth/me` call rather than trusted blindly, since it may
 * have expired or been revoked server-side since it was written to `localStorage`.
 */
interface PlatformAuthState {
  status: 'checking' | 'authenticated' | 'unauthenticated';
  admin: authApi.PlatformAdminSummary | null;
}

interface PlatformAuthContextValue extends PlatformAuthState {
  login(email: string, password: string): Promise<void>;
  logout(): void;
}

const PlatformAuthContext = createContext<PlatformAuthContextValue | undefined>(undefined);

/**
 * Mounted once at the top of the `/platform` route tree (`app/platform/layout.tsx`) — every platform
 * page/layout below it consumes {@link usePlatformAuthContext} rather than re-deriving token/admin
 * state itself.
 */
export function PlatformAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlatformAuthState>({ status: 'checking', admin: null });

  useEffect(() => {
    let cancelled = false;
    const token = getStoredPlatformToken();
    if (!token) {
      setState({ status: 'unauthenticated', admin: null });
      return;
    }
    authApi
      .me()
      .then((admin) => {
        if (!cancelled) setState({ status: 'authenticated', admin });
      })
      .catch(() => {
        // An expired/invalid/revoked token — fail closed to the login screen rather than rendering the
        // console shell with stale/absent admin data (error prevention: never show a half-authenticated
        // state).
        clearStoredPlatformToken();
        if (!cancelled) setState({ status: 'unauthenticated', admin: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await authApi.login(email, password);
    setStoredPlatformToken(result.accessToken);
    setState({ status: 'authenticated', admin: result.admin });
  }, []);

  const logout = useCallback(() => {
    clearStoredPlatformToken();
    setState({ status: 'unauthenticated', admin: null });
  }, []);

  const value = useMemo<PlatformAuthContextValue>(() => ({ ...state, login, logout }), [state, login, logout]);

  return <PlatformAuthContext.Provider value={value}>{children}</PlatformAuthContext.Provider>;
}

export function usePlatformAuthContext(): PlatformAuthContextValue {
  const ctx = useContext(PlatformAuthContext);
  if (!ctx) {
    throw new Error('usePlatformAuthContext must be used within a PlatformAuthProvider.');
  }
  return ctx;
}

/** Re-exported so a component only needs one import for the common "is this a known API error, and
 * what code did it carry" check (`docs/design/UX_GUIDELINES.md`'s repeated `INVALID_TENANT_STATE`
 * race-recovery pattern). */
export { isPlatformApiError };
