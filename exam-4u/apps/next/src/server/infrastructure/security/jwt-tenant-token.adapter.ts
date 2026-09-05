import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { logger } from '@/server/logging';
import { parseTtlToSeconds } from './ttl.util';

/** Fixed, never-configurable claim constants (LLD/HLD "three independent barriers" — ported verbatim
 * from `legacy/api/src/infrastructure/security/jwt-tenant-token.adapter.ts`). */
const TENANT_AUDIENCE = 'tenant';
const TENANT_TOKEN_TYPE = 'tenant-user';
const TOKEN_ISSUER = 'examland';

/** Claims {@link JwtTenantTokenAdapter.issue} needs — structurally matches
 * `server/auth`'s `TenantTokenPort.issue()` parameter (no formal `implements` clause on this class —
 * see this file's own header comment for why). */
export interface TenantTokenClaims {
  userId: string;
  tenantId: string;
  tenantSlug: string;
}

export interface IssuedTenantToken {
  token: string;
  expiresInSeconds: number;
}

/** Everything `JwtAuthGuard`-equivalent code (`auth`'s `requireTenantUser`) needs from a verified
 * token — deliberately excludes any roles/permissions claim (HLD: "permissions are deliberately not
 * in the token... resolved per request from the tenant schema"). */
export interface DecodedTenantToken {
  userId: string;
  tenantId: string;
  tenantSlug: string;
  jti: string;
  issuedAt: number;
  expiresAt: number;
}

/**
 * The sole tenant-realm JWT implementation (`jose`, not `jsonwebtoken` — migration plan's explicit
 * library choice) — ported logic (not code) from
 * `legacy/api/src/infrastructure/security/jwt-tenant-token.adapter.ts`'s `JwtTenantTokenAdapter`.
 * Nothing outside `server/infrastructure/security` may import `jose` directly (module-boundary rule).
 *
 * Deliberately has **no** `implements TenantTokenPort` clause: `TenantTokenPort` lives in
 * `server/auth/domain/ports` (the consuming domain layer, per DIP — the domain owns the abstraction,
 * infrastructure depends on the domain, never the reverse). Declaring `implements` here would import
 * `server/auth`'s barrel into `server/infrastructure/security`, creating a needless module
 * back-reference; TypeScript's structural typing already lets `server/auth`'s composition root
 * assign a `JwtTenantTokenAdapter` instance to a `TenantTokenPort`-typed dependency without it, so the
 * DIP boundary is enforced by usage, not by a redundant type annotation.
 */
export class JwtTenantTokenAdapter {
  constructor(
    private readonly secret: string | undefined,
    private readonly ttlSpec: string,
  ) {}

  /**
   * @throws Error (plain, not a `DomainError`) if `JWT_TENANT_SECRET` is unset — a boot/config bug,
   *   never a client-facing condition, matching legacy's identical fail-fast-at-issue-time contract.
   */
  async issue(claims: TenantTokenClaims): Promise<IssuedTenantToken> {
    if (!this.secret) {
      throw new Error('JWT_TENANT_SECRET is not configured; cannot issue tenant tokens.');
    }
    const expiresInSeconds = parseTtlToSeconds(this.ttlSpec);
    const key = new TextEncoder().encode(this.secret);
    const token = await new SignJWT({ typ: TENANT_TOKEN_TYPE, tid: claims.tenantId, tsl: claims.tenantSlug })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.userId)
      .setAudience(TENANT_AUDIENCE)
      .setIssuer(TOKEN_ISSUER)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
      .sign(key);
    return { token, expiresInSeconds };
  }

  /**
   * Verifies `token`, collapsing every failure mode (unconfigured secret, bad signature, expired,
   * wrong `aud`/`iss`, malformed, wrong `typ`, missing claims) into a single `null` return — **never
   * throws** (ported verbatim contract from legacy's identical adapter). Cross-tenant replay
   * (`decoded.tenantId` vs. the request's actually-resolved tenant) is checked by the caller
   * (`auth`'s `requireTenantUser`), not here — this method only proves the token's own signature/
   * claims are well-formed and untampered.
   */
  async verify(token: string): Promise<DecodedTenantToken | null> {
    if (!this.secret) {
      logger.warn('jwt_tenant_secret_not_configured');
      return null;
    }
    try {
      const key = new TextEncoder().encode(this.secret);
      const { payload } = await jwtVerify(token, key, { audience: TENANT_AUDIENCE, issuer: TOKEN_ISSUER, algorithms: ['HS256'] });
      if (payload.typ !== TENANT_TOKEN_TYPE) return null;
      if (typeof payload.sub !== 'string' || typeof payload.tid !== 'string' || typeof payload.tsl !== 'string') {
        return null;
      }
      return {
        userId: payload.sub,
        tenantId: payload.tid,
        tenantSlug: payload.tsl,
        jti: typeof payload.jti === 'string' ? payload.jti : '',
        issuedAt: typeof payload.iat === 'number' ? payload.iat : 0,
        expiresAt: typeof payload.exp === 'number' ? payload.exp : 0,
      };
    } catch {
      return null;
    }
  }
}
