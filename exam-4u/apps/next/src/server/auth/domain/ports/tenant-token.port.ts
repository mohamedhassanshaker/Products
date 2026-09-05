/**
 * Port for tenant-realm JWT issuance/verification — ported verbatim from
 * `legacy/api/src/modules/auth/domain/ports/tenant-token.port.ts`. `AuthService` depends on this
 * abstraction, never on `server/infrastructure/security`'s concrete `JwtTenantTokenAdapter` directly
 * (DIP) — the sole implementation is wired in this module's own composition root (`index.ts`).
 */
export interface IssuedTenantToken {
  token: string;
  expiresInSeconds: number;
}

export interface DecodedTenantToken {
  userId: string;
  tenantId: string;
  tenantSlug: string;
  jti: string;
  issuedAt: number;
  expiresAt: number;
}

export interface TenantTokenPort {
  issue(claims: { userId: string; tenantId: string; tenantSlug: string }): Promise<IssuedTenantToken>;
  /** Never throws — every failure mode (unconfigured secret, bad signature, expired, wrong `aud`/
   * `iss`/`typ`, malformed) collapses to `null`. */
  verify(token: string): Promise<DecodedTenantToken | null>;
}
