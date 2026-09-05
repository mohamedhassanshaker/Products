import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  AcceptInviteRequest,
  AdminUserDto,
  LoginRequest,
  RefreshRequest,
  TokenPairDto,
} from '@liveavatar/contracts';
import { API_BASE_URL } from './api-base-url.token';

/** Shape of `POST /api/auth/refresh` (LLD §5.2) — rotated pair, no `user`. */
export interface RefreshResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
}

/**
 * Typed HTTP client for the auth surface (`packages/contracts` auth schemas).
 * No token handling here — that is `AuthStore`'s job (LLD §9.1); this service
 * only knows routes, methods, and bodies.
 */
@Injectable({ providedIn: 'root' })
export class AuthApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** POST /api/auth/login */
  login(body: LoginRequest): Observable<TokenPairDto> {
    return this.http.post<TokenPairDto>(`${this.baseUrl}/auth/login`, body);
  }

  /** POST /api/auth/refresh */
  refresh(body: RefreshRequest): Observable<RefreshResponse> {
    return this.http.post<RefreshResponse>(`${this.baseUrl}/auth/refresh`, body);
  }

  /** POST /api/auth/logout */
  logout(refreshToken: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/auth/logout`, { refresh_token: refreshToken });
  }

  /** GET /api/auth/me */
  me(): Observable<AdminUserDto> {
    return this.http.get<AdminUserDto>(`${this.baseUrl}/auth/me`);
  }

  /** POST /api/auth/invites/accept */
  acceptInvite(body: AcceptInviteRequest): Observable<TokenPairDto> {
    return this.http.post<TokenPairDto>(`${this.baseUrl}/auth/invites/accept`, body);
  }
}
