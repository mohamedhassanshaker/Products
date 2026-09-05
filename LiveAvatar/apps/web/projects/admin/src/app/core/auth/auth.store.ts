import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { Observable, catchError, tap, throwError } from 'rxjs';
import type {
  AcceptInviteRequest,
  AdminUserDto,
  LoginRequest,
  TokenPairDto,
} from '@liveavatar/contracts';
import { AuthApiService, type AppClientError } from '@liveavatar/web-shared';
import { TokenStorageService } from './token-storage.service';

/** Auth lifecycle state (LLD §9.1 cross-cutting state via `@ngrx/signals`). */
export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  accessToken: string | null;
  user: AdminUserDto | null;
  error: AppClientError | null;
}

const initialState: AuthState = {
  status: 'idle',
  accessToken: null,
  user: null,
  error: null,
};

/**
 * Cross-cutting auth state (LLD §9.1). Holds the access token in memory
 * only; the refresh token is delegated to {@link TokenStorageService}
 * (see its doc comment for the localStorage trade-off).
 */
export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState<AuthState>(initialState),
  withComputed(({ status, user }) => ({
    isAuthenticated: computed(() => status() === 'authenticated'),
    isLoading: computed(() => status() === 'loading'),
    roles: computed(() => user()?.roles ?? []),
    isOperator: computed(() => (user()?.roles ?? []).includes('operator')),
    isAdmin: computed(() => (user()?.roles ?? []).includes('admin')),
    /** Toolbar role chip text (UX_GUIDELINES §1.5): "Operator" / "Admin" / "Operator · Admin". */
    roleLabel: computed(() => {
      const roles = user()?.roles ?? [];
      const labels: string[] = [];
      if (roles.includes('operator')) {
        labels.push('Operator');
      }
      if (roles.includes('admin')) {
        labels.push('Admin');
      }
      return labels.join(' · ');
    }),
  })),
  withMethods((store) => {
    const authApi = inject(AuthApiService);
    const tokenStorage = inject(TokenStorageService);

    function applySession(session: TokenPairDto): void {
      tokenStorage.setRefreshToken(session.refresh_token);
      patchState(store, {
        status: 'authenticated',
        accessToken: session.access_token,
        user: session.user,
        error: null,
      });
    }

    function clearSession(): void {
      tokenStorage.clear();
      patchState(store, {
        status: 'unauthenticated',
        accessToken: null,
        user: null,
      });
    }

    return {
      /** `POST /api/auth/login` (FR-AUTH-1). */
      login(body: LoginRequest): Observable<TokenPairDto> {
        patchState(store, { status: 'loading', error: null });
        return authApi.login(body).pipe(
          tap((session) => applySession(session)),
          catchError((error: AppClientError) => {
            patchState(store, { status: 'unauthenticated', error });
            return throwError(() => error);
          }),
        );
      },

      /** `POST /api/auth/invites/accept` (FR-AUTH-3) — same session bootstrap as login. */
      acceptInvite(body: AcceptInviteRequest): Observable<TokenPairDto> {
        patchState(store, { status: 'loading', error: null });
        return authApi.acceptInvite(body).pipe(
          tap((session) => applySession(session)),
          catchError((error: AppClientError) => {
            patchState(store, { status: 'unauthenticated', error });
            return throwError(() => error);
          }),
        );
      },

      /**
       * Silent refresh, also used to restore a session on reload from the
       * persisted refresh token. Any failure (expired/revoked/missing)
       * clears the session — the caller (guard/interceptor) redirects to
       * login (UX_GUIDELINES §1.5 session expiry).
       */
      refresh(): Observable<TokenPairDto | { access_token: string; expires_in: number; refresh_token: string }> {
        const refreshToken = tokenStorage.getRefreshToken();
        if (!refreshToken) {
          clearSession();
          return throwError(() => ({ status: 401, code: 'AUTH_REFRESH_INVALID', message: 'Session expired. Sign in again.', details: {} }) as AppClientError);
        }
        patchState(store, { status: 'loading' });
        return authApi.refresh({ refresh_token: refreshToken }).pipe(
          tap((rotated) => {
            tokenStorage.setRefreshToken(rotated.refresh_token);
            patchState(store, { status: 'authenticated', accessToken: rotated.access_token, error: null });
          }),
          catchError((error: AppClientError) => {
            clearSession();
            return throwError(() => error);
          }),
        );
      },

      /** Populates `user` after a bare token refresh (no `user` in the refresh response). */
      loadCurrentUser(): Observable<AdminUserDto> {
        return authApi.me().pipe(
          tap((user) => patchState(store, { user, status: 'authenticated' })),
          catchError((error: AppClientError) => {
            clearSession();
            return throwError(() => error);
          }),
        );
      },

      /** `POST /api/auth/logout` — clears local state even if the network call fails (shell §4.7). */
      logout(): Observable<void> {
        const refreshToken = tokenStorage.getRefreshToken();
        if (!refreshToken) {
          clearSession();
          return new Observable<void>((subscriber) => {
            subscriber.next();
            subscriber.complete();
          });
        }
        return authApi.logout(refreshToken).pipe(
          tap(() => clearSession()),
          catchError(() => {
            clearSession();
            return new Observable<void>((subscriber) => {
              subscriber.next();
              subscriber.complete();
            });
          }),
        );
      },

      /** Marks the store unauthenticated with no persisted refresh token (fresh app load). */
      markUnauthenticated(): void {
        clearSession();
      },
    };
  }),
);
