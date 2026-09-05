'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as authApi from './auth-api';
import { clearStoredTenantToken, getStoredTenantToken, setStoredTenantToken } from './token-storage';
import { isTenantApiError } from './api-error';

/**
 * Tenant-user session state, held client-side only — this app's tenant-realm equivalent of
 * `lib/platform-console/auth-context.tsx`'s `PlatformAuthProvider`. `status` starts `'checking'` on
 * every mount (including a hard page reload) — a stored token is re-validated via a real
 * `GET /api/auth/me` call rather than trusted blindly, since it may have expired or been revoked
 * server-side since it was written to `localStorage`.
 *
 * `user.permissions` (the real, resolved union of the signed-in user's role grants) is what every
 * nav-item/route gate in `TenantShell` and the taxonomy/curricula pages check against — per
 * `docs/design/UX_GUIDELINES.md` §4.0/§19's "gate on permission, not role name" principle.
 */
interface TenantAuthState {
  status: 'checking' | 'authenticated' | 'unauthenticated';
  user: authApi.TenantUserSummary | null;
}

interface TenantAuthContextValue extends TenantAuthState {
  login(email: string, password: string): Promise<void>;
  logout(): void;
  /** Convenience helper — `false` while still `'checking'`/`'unauthenticated'`, never throws. */
  hasPermission(permission: string): boolean;
}

const TenantAuthContext = createContext<TenantAuthContextValue | undefined>(undefined);

/** Mounted once at the top of the tenant realm's route tree (`app/(tenant)/layout.tsx`) — every tenant
 * page/layout below it consumes {@link useTenantAuthContext} rather than re-deriving token/user state
 * itself. */
export function TenantAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TenantAuthState>({ status: 'checking', user: null });

  useEffect(() => {
    let cancelled = false;
    const token = getStoredTenantToken();
    if (!token) {
      setState({ status: 'unauthenticated', user: null });
      return;
    }
    authApi
      .me()
      .then((user) => {
        if (!cancelled) setState({ status: 'authenticated', user });
      })
      .catch(() => {
        // An expired/invalid/revoked token — fail closed to the login screen rather than rendering the
        // shell with stale/absent user data (error prevention: never show a half-authenticated state).
        clearStoredTenantToken();
        if (!cancelled) setState({ status: 'unauthenticated', user: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await authApi.login(email, password);
    setStoredTenantToken(result.accessToken);
    // The login response's `user` field doesn't carry `permissions` (legacy's own `LoginResult` shape) —
    // a real `GET /api/auth/me` immediately after login resolves the full, current permission set rather
    // than this context guessing/caching a stale value.
    const user = await authApi.me();
    setState({ status: 'authenticated', user });
  }, []);

  const logout = useCallback(() => {
    clearStoredTenantToken();
    setState({ status: 'unauthenticated', user: null });
  }, []);

  const hasPermission = useCallback((permission: string) => state.user?.permissions.includes(permission) ?? false, [state.user]);

  const value = useMemo<TenantAuthContextValue>(() => ({ ...state, login, logout, hasPermission }), [state, login, logout, hasPermission]);

  return <TenantAuthContext.Provider value={value}>{children}</TenantAuthContext.Provider>;
}

export function useTenantAuthContext(): TenantAuthContextValue {
  const ctx = useContext(TenantAuthContext);
  if (!ctx) {
    throw new Error('useTenantAuthContext must be used within a TenantAuthProvider.');
  }
  return ctx;
}

export { isTenantApiError };
