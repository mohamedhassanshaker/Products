/** Port for platform-realm JWT issuance/verification — ported verbatim from
 * `legacy/api/src/platform/auth/domain/ports/platform-admin-token.port.ts`. Sole implementation is
 * `server/infrastructure/security`'s `JwtPlatformTokenAdapter`, wired in this module's composition
 * root (DIP). */
export interface IssuedPlatformToken {
  token: string;
  expiresInSeconds: number;
}

export interface DecodedPlatformToken {
  adminId: string;
  jti: string;
  issuedAt: number;
  expiresAt: number;
}

export interface PlatformAdminTokenPort {
  issue(claims: { adminId: string }): Promise<IssuedPlatformToken>;
  /** Never throws — collapses every failure mode to `null`. */
  verify(token: string): Promise<DecodedPlatformToken | null>;
}
